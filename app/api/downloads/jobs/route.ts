import {downloadSourceState} from '@/lib/download-source-snapshot';
import {prepareDownloadTracks,DownloadPreparationError} from '@/lib/download-preparation';
import {recordingInventory,resolveRecording} from '@/scripts/download-index.mjs';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {requireLocalUser,requireOrigin,apiError,noStore} from '@/lib/route-auth';
import {SpotifyError} from '@/lib/spotify';
import {validateSourcePlaylist,destinationMappingPath,type SourcePlaylist} from '@/lib/rekordbox-destinations';
import {resolveRekordboxDestination} from '@/lib/rekordbox-playlist-mapping';
import {localSettingsStore,validateDownloadFolder} from '@/lib/local-download-settings';
import {assertRekordboxCanOpen,fileLock,accountLock,activeStates,jobsIn,validJob,manifestFor,persist,launchWorker,leaseBusy,recoverAccount,requestCancel,clearCancel,cancellation,markCancelled,pendingImport,reusableRequest} from '@/scripts/download-runtime.mjs';
const run=promisify(execFile);
function requestHash(data:any){return createHash('sha256').update(JSON.stringify({sourcePlaylist:data.sourcePlaylist,tracks:data.tracks,additionalExistingIds:data.additionalExistingIds,sourceRevision:data.sourceRevision})).digest('hex')}
function root(user:string){return join(process.cwd(),'.data/downloads',createHash('sha256').update(user).digest('hex'))}
function summary(job:any){return {membershipOnly:!!job.membershipOnly,id:job.id,requestKey:job.requestKey||null,status:job.status,message:job.message||'',nextRetryAt:job.nextRetryAt||null,autoImport:!!job.autoImport,imported:job.imported||0,delivery:job.version===2?'folder':'legacy-zip',sourcePlaylist:job.sourcePlaylist||null,rekordbox:job.rekordbox?{status:job.rekordbox.status,destination:job.rekordbox.destination,error:job.rekordbox.error||''}:null,outputFolder:job.outputFolder||null,total:job.tracks.length,completed:job.completed,failures:job.failures,current:job.current,tracks:job.version===2?job.tracks.map((t:any)=>({videoId:t.videoId,title:t.title,artist:t.artist,state:t.state,filename:t.filename||null,reused:!!t.reused,error:t.error||'',importState:t.importState||null,importError:t.importError||''})):[]}}
async function visibleSummary(user:string,job:any){
 if(activeStates.includes(job.status)&&await cancellation(manifestFor(root(user),job.id)))return summary({...job,status:'stopping',message:job.message?.startsWith('Finishing an already committed')?job.message:'Stopping after the current file or import finishes safely.'});
 return summary(job);
}
async function readJob(user:string,id:unknown):Promise<any>{if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw new SpotifyError('Invalid download job.',400);let raw:string;try{raw=await readFile(join(root(user),id,'job.json'),'utf8')}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new SpotifyError('Download job not found.',404);throw e}let job:unknown;try{job=JSON.parse(raw)}catch{throw new SpotifyError('This download job could not be read. Its files have not been changed.',409)}if(!validJob(job,id))throw new SpotifyError('This download job has invalid saved data. Its files have not been changed.',409);return job}
async function mappedDestination(owner:string,source:SourcePlaylist,libraryPath:string|null){
 try{const mapped=await resolveRekordboxDestination(owner,source,libraryPath);
  if(mapped.resolution.status==='choose')throw new SpotifyError('Choose a Rekordbox destination before importing.',409);
  return {status:'mapped',libraryId:mapped.library.libraryId,libraryPath:mapped.library.libraryPath,destination:mapped.resolution.destination,mappingPath:destinationMappingPath(owner,mapped.library,source.id)};
 }catch(e){if(e instanceof SpotifyError)throw e;return {status:'unavailable',libraryPath,error:e instanceof Error?e.message:'Rekordbox unavailable.'}}
}
async function startWorker(manifest:string,job:any){
 try{await launchWorker(manifest,job)}catch{job.status='paused';job.message='Could not start the local worker. Check Settings, then choose Resume. Your MP3s are safe.';await persist(manifest,job)}
}
export async function POST(request:Request){try{
 if(process.env.VERCEL)throw new SpotifyError('Downloads require the local app on your computer.',503);
 requireOrigin(request);const user=await requireLocalUser();
 const body=await request.text();if(Buffer.byteLength(body)>50000)throw new SpotifyError('Request too large.',400);let data:any;try{data=JSON.parse(body)}catch{throw new SpotifyError('Could not read the download request.',400)}
 if(data?.action==='open-rekordbox'){
  if(process.platform!=='darwin')throw new SpotifyError('Open Rekordbox is available on macOS.',400);
  const job=await readJob(user.userId,data.id);
  if(job.version!==2||!job.completed)throw new SpotifyError('Save a track before opening Rekordbox.',409);
  await mkdir(join(process.cwd(),'.data/rekordbox'),{recursive:true,mode:0o700});
  let unlock:()=>Promise<void>;try{unlock=await fileLock(join(process.cwd(),'.data/rekordbox/writer.lock'))}catch{throw new SpotifyError('A library update is active. Wait for it to finish.',409)}
  try{
   try{await assertRekordboxCanOpen()}catch(e){throw new SpotifyError((e as Error).message,409)}
   await run('/usr/bin/open',['-a','rekordbox'],{timeout:10000});
   return Response.json({ok:true},{headers:noStore});
  }finally{await unlock()}
 }
 if(data?.action==='reveal'){
  const job=await readJob(user.userId,data.id);if(job.version!==2)throw new SpotifyError('This older job has no permanent MP3 folder.',400);
  const folder=await validateDownloadFolder(job.outputFolder),info=await stat(folder);
  if(String(info.dev)!==job.destinationIdentity.device||String(info.ino)!==job.destinationIdentity.inode)throw new SpotifyError('The destination folder changed. Reconnect its drive.',409);
  if(process.platform!=='darwin')throw new SpotifyError('Show in Finder is available on macOS.',400);
  await run('/usr/bin/open',[folder],{timeout:10000});return Response.json({ok:true},{headers:noStore});
 }
 const userRoot=root(user.userId);await mkdir(userRoot,{recursive:true,mode:0o700});
 // File inventory may take minutes on a cold library. Keep the admission lock
 // available for Stop, Resume and other job controls while it runs.
 let scannedInventory:any=null;
 if(!data?.action){
  const validText=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<300&&!/[\x00-\x1f]/.test(v);
  if(!Array.isArray(data?.tracks)||data.tracks.length>50||!data.tracks.every((t:any)=>t&&((typeof t.videoId==='string'&&/^[A-Za-z0-9_-]{11}$/.test(t.videoId))||(t.acquisition==='reuse'&&typeof t.spotifyTrackId==='string'))&&(t.acquisition==='download'||t.acquisition==='reuse')&&(t.spotifyTrackId===undefined||(typeof t.spotifyTrackId==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(t.spotifyTrackId)))&&validText(t.title)&&validText(t.artist)&&(t.album===undefined||t.album===''||validText(t.album))&&(t.durationMs===undefined||Number.isFinite(t.durationMs)&&t.durationMs>0&&t.durationMs<24*3600000)))throw new SpotifyError('Choose up to 50 valid YouTube matches.',400);
  if(!Array.isArray(data.additionalExistingIds)||data.additionalExistingIds.length>500||!data.additionalExistingIds.every((id:unknown)=>typeof id==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(id))||typeof data.sourceRevision!=='string'||!(/^[a-f0-9]{64}$/.test(data.sourceRevision)||data.sourceRevision==='none'))throw new SpotifyError('File check is out of date. Refresh Downloads before starting.',409);
  let earlySource:SourcePlaylist;try{earlySource=validateSourcePlaylist(data.sourcePlaylist)}catch(e){throw new SpotifyError((e as Error).message,400)}
  const existingJobs=await jobsIn(userRoot);
  if(existingJobs.some((j:any)=>activeStates.includes(j.status)))throw new SpotifyError('A download or import is already active. Finish or stop it first.',409);
  const scanSettings=await localSettingsStore().read(user.userId);
  const scanFolder=await validateDownloadFolder(scanSettings.downloadFolder);
  const scanDestination=await stat(scanFolder);
  const scanContext={signal:request.signal,outputFolder:scanFolder,destinationIdentity:{device:String(scanDestination.dev),inode:String(scanDestination.ino)},ffprobe:process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe'};
  const inventory=await recordingInventory(scanContext,existingJobs),source=await downloadSourceState(user.userId,earlySource.id);
  if(source.revision!==data.sourceRevision)throw new SpotifyError('The source playlist changed since the file check. Refresh Downloads before starting.',409);
  let prepared:any[];try{prepared=await prepareDownloadTracks(data.tracks,new Map(source.items.map(t=>[t.id,t])),data.additionalExistingIds,(track:any)=>resolveRecording(scanContext,track,inventory))}catch(e){if(e instanceof DownloadPreparationError)throw new SpotifyError(e.message,409);throw e}
  if(!prepared.length)throw new SpotifyError('No downloaded recordings were found for this playlist. Select tracks to match first.',400);
  request.signal.throwIfAborted();scannedInventory={folder:scanFolder,identity:scanContext.destinationIdentity,settingsRevision:scanSettings.revision,sourceRevision:source.revision,prepared};
 }
 let unlock:()=>Promise<void>;try{unlock=await accountLock(userRoot)}catch(e){throw new SpotifyError((e as Error).message,409)}
 try{
  const jobs=await jobsIn(userRoot);
  if(data?.action==='cancel'){
   const job=await readJob(user.userId,data.id),manifest=manifestFor(userRoot,job.id);
   if(activeStates.includes(job.status)){
    await requestCancel(manifest);
    if(!await leaseBusy(manifest)&&!await pendingImport(manifest)){markCancelled(job);await persist(manifest,job)}
   }
   return Response.json(await visibleSummary(user.userId,job),{headers:noStore});
  }
  if(!data?.action&&data?.requestKey!==undefined){
   if(typeof data.requestKey!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestKey))throw new SpotifyError('Invalid request key.',400);
  }
  if(!data?.action&&typeof data?.requestKey==='string'){
   let prior;try{prior=reusableRequest(jobs,data.requestKey,requestHash(data))}catch(e){throw new SpotifyError((e as Error).message,409)}
   if(prior)return Response.json(await visibleSummary(user.userId,prior),{headers:noStore});
  }
  if(jobs.some((j:any)=>activeStates.includes(j.status)))throw new SpotifyError('A download or import is already active. Finish or stop it first.',409);
  if(data?.action==='resume'){
   const job=await readJob(user.userId,data.id),manifest=manifestFor(userRoot,job.id);
   if(job.version!==2||!['cancelled','paused','partial','failed','import-failed'].includes(job.status))throw new SpotifyError('This job cannot be resumed.',409);
   if(await leaseBusy(manifest))throw new SpotifyError('This job is still stopping. Retry shortly.',409);
   await clearCancel(manifest);job.restarts=[];job.status='queued';job.message='';job.failures=[];
   if(job.rekordbox)job.rekordbox.error='';
   for(const t of job.tracks)if(t.state==='saved'&&t.importState!=='imported'){t.importState='queued';t.importError=''}
   for(const t of job.tracks)if(['failed','cancelled'].includes(t.state)){t.state='queued';t.error=''}
   job.runMode=job.membershipOnly||job.tracks.every((t:any)=>t.state==='saved')?'import':'download';
   await startWorker(manifest,job);return Response.json(summary(job),{headers:noStore});
  }
  const settings=await localSettingsStore().read(user.userId);
  if(!data?.action&&data.settingsRevision&&data.settingsRevision!==settings.revision)throw new SpotifyError('Download settings changed. Refresh this page before starting a download.',409);
  if(data?.action==='retry-import'){
   const job=await readJob(user.userId,data.id);if(job.version!==2||!job.sourcePlaylist||!job.tracks.some((t:any)=>t.state==='saved'))throw new SpotifyError('This job has no saved tracks with a source playlist. Start a new download.',400);
   job.rekordbox=await mappedDestination(user.userId,validateSourcePlaylist(job.sourcePlaylist),settings.libraryPath);job.autoImport=true;job.status='importing';job.imported=0;job.workerPid=null;job.updatedAt=Date.now();
   for(const track of job.tracks)if(track.state==='saved'){track.importState='queued';track.importError=''}
   const manifest=manifestFor(userRoot,job.id);if(await leaseBusy(manifest))throw new SpotifyError('This job is still stopping. Retry shortly.',409);
   await clearCancel(manifest);job.runMode='import';job.restarts=[];await startWorker(manifest,job);return Response.json(summary(job),{headers:noStore});
  }
  if(data?.action)throw new SpotifyError('Unknown download action.',400);
  const text=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<300&&!/[\x00-\x1f]/.test(v);
  if(!data||!Array.isArray(data.tracks)||data.tracks.length>50||!data.tracks.every((t:any)=>t&&((typeof t.videoId==='string'&&/^[A-Za-z0-9_-]{11}$/.test(t.videoId))||(t.acquisition==='reuse'&&typeof t.spotifyTrackId==='string'))&&(t.acquisition==='download'||t.acquisition==='reuse')&&(t.spotifyTrackId===undefined||(typeof t.spotifyTrackId==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(t.spotifyTrackId)))&&text(t.title)&&text(t.artist)&&(t.album===undefined||t.album===''||text(t.album))&&(t.durationMs===undefined||Number.isFinite(t.durationMs)&&t.durationMs>0&&t.durationMs<24*3600000)))throw new SpotifyError('Choose up to 50 valid YouTube matches.',400);
  let sourcePlaylist:SourcePlaylist;try{sourcePlaylist=validateSourcePlaylist(data.sourcePlaylist)}catch(e){throw new SpotifyError((e as Error).message,400)}
  const rekordbox=settings.autoImport?await mappedDestination(user.userId,sourcePlaylist,settings.libraryPath):null;
  let outputFolder:string;try{outputFolder=await validateDownloadFolder(settings.downloadFolder)}catch(e){throw new SpotifyError((e as Error).message+' Update your folder in Settings.',400)}
  if(!Array.isArray(data.additionalExistingIds)||data.additionalExistingIds.length>500||!data.additionalExistingIds.every((id:unknown)=>typeof id==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(id))||typeof data.sourceRevision!=='string'||!(/^[a-f0-9]{64}$/.test(data.sourceRevision)||data.sourceRevision==='none'))throw new SpotifyError('File check is out of date. Refresh Downloads before starting.',409);
  const destination=await stat(outputFolder);if(!scannedInventory||scannedInventory.folder!==outputFolder||scannedInventory.settingsRevision!==settings.revision||scannedInventory.identity.device!==String(destination.dev)||scannedInventory.identity.inode!==String(destination.ino))throw new SpotifyError('The download folder changed during the file check. Refresh Downloads before starting.',409);const source=await downloadSourceState(user.userId,sourcePlaylist.id);if(source.revision!==scannedInventory.sourceRevision)throw new SpotifyError('The source playlist changed since the file check. Refresh Downloads before starting.',409);request.signal.throwIfAborted();const prepared=scannedInventory.prepared;const id=randomUUID(),folder=join(userRoot,id);await mkdir(folder,{mode:0o700});
  const job={version:2,delivery:'folder',id,status:'queued',runMode:'download',requestKey:data.requestKey||randomUUID(),requestHash:requestHash(data),autoImport:settings.autoImport,imported:0,sourcePlaylist,rekordbox,outputFolder,destinationIdentity:{device:String(destination.dev),inode:String(destination.ino)},tracks:prepared.map((t:any)=>({operationId:randomUUID(),acquisition:t.acquisition,videoId:t.videoId,spotifyTrackId:t.spotifyTrackId||null,title:t.title,artist:t.artist,album:t.album||'',durationMs:t.durationMs||null,state:'queued',importState:settings.autoImport?'queued':null})),completed:0,failures:[],current:'',createdAt:Date.now(),updatedAt:Date.now(),ytdlp:process.env.YTDLP_PATH||'/opt/homebrew/bin/yt-dlp',ffmpeg:process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',ffprobe:process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe'};
  await startWorker(join(folder,'job.json'),job);return Response.json(summary(job),{headers:noStore});
 }finally{await unlock()}
 }catch(e){return apiError(e,'local')}}
export async function GET(request:Request){try{
 if(process.env.VERCEL)throw new SpotifyError('Downloads require the local app on your computer.',503);const user=await requireLocalUser();const q=new URL(request.url).searchParams;
 const userRoot=root(user.userId);await recoverAccount(userRoot).catch(()=>{});
 const job=q.has('id')?await readJob(user.userId,q.get('id')):(await jobsIn(userRoot)).find((j:any)=>activeStates.includes(j.status))||(await jobsIn(userRoot))[0];
 if(!job)return Response.json({job:null},{headers:noStore});
 if(q.get('file')==='1'){
  if(job.version===2)throw new SpotifyError('Your MP3s are saved directly to the download folder.',400);
  if(job.status!=='done')throw new SpotifyError('The legacy archive is not ready.',409);
  const archive=join(root(user.userId),job.id,'tracks.zip'),size=(await stat(archive)).size;
  return new Response(Readable.toWeb(createReadStream(archive)) as ReadableStream,{headers:{'Content-Length':String(size),...noStore,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="crate-tracks.zip"'}});
 }
 return Response.json(await visibleSummary(user.userId,job),{headers:noStore});
 }catch(e){return apiError(e,'local')}}
