import {defaultRekordboxDestination} from '@/lib/rekordbox-default';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname,basename} from 'node:path';
import {stat,mkdir} from 'node:fs/promises';
import {requireLocalUser,requireOrigin,apiError,noStore} from '@/lib/route-auth';
import {rekordboxRequest} from '@/lib/rekordbox';
import {localSettingsStore} from '@/lib/local-download-settings';
import {SpotifyError} from '@/lib/spotify';
import {accountLock,activeStates,jobsIn,launchWorker,manifestFor,leaseBusy,clearCancel} from '@/scripts/download-runtime.mjs';
function userRoot(owner:string){return join(process.cwd(),'.data/downloads',createHash('sha256').update(owner).digest('hex'))}
export async function GET(request:Request){try{if(process.env.VERCEL)throw new SpotifyError('Rekordbox saving requires the local app.',403);const user=await requireLocalUser(),operationId=new URL(request.url).searchParams.get('operationId');if(!operationId||!/^[a-f0-9-]{36}$/.test(operationId))throw new SpotifyError('Invalid save operation.',400);const job=(await jobsIn(userRoot(user.userId))).find(j=>j.membershipOperation===operationId);if(!job)throw new SpotifyError('Playlist update not found.',404);return Response.json({id:job.id,status:job.status,trackId:job.membershipTrackId||null,rekordbox:job.rekordbox?{status:job.rekordbox.status,error:job.rekordbox.error||''}:null,message:job.message||''},{headers:noStore})}catch(e){return apiError(e,'local')}}
export async function POST(request:Request){try{
 if(process.env.VERCEL)throw new SpotifyError('Rekordbox saving requires the local app.',403);requireOrigin(request);const user=await requireLocalUser();const text=await request.text();if(text.length>6000)throw new SpotifyError('Request too large.',400);let data:any;try{data=JSON.parse(text)}catch{throw new SpotifyError('Could not read the Rekordbox save request.',400)}const track=data?.track;
 const finds=data.mode==='finds';
 if((!finds&&!/^rekordbox:\d+$/.test(data.playlistId))||!/^[a-f0-9-]{36}$/.test(data.operationId)||!track||typeof track.id!=='string'||!/^(?:rekordbox:\d+|spotify:[A-Za-z0-9]{22})$/.test(track.id)||typeof track.title!=='string'||track.title.length>299||typeof track.artist!=='string'||track.artist.length>299||!Number.isFinite(track.durationMs))throw new SpotifyError('Choose a recording and Rekordbox playlist.',400);
 const settings=await localSettingsStore().read(user.userId),library=await rekordboxRequest<{libraryId:string;libraryPath:string;playlists:any[]}>('playlists',{libraryPath:settings.libraryPath});const chosen=finds?null:library.playlists.find(p=>p.id===data.playlistId.slice(10)&&p.attribute===0);if(!finds&&!chosen)throw new SpotifyError('Choose an ordinary Rekordbox playlist.',400);const destination=finds?defaultRekordboxDestination(library.playlists):{mode:'existing',id:chosen.id,name:chosen.name,path:chosen.path};
 if(track.id.startsWith('rekordbox:')&&track.localLibraryId!==library.libraryId)throw new SpotifyError('Reload your Rekordbox sources before saving to this library.',409);
 const record=await rekordboxRequest<{id:string;path:string;title:string;artist:string;album:string}> (track.id.startsWith('rekordbox:')?'content-file':'match-content',{libraryPath:library.libraryPath,contentId:track.id.slice(10),title:track.title,artist:track.artist,durationMs:track.durationMs});
 const root=userRoot(user.userId),unlock=await accountLock(root);
 try{const jobs=await jobsIn(root),prior=jobs.find(j=>j.membershipOperation===data.operationId);if(prior){if(prior.tracks[0].contentId!==record.id||(finds?!prior.defaultRekordboxPlaylist:prior.rekordbox.destination.id!==chosen.id))throw new SpotifyError('Save request conflicts with an earlier operation.',409);
  if(['failed','partial','import-failed','needs-destination','cancelled','paused'].includes(prior.status)){
   if(jobs.some(j=>j.id!==prior.id&&activeStates.includes(j.status)))throw new SpotifyError('Another download or library update is running. Finish or stop it first.',409);
   if(prior.rekordbox?.libraryId!==library.libraryId||prior.rekordbox?.libraryPath!==library.libraryPath)throw new SpotifyError('The Rekordbox library changed. Reload your local sources and save again.',409);
   const manifest=manifestFor(root,prior.id);if(await leaseBusy(manifest))throw new SpotifyError('The previous update is still stopping. Retry shortly.',409);
   await clearCancel(manifest);prior.status='queued';prior.runMode='import';prior.message='';prior.failures=[];prior.restarts=[];prior.tracks[0].path=record.path;prior.tracks[0].filename=basename(record.path);prior.tracks[0].importState='queued';prior.tracks[0].importError='';if(prior.rekordbox){prior.rekordbox.destination=destination;prior.rekordbox.status='mapped';prior.rekordbox.error=''}
   await launchWorker(manifest,prior);
  }
  return Response.json({id:prior.id},{headers:noStore})}if(jobs.some(j=>activeStates.includes(j.status)))throw new SpotifyError('Another download or library update is running. Finish or stop it first.',409);
 const id=randomUUID(),folder=join(root,id);await mkdir(folder,{mode:0o700});const outputFolder=dirname(library.libraryPath),info=await stat(outputFolder);
 const job={version:2,delivery:'folder',membershipOnly:true,defaultRekordboxPlaylist:finds,membershipOperation:data.operationId,membershipTrackId:track.id,id,status:'queued',runMode:'import',autoImport:true,sourcePlaylist:{id:finds?'rekordbox:0':data.playlistId,name:destination.name},rekordbox:{libraryId:library.libraryId,libraryPath:library.libraryPath,destination},outputFolder,destinationIdentity:{device:String(info.dev),inode:String(info.ino)},tracks:[{state:'saved',contentId:record.id,path:record.path,filename:basename(record.path),videoId:'local'+record.id.padStart(6,'0').slice(-6),title:record.title,artist:record.artist,album:record.album,importState:'queued'}],completed:1,imported:0,failures:[],createdAt:Date.now(),updatedAt:Date.now()};
 await launchWorker(manifestFor(root,id),job);return Response.json({id},{headers:noStore});
 }finally{await unlock()}
}catch(e){return apiError(e instanceof SpotifyError?e:new SpotifyError(e instanceof Error?e.message:'Could not update the Rekordbox playlist.',409),'local')}}
