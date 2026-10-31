import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,stat,realpath,link,rm,rename,access,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {downloadTrack,recordingName,saveJson} from '../scripts/download-files.mjs';
import {launchWorker,leaseBusy,recoverAccount,requestCancel,clearCancel,readJson,reusableRequest,accountLock,validJob,jobsIn} from '../scripts/download-runtime.mjs';
const run=promisify(execFile),ffmpeg='/opt/homebrew/bin/ffmpeg',ffprobe='/opt/homebrew/bin/ffprobe';
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(check:()=>Promise<any>){for(let i=0;i<150;i++){const result=await check();if(result)return result;await sleep(100)}throw new Error('Fixture worker did not reach its expected state')}
async function fixture(t:any){
 try{await access(ffmpeg);await access(ffprobe);await access('.data/rekordbox/venv/bin/python')}catch{t.skip('Local MP3/worker tools required');return}
 const root=await mkdtemp(join(tmpdir(),'crate-recovery-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const output=join(await realpath(root),'Music');await mkdir(output);const info=await stat(output),sample=join(root,'sample.mp3');
 await run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-c:a','libmp3lame',sample]);
 const track={videoId:'aaaaaaaaaaa',title:'Fixture',artist:'Fixture Artist',state:'queued'};
 const account=join(root,'account');await mkdir(account);
 async function job(tracks=[{...track}]){const id=randomUUID(),folder=join(account,id);await mkdir(folder);const manifest=join(folder,'job.json');const j:any={version:2,delivery:'folder',id,status:'queued',autoImport:false,runMode:'download',sourcePlaylist:{id:'fixture',name:'Fixture'},outputFolder:output,destinationIdentity:{device:String(info.dev),inode:String(info.ino)},tracks,completed:0,failures:[],createdAt:Date.now()-20000,updatedAt:Date.now()-20000,ytdlp:join(root,'must-not-download'),ffmpeg,ffprobe};await saveJson(manifest,j);return {manifest,j}}
 return {root,output,info,sample,track,account,job};
}
test('persisted job validation keeps legacy ZIP jobs while excluding corrupt active manifests',async t=>{
 const folder=await mkdtemp(join(tmpdir(),'crate-job-schema-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 const legacyId=randomUUID(),badId=randomUUID();await mkdir(join(folder,legacyId));await mkdir(join(folder,badId));
 const legacy={id:legacyId,status:'done',createdAt:Date.now(),tracks:[{videoId:'abcdefghijk'}]};
 const invalid={version:2,id:badId,status:'running',createdAt:Date.now(),tracks:[{videoId:'abcdefghijk',state:'queued'}],outputFolder:'/tmp',destinationIdentity:{device:0,inode:0}};
 await writeFile(join(folder,legacyId,'job.json'),JSON.stringify(legacy));await writeFile(join(folder,badId,'job.json'),JSON.stringify(invalid));
 assert.equal(validJob(legacy,legacyId),true);assert.equal(validJob(invalid,badId),false);assert.deepEqual((await jobsIn(folder)).map(j=>j.id),[legacyId]);
});
test('restart recovers a published MP3 from its inode/hash intent without downloading or overwriting a collision',async t=>{
 const f=await fixture(t);if(!f)return;
 const {manifest,j}=await f.job();const privateRoot=join(f.output,'.crate-digger'),receipts=join(privateRoot,'recordings'),stage='stage-'+randomUUID();await mkdir(receipts,{recursive:true});await mkdir(join(privateRoot,stage));
 const staged=join(privateRoot,stage,'tagged.mp3'),filename=recordingName(f.track),target=join(f.output,filename),bytes=await readFile(f.sample);await writeFile(staged,bytes);const inode=await stat(staged),sha256=createHash('sha256').update(bytes).digest('hex');
 const pending={videoId:f.track.videoId,filename,sha256,stage,device:String(inode.dev),inode:String(inode.ino),receipt:{version:1,videoId:f.track.videoId,filename,sha256}};
 await saveJson(join(receipts,f.track.videoId+'.pending.json'),pending);await link(staged,target);await rm(join(privateRoot,stage),{recursive:true});
 j.status='running';j.tracks[0].state='verifying';await saveJson(manifest,j);
 await recoverAccount(f.account);
 const completed=await until(async()=>{const job=await readJson(manifest);return job.status==='done'&&job});
 assert.equal(completed.completed,1);assert.equal(completed.tracks[0].reused,true);assert.deepEqual(await readFile(target),bytes);assert.equal(await leaseBusy(manifest),false);
 // The same bytes in a different inode do not establish ownership.
 await rm(join(receipts,f.track.videoId+'.json'));await saveJson(join(receipts,f.track.videoId+'.pending.json'),pending);
 await writeFile(target+'.replacement',bytes);await rename(target+'.replacement',target);
 await assert.rejects(downloadTrack(j,f.track),/differs/);assert.deepEqual(await readFile(target),bytes);
});
test('OS leases prevent concurrent workers; Stop keeps the current MP3 and Resume reuses it before continuing',async t=>{
 const f=await fixture(t);if(!f)return;
 const counter=join(f.root,'downloads.txt'),release=join(f.root,'release-download'),fake=join(f.root,'fixture-download.mjs');
 await writeFile(fake,`#!/usr/bin/env node\nimport {copyFile,appendFile} from 'node:fs/promises';\nimport {existsSync} from 'node:fs';\nconst args=process.argv.slice(2);await appendFile(${JSON.stringify(counter)},'download\\n');const until=Date.now()+15000;while(!existsSync(${JSON.stringify(release)})&&Date.now()<until)await new Promise(r=>setTimeout(r,50));if(!existsSync(${JSON.stringify(release)}))throw new Error('fixture release was not signaled');await copyFile(${JSON.stringify(f.sample)},args[args.indexOf('-o')+1].replace('%(ext)s','mp3'));`);await chmod(fake,0o700);
 const {manifest,j}=await f.job([{...f.track},{...f.track,videoId:'bbbbbbbbbbb',title:'Second'}]);j.ytdlp=fake;await launchWorker(manifest,j);
 await until(async()=>{try{return (await readFile(counter,'utf8')).length>0}catch{const state=await readJson(manifest);if(['done','failed','partial','paused','cancelled'].includes(state.status))throw new Error(`Worker exited before starting acquisition: ${state.status} ${state.message||''} ${JSON.stringify(state.failures||[])}`);return false}});
 assert.equal(await leaseBusy(manifest),true);
 // Launch a contender directly without modifying the running manifest.
 await run('.data/rekordbox/venv/bin/python',['scripts/download-runner.py',process.execPath,manifest]).then(()=>assert.fail('Second worker took a held lease'),e=>assert.equal(e.code,3));
 await requestCancel(manifest);await writeFile(release,'continue');
 const stopped=await until(async()=>{const job=await readJson(manifest);return job.status==='cancelled'&&job});
 assert.equal(stopped.completed,1);assert.equal(stopped.tracks[1].state,'cancelled');assert.equal((await readFile(counter,'utf8')).trim().split('\n').length,1);
 await until(async()=>!await leaseBusy(manifest));await clearCancel(manifest);stopped.status='queued';stopped.tracks[1].state='queued';await launchWorker(manifest,stopped);
 const done=await until(async()=>{const job=await readJson(manifest);return job.status==='done'&&job});
 assert.equal(done.completed,2);assert.equal(done.tracks[0].reused,true);assert.equal((await readFile(counter,'utf8')).trim().split('\n').length,2);
 await until(async()=>!await leaseBusy(manifest));
 const unlock=await accountLock(f.account);try{await assert.rejects(accountLock(f.account),/Another download/)}finally{await unlock()}
});
test('drive waits are cancellable, stopped jobs stay stopped, and recovery backoff/idempotency are bounded',async t=>{
 const f=await fixture(t);if(!f)return;
 const {manifest,j}=await f.job();await rename(f.output,f.output+'-offline');await launchWorker(manifest,j);
 const waiting=await until(async()=>{const job=await readJson(manifest);return job.status==='waiting-drive'&&job});
 assert.equal(waiting.outputFolder,j.outputFolder);assert.ok(waiting.nextRetryAt>Date.now());
 // Simulate an actual worker exit while blocked, then run the startup scanner.
 process.kill(waiting.workerPid,'SIGKILL');await until(async()=>!await leaseBusy(manifest));
 await recoverAccount(f.account,{now:Date.now()+20000});
 const recovered=await until(async()=>{const job=await readJson(manifest);return job.status==='waiting-drive'&&job.workerPid!==waiting.workerPid&&job});
 assert.notEqual(recovered.workerPid,waiting.workerPid);await requestCancel(manifest);
 await until(async()=>(await readJson(manifest)).status==='cancelled');await until(async()=>!await leaseBusy(manifest));
 let launches=0;await recoverAccount(f.account,{launch:async()=>{launches++}});assert.equal(launches,0);
 await rename(f.output+'-offline',f.output);
 const paused={...j,status:'running',launchedAt:Date.now()-20000,restarts:[Date.now()-3000,Date.now()-2000,Date.now()-1000]};await clearCancel(manifest);await saveJson(manifest,paused);
 await recoverAccount(f.account,{launch:async()=>{launches++}});assert.equal((await readJson(manifest)).status,'paused');assert.equal(launches,0);
 const prior={requestKey:'same',requestHash:'selection',id:'original'};assert.equal(reusableRequest([prior],'same','selection')?.id,'original');assert.throws(()=>reusableRequest([prior],'same','other'),/different selection/);assert.equal(reusableRequest([],'same','selection'),undefined);
});
