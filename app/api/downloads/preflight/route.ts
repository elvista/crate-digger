import {downloadSourceState} from '@/lib/download-source-snapshot';
import {mkdir,stat,rm} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {requireLocalUser,requireOrigin,apiError,noStore} from '@/lib/route-auth';
import {SpotifyError} from '@/lib/spotify';
import {localSettingsStore,validateDownloadFolder} from '@/lib/local-download-settings';
import {jobsIn} from '@/scripts/download-runtime.mjs';
import {recordingLock,saveJson} from '@/scripts/download-files.mjs';
import {recordingInventory,resolveRecording,confirmRecording} from '@/scripts/download-index.mjs';
const progress=new Map<string,{owner:string;scanned:number;total:number;phase:string}>();
export async function GET(request:Request){try{if(process.env.VERCEL)throw new SpotifyError('Open the local app to check downloaded files.',503);const user=await requireLocalUser(),id=new URL(request.url).searchParams.get('scanId');if(!id||!/^[a-f0-9-]{36}$/.test(id))throw new SpotifyError('Invalid file check.',400);const state=progress.get(id);if(!state||state.owner!==user.userId)throw new SpotifyError('File check not found.',404);return Response.json({scanned:state.scanned,total:state.total,phase:state.phase},{headers:noStore})}catch(e){return apiError(e,'local')}}
export async function POST(request:Request){try{
 if(process.env.VERCEL)throw new SpotifyError('Open the local app to check downloaded files.',503);
 requireOrigin(request);const user=await requireLocalUser();const body=await request.text();if(Buffer.byteLength(body)>2000000)throw new SpotifyError('Request too large.',400);let data:any;try{data=JSON.parse(body)}catch{throw new SpotifyError('Could not read the file-check request.',400)}
 if(!data||!Array.isArray(data.tracks)||data.tracks.length>5000||!data.tracks.every((t:any)=>t&&typeof t.id==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(t.id)&&typeof t.title==='string'&&!!t.title.trim()&&t.title.length<300&&!/[\x00-\x1f]/.test(t.title)&&typeof t.artist==='string'&&!!t.artist.trim()&&t.artist.length<300&&!/[\x00-\x1f]/.test(t.artist)&&Number.isFinite(t.durationMs)&&t.durationMs>0&&t.durationMs<24*60*60*1000))throw new SpotifyError('Invalid source tracks.',400);
 if(data.playlistId!==undefined&&(typeof data.playlistId!=='string'||!/^[A-Za-z0-9]{22}$/.test(data.playlistId)))throw new SpotifyError('Choose a valid Spotify playlist.',400);
 if(data.confirm&&(!/^spotify:[A-Za-z0-9]{22}$/.test(data.confirm.id)||typeof data.confirm.filename!=='string'||data.confirm.filename.length>300||basename(data.confirm.filename)!==data.confirm.filename||!data.confirm.filename.toLowerCase().endsWith('.mp3')))throw new SpotifyError('Choose a valid existing recording.',400);
 const settings=await localSettingsStore().read(user.userId);if(data.settingsRevision&&data.settingsRevision!==settings.revision)throw new SpotifyError('Download settings changed. Refresh this page before checking files.',409);const outputFolder=await validateDownloadFolder(settings.downloadFolder),info=await stat(outputFolder);const job={signal:request.signal,outputFolder,destinationIdentity:{device:String(info.dev),inode:String(info.ino)},ffprobe:process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe',ffmpeg:process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg'};
 const scanId=typeof data.scanId==='string'&&/^[a-f0-9-]{36}$/.test(data.scanId)?data.scanId:null;if(scanId)progress.set(scanId,{owner:user.userId,scanned:0,total:0,phase:'starting'});
 const privateRoot=join(outputFolder,'.crate-digger');await mkdir(join(privateRoot,'recordings'),{recursive:true,mode:0o700});await mkdir(join(privateRoot,'locks'),{recursive:true,mode:0o700});const lock=join(privateRoot,'locks','acquisition');
 try{
 const inventory=await recordingInventory(job,await jobsIn(join(process.cwd(),'.data/downloads',createHash('sha256').update(user.userId).digest('hex'))),({scanned,total}:{scanned:number;total:number})=>{if(scanId)progress.set(scanId,{owner:user.userId,scanned,total,phase:'scanning'})});
 await recordingLock(lock);
 try{
 for(const receipt of inventory.receipts)await saveJson(join(privateRoot,'recordings',receipt.videoId+'.json'),receipt);
 if(data.confirm){const t=data.tracks.find((t:any)=>t.id===data.confirm.id);if(!t)throw new SpotifyError('Select a matching source track.',400);const receipt=await confirmRecording(job,{...t,spotifyTrackId:t.id},data.confirm.filename,inventory);await saveJson(join(privateRoot,'recordings',receipt.videoId+'.json'),receipt);inventory.receipts=inventory.receipts.filter(r=>r.filename!==receipt.filename);inventory.receipts.push(receipt);delete (inventory.scans as Record<string,unknown>)[receipt.filename]}
 await saveJson(join(privateRoot,'index.json'),inventory);
 const items=[];for(const track of data.tracks){request.signal.throwIfAborted();const r=await resolveRecording(job,{...track,spotifyTrackId:track.id},inventory);items.push({id:track.id,...r,recording:r.recording?{videoId:r.recording.videoId,filename:r.recording.filename,recordingId:r.recording.recordingId||`file:${r.recording.filename}`}:undefined})}
 const source=await downloadSourceState(user.userId,data.playlistId),additionalExistingIds:string[]=[],seenRecordings=new Set(items.filter(i=>i.status==='available'&&i.recording).map(i=>i.recording!.recordingId));for(const t of source.items){request.signal.throwIfAborted();if(data.tracks.some((r:any)=>r.id===t.id))continue;const r=await resolveRecording(job,{...t,spotifyTrackId:t.id},inventory);if(r.status==='available'){const key=r.recording.recordingId||`file:${r.recording.filename}`;if(!seenRecordings.has(key)){seenRecordings.add(key);additionalExistingIds.push(t.id)}}}return Response.json({items,additionalExisting:additionalExistingIds.length,additionalExistingIds,sourceRevision:source.revision,sourceComplete:source.complete,inventoryWarnings:inventory.warnings.slice(0,10),folder:outputFolder},{headers:noStore});
 }finally{await rm(lock,{recursive:true,force:true})}
 }finally{if(scanId)progress.delete(scanId)}
 }catch(e){return apiError(e instanceof SpotifyError?e:new SpotifyError((e as Error).message||'Could not check local files.',409),'local')}}
