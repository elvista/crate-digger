/** Local durable job orchestration, shared by routes, startup recovery and workers. */
import {mkdir,readFile,readdir,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {saveJson} from './download-files.mjs';
const run=promisify(execFile);
export const activeStates=['queued','running','importing','waiting','waiting-drive','recovering','stopping'];
export const persist=saveJson;
export const manifestFor=(folder,id)=>join(folder,id,'job.json');
export async function readJson(path){return JSON.parse(await readFile(path,'utf8'))}
export async function jobsIn(folder){
 let entries;try{entries=await readdir(folder)}catch(e){if(e.code==='ENOENT')return [];throw e}
 const jobs=[];
 for(const id of entries){if(!/^[a-f0-9-]{36}$/.test(id))continue;try{const job=await readJson(manifestFor(folder,id));if(job.id===id)jobs.push(job)}catch{}}
 return jobs.sort((a,b)=>b.createdAt-a.createdAt);
}
export async function accountLock(folder){
 await mkdir(folder,{recursive:true,mode:0o700});return fileLock(join(folder,'.admission-flock'));
}
export async function fileLock(path){
 const child=spawn(join(process.cwd(),'.data/rekordbox/venv/bin/python'),[join(process.cwd(),'scripts/download-runner.py'),'--file-lock',path],{stdio:['pipe','pipe','ignore']});
 child.stdin.on('error',()=>{});
 const closed=new Promise(resolve=>child.once('close',resolve));
 try{await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Local job lock timed out. Retry shortly.')),10000);
  child.stdout.once('data',()=>{clearTimeout(timer);resolve()});
  child.once('error',()=>{clearTimeout(timer);reject(new Error('Local worker support is unavailable. Check Settings.'))});
  child.once('close',()=>{clearTimeout(timer);reject(new Error('Another download action is being processed. Retry shortly.'))});
 })}catch(e){child.stdin.end();throw e}
 return async()=>{child.stdin.end();await closed};
}
export async function leaseBusy(manifest){
 try{await run(join(process.cwd(),'.data/rekordbox/venv/bin/python'),[join(process.cwd(),'scripts/download-runner.py'),'--probe',manifest],{timeout:10000});return false}
 catch(e){if(e.code===3)return true;throw new Error('Could not check the local worker lock. Your saved files are safe.')}
}
export async function cancellation(manifest){try{return await readJson(join(dirname(manifest),'cancel.json'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
export async function pendingImport(manifest){
 try{const journal=await readJson(join(process.cwd(),'.data/rekordbox/imports',createHash('sha256').update(manifest).digest('hex')+'.json'));return ['prepared','database-committed'].includes(journal.state)}catch(e){if(e.code==='ENOENT')return false;throw e}
}
export async function requestCancel(manifest){await persist(join(dirname(manifest),'cancel.json'),{requestedAt:Date.now()})}
export async function clearCancel(manifest){await rm(join(dirname(manifest),'cancel.json'),{force:true})}
export function markCancelled(job){
 job.status='cancelled';job.current='';job.nextRetryAt=null;job.message='Stopped. Saved MP3s and completed imports have been kept.';
 for(const t of job.tracks)if(t.state!=='saved'&&t.state!=='failed')t.state='cancelled';
}
export async function launchWorker(manifest,job){
 job.launchedAt=Date.now();job.updatedAt=Date.now();job.workerPid=null;await persist(manifest,job);
 // Python holds an OS flock for the worker lifetime, including after a server restart.
 const child=spawn(join(process.cwd(),'.data/rekordbox/venv/bin/python'),[join(process.cwd(),'scripts/download-runner.py'),process.execPath,manifest],{detached:true,stdio:'ignore'});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
}
export async function recoverAccount(folder,{launch=launchWorker,busy=leaseBusy,now=Date.now()}={}){
 const unlock=await accountLock(folder);
 try{
  const jobs=await jobsIn(folder),pending=jobs.filter(j=>j.version===2&&activeStates.includes(j.status));
  // Never edit a running worker's manifest. All control requests use sidecar files.
  for(const job of pending)if(await busy(manifestFor(folder,job.id)))return;
  for(const job of pending.reverse()){
   const manifest=manifestFor(folder,job.id);
   if(await cancellation(manifest)&&!await pendingImport(manifest)){markCancelled(job);await persist(manifest,job);continue}
   if(now-(job.launchedAt||job.updatedAt||job.createdAt)<10000)return;
   const attempts=(job.restarts||[]).filter(t=>now-t<300000);
   if(attempts.length>=3){job.status='paused';job.message='Recovery stopped after repeated worker exits. Review the error and choose Resume.';await persist(manifest,job);continue}
   job.restarts=[...attempts,now];job.status='recovering';job.message='Resuming unfinished work. Saved files will be verified and reused.';
   await launch(manifest,job);return;
  }
 }finally{await unlock()}
}
export async function recoverAll(root=join(process.cwd(),'.data/downloads')){
 let owners;try{owners=await readdir(root)}catch(e){if(e.code==='ENOENT')return;throw e}
 for(const owner of owners){if(!/^[a-f0-9]{64}$/.test(owner))continue;try{await recoverAccount(join(root,owner))}catch{/* One locked/unavailable account must not block another. */}}
}
export function reusableRequest(jobs,key,hash){
 const prior=jobs.find(j=>j.requestKey===key);
 if(prior&&prior.requestHash!==hash)throw new Error('This request key was already used for a different selection.');
 return prior;
}

export async function assertRekordboxCanOpen(root=join(process.cwd(),'.data/downloads'),pending=pendingImport){
 let owners;try{owners=await readdir(root)}catch(e){if(e.code==='ENOENT')return;throw e}
 for(const owner of owners){
  if(!/^[a-f0-9]{64}$/.test(owner))continue;
  for(const job of await jobsIn(join(root,owner))){
   if((job.autoImport&&activeStates.includes(job.status))||await pending(manifestFor(join(root,owner),job.id)))throw new Error('Finish or stop pending imports before opening Rekordbox.');
  }
 }
}
