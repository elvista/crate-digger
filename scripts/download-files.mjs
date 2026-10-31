import {mkdir,open,readFile,stat,lstat,link,rm} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {recordingInventory,resolveRecording} from './download-index.mjs';
import {verifiedReceipt,audioHash} from './recording-verification.mjs';
import {saveJson,checkDestination,inspectMp3,syncFolder} from './download-primitives.mjs';
export {saveJson,checkDestination,inspectMp3,DestinationError} from './download-primitives.mjs';
const run=promisify(execFile);
async function digest(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex')}
export function recordingName(track){
 let clean=`${track.artist} - ${track.title}`.normalize('NFKC').replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,100).replace(/[. ]+$/,'')||'Track';
 while(Buffer.byteLength(clean,'utf8')>180)clean=Array.from(clean).slice(0,-1).join('');
 return `${clean} [${track.videoId}].mp3`;
}
export async function recordingLock(path){
 for(let attempt=0;attempt<2;attempt++){
  try{await mkdir(path,{mode:0o700});await saveJson(join(path,'owner.json'),{pid:process.pid,createdAt:Date.now()});return}
  catch(e){
   if(e.code!=='EEXIST')throw e;
   let owner;try{owner=JSON.parse(await readFile(join(path,'owner.json'),'utf8'))}catch{}
   let active=false;if(Number.isInteger(owner?.pid)){try{process.kill(owner.pid,0);active=true}catch(e){active=e.code==='EPERM'}}
   const age=Date.now()-(owner?.createdAt||(await stat(path)).mtimeMs);
   if(!active&&age>1000){await rm(path,{recursive:true,force:true});continue}
   throw Object.assign(new Error('The download folder is being checked or updated. Trying again shortly.'),{code:'acquisition_busy'});
  }
 }
 throw new Error('Could not acquire the recording download lock. Retry shortly.');
}
async function recoverPublication(folder,privateRoot,track,ffprobe,receiptPath){
 const pendingPath=join(privateRoot,'recordings',track.videoId+'.pending.json');
 let pending;try{pending=JSON.parse(await readFile(pendingPath,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw new Error('The pending recording receipt is unreadable. Review the saved file before retrying.')}
 if(pending.videoId!==track.videoId||typeof pending.filename!=='string'||basename(pending.filename)!==pending.filename||!pending.filename.endsWith('.mp3')||!/^[a-f0-9]{64}$/.test(pending.sha256)||!/^stage-[a-f0-9-]{36}$/.test(pending.stage))throw new Error('Invalid pending recording receipt.');
 const target=join(folder,pending.filename),staged=join(privateRoot,pending.stage,'tagged.mp3');
 async function owned(path){
  let info;try{info=await lstat(path)}catch(e){if(e.code==='ENOENT')return false;throw e}
  if(!info.isFile()||String(info.dev)!==pending.device||String(info.ino)!==pending.inode||await digest(path)!==pending.sha256)throw new Error('The pending MP3 differs from the verified download. It has been left untouched.');
  return true;
 }
 if(!await owned(target)){
  if(!await owned(staged)){await rm(pendingPath,{force:true});return null}
  await inspectMp3(staged,ffprobe);
  await link(staged,target);await syncFolder(folder);
 }
 const audio=await inspectMp3(target,ffprobe);
 await saveJson(receiptPath,{...pending.receipt,audio});
 await rm(pendingPath,{force:true});
 await rm(join(privateRoot,pending.stage),{recursive:true,force:true});
 return {filename:pending.filename,path:target,reused:true,recovered:true,audio};
}
export async function downloadTrack(job,track,onStage=async()=>{},batchInventory=null){
 const folder=await checkDestination(job),privateRoot=join(folder,'.crate-digger');
 await mkdir(join(privateRoot,'recordings'),{recursive:true,mode:0o700});
 await mkdir(join(privateRoot,'locks'),{recursive:true,mode:0o700});
 const lock=join(privateRoot,'locks','acquisition');
 await recordingLock(lock);
 let stage;
 try{
  if(track.videoId){const recovered=await recoverPublication(folder,privateRoot,track,job.ffprobe,join(privateRoot,'recordings',track.videoId+'.json'));if(recovered)return recovered}
  const inventory=batchInventory||await recordingInventory(job);const existing=await resolveRecording(job,track,inventory);
  if(existing.status==='available'){const r=existing.recording;track.videoId=r.videoId;await saveJson(join(privateRoot,'recordings',r.videoId+'.json'),{...r,spotifyIds:[...new Set([...r.spotifyIds,track.spotifyTrackId].filter(Boolean))]});return {filename:r.filename,path:join(folder,r.filename),reused:true,audio:r.audio}}
  if(existing.status!=='missing')throw new Error(existing.message);
  if(track.acquisition==='reuse')throw new Error('The existing recording is missing. Refresh the playlist before downloading.');
  const receiptPath=join(privateRoot,'recordings',track.videoId+'.json');
  let prior;try{prior=JSON.parse(await readFile(receiptPath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw new Error('The saved recording receipt is unreadable. Choose a different folder or repair the receipt.');}
  if(prior){
   if(prior.videoId!==track.videoId||typeof prior.filename!=='string'||basename(prior.filename)!==prior.filename||!prior.filename.endsWith('.mp3'))throw new Error('Invalid saved recording receipt.');
   const path=join(folder,prior.filename);
   if(!(await lstat(path)).isFile())throw new Error('The saved MP3 is no longer a regular file. It has been left untouched.');
   await onStage('verifying');const audio=await inspectMp3(path,job.ffprobe);
   const verified=await verifiedReceipt(path,prior,job);
   await saveJson(receiptPath,verified);
   return {filename:prior.filename,path,reused:true,audio};
  }
  const recovered=await recoverPublication(folder,privateRoot,track,job.ffprobe,receiptPath);
  if(recovered)return recovered;
  const filename=recordingName(track),target=join(folder,filename);
  // Only an inode/hash-backed pending publication can reclaim a file.
  // Unknown user files are never adopted or overwritten.
  try{await stat(target);throw new Error('An MP3 with this filename already exists without a receipt. It has been left untouched.');}catch(e){if(e.code!=='ENOENT')throw e}
  stage=join(privateRoot,'stage-'+randomUUID());await mkdir(stage,{mode:0o700});
  const audioPath=join(stage,'audio.mp3'),tagged=join(stage,'tagged.mp3');
  await onStage('downloading');
  try{await run(job.ytdlp,['--ignore-config','--no-playlist','--no-warnings','--socket-timeout','20','--retries','1','--max-filesize','100M','--match-filter','duration <= 1800','-x','--audio-format','mp3','--audio-quality','0','--ffmpeg-location',job.ffmpeg,'-o',join(stage,'audio.%(ext)s'),'--',`https://www.youtube.com/watch?v=${track.videoId}`],{timeout:180000,maxBuffer:2000000});}
  catch{throw new Error('YouTube download or MP3 conversion failed. Retry this track.');}
  await onStage('tagging');
  try{await run(job.ffmpeg,['-nostdin','-v','error','-i',audioPath,'-map','0','-c','copy','-map_metadata','0','-metadata',`title=${track.title}`,'-metadata',`artist=${track.artist}`,...(track.album?['-metadata',`album=${track.album}`]:[]),'-id3v2_version','3',tagged],{timeout:30000,maxBuffer:1000000});}
  catch{throw new Error('Could not write the MP3 title, artist and album tags.');}
  await onStage('verifying');const audio=await inspectMp3(tagged,job.ffprobe);
  const sha256=await digest(tagged);
  const handle=await open(tagged,'r');try{await handle.sync()}finally{await handle.close()}
  await checkDestination(job);
  const audioSha256=await audioHash(tagged);const info=await stat(tagged),receipt={version:2,recordingId:`audio:${audioSha256}`,audioSha256,spotifyIds:track.spotifyTrackId?[track.spotifyTrackId]:[],videoId:track.videoId,filename,sha256,title:track.title,artist:track.artist,album:track.album||'',audio,savedAt:Date.now()};
  const pendingPath=join(privateRoot,'recordings',track.videoId+'.pending.json');
  await saveJson(pendingPath,{videoId:track.videoId,filename,sha256,stage:basename(stage),device:String(info.dev),inode:String(info.ino),receipt});
  // Same-filesystem hard-link publication is atomic and refuses replacement.
  // Never fall back to a rename that can clobber a user's existing recording.
  try{await link(tagged,target)}catch(e){if(e.code==='EEXIST')throw new Error('An MP3 with this filename already exists. It has been left untouched.');if(['EPERM','ENOTSUP','EOPNOTSUPP'].includes(e.code))throw new Error('This drive cannot publish MP3s safely. Choose a folder on your Mac’s APFS drive in Settings.');throw e}
  await syncFolder(folder);
  await saveJson(receiptPath,receipt);
  await rm(pendingPath,{force:true});
  return {filename,path:target,reused:false,audio};
 }finally{if(stage)await rm(stage,{recursive:true,force:true});await rm(lock,{recursive:true,force:true})}
}

export async function verifySavedTrack(job,track){
 const folder=await checkDestination(job),receiptPath=join(folder,'.crate-digger/recordings',track.videoId+'.json');
 const prior=JSON.parse(await readFile(receiptPath,'utf8'));
 if(prior.videoId!==track.videoId||typeof prior.filename!=='string'||basename(prior.filename)!==prior.filename||join(folder,prior.filename)!==track.path||!(await lstat(track.path)).isFile())throw new Error('Invalid saved recording identity.');
 await inspectMp3(track.path,job.ffprobe);await saveJson(receiptPath,await verifiedReceipt(track.path,prior,job));
}
