import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {verifySavedTrack} from './download-files.mjs';
import {markCancelled,pendingImport} from './download-runtime.mjs';
function bridge(manifest){
 return new Promise((resolve,reject)=>{
  const child=execFile(join(process.cwd(),'.data/rekordbox/venv/bin/python'),[join(process.cwd(),'scripts/rekordbox/bridge.py')],{timeout:180000,maxBuffer:2000000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout)=>{
   try{const response=JSON.parse(stdout);if(!response.ok){const e=new Error(response.error);e.code=response.code;throw e}if(error)throw error;resolve(response.result)}catch(e){if(!e.code)e.message='The Rekordbox import stopped. Your MP3s are safe; retry the import.';reject(e)}
  });child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify({action:'import-job',jobPath:manifest}));
 });
}
export async function importSavedTracks(manifest,job,save,{cancelled,wait,backoff,destinationReady}){
 let attempt=0;
 while(true){
  const finishing=await cancelled()&&await pendingImport(manifest);
  if(await cancelled()&&!finishing){markCancelled(job);await save();return}
  if(!finishing&&!await destinationReady()){if(await pendingImport(manifest))continue;markCancelled(job);await save();return}
  job.status='importing';job.current=job.sourcePlaylist?.name||'';job.rekordbox.status='importing';job.rekordbox.error='';job.message='';job.nextRetryAt=null;
  for(const t of job.tracks)if(t.state==='saved'&&t.importState!=='imported')t.importState='importing';
  await save();
  try{
   for(const track of job.tracks)if(track.state==='saved'&&!job.membershipOnly){try{await verifySavedTrack(job,track)}catch{/* Python reports individual file failures without dropping valid tracks. */}}
   const result=await bridge(manifest);
   for(const item of result.tracks){for(const t of job.tracks.filter(t=>item.operationId?t.operationId===item.operationId:t.videoId===item.videoId)){t.importState=item.state;t.importError=item.error||'';if(item.contentId)t.contentId=item.contentId}}
   job.imported=job.tracks.filter(t=>t.importState==='imported').length;
   job.rekordbox.destination=result.destination;job.rekordbox.backupId=result.backupId;job.rekordbox.journalPath=result.journalPath;
   job.rekordbox.status=result.verified?'imported':'failed';
   job.status=job.imported===0?'import-failed':job.failures.length||!result.verified?'partial':'done';
   if(await cancelled())markCancelled(job);
   job.current='';await save();return;
  }catch(e){
   const finishing=await cancelled()&&await pendingImport(manifest);
   if(e.code==='cancelled'||(await cancelled()&&!finishing)){markCancelled(job);await save();return}
   if(['rekordbox_running','writer_busy','library_unavailable'].includes(e.code)){
    job.status=e.code==='library_unavailable'?'waiting-drive':'waiting';job.current='';job.rekordbox.status='waiting';job.rekordbox.error=e.message;job.message=finishing?'Finishing an already committed import before stopping. '+e.message:e.message;
    for(const t of job.tracks)if(t.state==='saved'&&t.importState!=='imported')t.importState='waiting';
    const delay=backoff(attempt++);job.nextRetryAt=Date.now()+delay;
    await save();if(!await wait(delay,{ignoreCancel:finishing})){if(await pendingImport(manifest))continue;markCancelled(job);await save();return}continue;
   }
   job.status=e.code==='needs_destination'?'needs-destination':'import-failed';job.current='';job.rekordbox.status='failed';job.rekordbox.error=e.message;
   for(const t of job.tracks)if(t.state==='saved'&&t.importState!=='imported'){t.importState='failed';t.importError=e.message}
   await save();return;
  }
 }
}
