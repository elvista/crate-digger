import {readFile} from 'node:fs/promises';
import {downloadTrack,saveJson,checkDestination} from './download-files.mjs';
import {importSavedTracks} from './rekordbox-import.mjs';
import {cancellation,markCancelled,pendingImport} from './download-runtime.mjs';
const manifest=process.argv[2];
const job=JSON.parse(await readFile(manifest,'utf8'));
let writes=Promise.resolve();
const save=()=>{writes=writes.catch(()=>{}).then(async()=>{job.updatedAt=Date.now();await saveJson(manifest,job)});return writes};
let heartbeat;
const cancelled=async()=>!!await cancellation(manifest);
// Check controls once a second while backing off, without stopping an in-flight commit.
const wait=async(ms,{ignoreCancel=false}={})=>{const until=Date.now()+ms;while(Date.now()<until){if(!ignoreCancel&&await cancelled())return false;await new Promise(r=>setTimeout(r,Math.min(1000,until-Date.now())))}return ignoreCancel||!await cancelled()};
const backoff=attempt=>Math.min(120000,15000*2**Math.min(attempt,3));
async function destinationReady(){
 let attempt=0;
 while(true){
  if(await cancelled())return false;
  try{await checkDestination(job);job.nextRetryAt=null;job.message='';return true}
  catch(e){if(!['destination_unavailable','destination_changed'].includes(e.code))throw e;
   job.status='waiting-drive';job.current='';job.message=e.message;const delay=backoff(attempt++);job.nextRetryAt=Date.now()+delay;await save();
   if(!await wait(delay))return false;
  }
 }
}
try{
 if(job.version!==2||job.delivery!=='folder')throw new Error('This job predates direct MP3 downloads. Start a new download.');
 job.workerPid=process.pid;job.message='';
 heartbeat=setInterval(()=>{void save().catch(()=>{})},15000);
 await save();
 if(job.runMode!=='import'&&!process.argv.includes('--import-only')){
  job.status='running';job.failures=[];job.completed=job.tracks.filter(t=>t.state==='saved').length;await save();
  for(let index=0;index<job.tracks.length;index++){
   const track=job.tracks[index];
   if(await cancelled())break;
   if(track.state==='failed')continue; // Explicit Resume enables retries of known failures.
   if(!await destinationReady())break;
   job.status='running';job.current=`${track.artist} — ${track.title}`;
   const wasSaved=track.state==='saved';
   try{
    const result=await downloadTrack(job,track,async state=>{track.state=state;await save()});
    Object.assign(track,{state:'saved',filename:result.filename,path:result.path,reused:result.reused,audio:result.audio,error:''});
   }catch(e){
    try{await checkDestination(job)}catch(drive){e=drive}
    if(['destination_unavailable','destination_changed'].includes(e.code)){track.state=wasSaved?'saved':'queued';if(await destinationReady()){index--;await save();continue}}
    else{track.state='failed';track.error=e instanceof Error?e.message:'Download failed.'}
   }
   job.completed=job.tracks.filter(t=>t.state==='saved').length;await save();
  }
  job.failures=job.tracks.filter(t=>t.state==='failed').map(t=>`${t.artist} — ${t.title}: ${t.error}`);
 }
 if(await cancelled()&&job.autoImport&&await pendingImport(manifest)){job.rekordbox??={};await importSavedTracks(manifest,job,save,{cancelled,wait,backoff,destinationReady})}
 else if(await cancelled())markCancelled(job);
 else if(job.autoImport&&job.tracks.some(t=>t.state==='saved')&&await destinationReady()){
  job.rekordbox??={status:'unavailable'};
  await importSavedTracks(manifest,job,save,{cancelled,wait,backoff,destinationReady});
 }else if(await cancelled()){
  if(job.autoImport&&await pendingImport(manifest)){job.rekordbox??={};await importSavedTracks(manifest,job,save,{cancelled,wait,backoff,destinationReady})}else markCancelled(job);
 }
 else job.status=job.failures.length?(job.completed?'partial':'failed'):'done';
}catch(e){job.status=job.completed&&job.autoImport?'import-failed':'failed';job.message=e instanceof Error?e.message:'The local worker stopped.';}
finally{clearInterval(heartbeat);job.current='';job.nextRetryAt=null;await save()}
