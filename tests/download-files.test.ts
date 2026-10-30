import test from 'node:test';
import assert from 'node:assert/strict';
import {access,chmod,mkdir,mkdtemp,readFile,readdir,realpath,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
test('MP3 jobs tag and publish real audio, reuse verified recordings and never overwrite collisions or changed files',async t=>{
 const ffmpeg=process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',ffprobe=process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe';
 try{await access(ffmpeg);await access(ffprobe)}catch{t.skip('Local ffmpeg/ffprobe required');return}
 const root=await mkdtemp(join(tmpdir(),'crate-mp3-job-'));
 try{
  await mkdir(join(root,'Music'));const output=await realpath(join(root,'Music'));
  const info=await stat(output),sample=join(root,'sample.mp3');
  await run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-c:a','libmp3lame',sample]);
  const fake=join(root,'download-fixture.mjs');
  await writeFile(fake,`#!/usr/bin/env node\nimport {copyFile} from 'node:fs/promises';\nconst args=process.argv.slice(2);await copyFile(${JSON.stringify(sample)},args[args.indexOf('-o')+1].replace('%(ext)s','mp3'));\n`);await chmod(fake,0o700);
  let n=0;
  const track={videoId:'aaaaaaaaaaa',title:'Track / Original',artist:'Test Artist',album:'Test Album'};
  async function job(tracks:unknown[]){const folder=join(root,`job-${n++}`);await mkdir(folder);const manifest=join(folder,'job.json');
   await writeFile(manifest,JSON.stringify({version:2,delivery:'folder',id:`test-${n}`,status:'queued',outputFolder:output,destinationIdentity:{device:String(info.dev),inode:String(info.ino)},tracks,completed:0,failures:[],createdAt:Date.now(),ytdlp:fake,ffmpeg,ffprobe}));
   await run(process.execPath,['scripts/download-worker.mjs',manifest]);return JSON.parse(await readFile(manifest,'utf8'));}
  const first=await job([{...track}]);assert.equal(first.status,'done',JSON.stringify(first.failures));assert.equal(first.completed,1);
  const audio=first.tracks[0].path;const bytes=await readFile(audio);
  const {stdout}=await run(ffprobe,['-v','error','-show_entries','format_tags=title,artist,album','-of','json',audio]);
  assert.deepEqual(JSON.parse(stdout).format.tags,{title:track.title,artist:track.artist,album:track.album});
  assert.equal((await readdir(output)).some(n=>n.endsWith('.zip')),false);
  const collision=join(output,'Test Artist - Collision [bbbbbbbbbbb].mp3');await writeFile(collision,'user-owned');
  const second=await job([{...track},{...track,title:'Collision',videoId:'bbbbbbbbbbb'}]);
  assert.equal(second.status,'partial');assert.equal(second.tracks[0].reused,true);assert.equal(second.tracks[1].state,'failed');
  assert.deepEqual(await readFile(audio),bytes);assert.equal(await readFile(collision,'utf8'),'user-owned');
  // Rekordbox rewrites ID3 metadata without changing MPEG audio. A legacy
  // receipt must prove its old whole-file checksum before it can be upgraded.
  const receiptPath=join(output,'.crate-digger/recordings',track.videoId+'.json');
  const legacy=JSON.parse(await readFile(receiptPath,'utf8'));delete legacy.audioSha256;legacy.version=1;await writeFile(receiptPath,JSON.stringify(legacy));
  const tagged=join(root,'rekordbox-tags.mp3');
  await run(ffmpeg,['-v','error','-i',audio,'-map','0','-c','copy','-metadata','TKEY=10A','-id3v2_version','4',tagged]);
  const prefix=(b:Buffer)=>10+b.subarray(6,10).reduce((n,v)=>n*128+(v&127),0);
  const edited=await readFile(tagged),metadataOnly=Buffer.concat([edited.subarray(0,prefix(edited)),bytes.subarray(prefix(bytes))]);
  await writeFile(audio,metadataOnly);
  const afterTags=await job([{...track}]);assert.equal(afterTags.status,'done',JSON.stringify(afterTags.failures));assert.equal(afterTags.tracks[0].reused,true);
  assert.ok(JSON.parse(await readFile(receiptPath,'utf8')).audioSha256);assert.deepEqual(await readFile(audio),metadataOnly);
  await writeFile(audio,Buffer.concat([bytes,Buffer.from('changed')]));
  const third=await job([{...track}]);assert.equal(third.status,'failed');assert.match(third.tracks[0].error,/changed/);
  assert.deepEqual(await readFile(audio),Buffer.concat([bytes,Buffer.from('changed')]));
 }finally{await rm(root,{recursive:true,force:true})}
});
