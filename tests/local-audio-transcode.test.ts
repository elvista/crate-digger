import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {browserMp3} from '../lib/local-audio-transcode.ts';
import {inspectMp3} from '../scripts/download-primitives.mjs';
const run=promisify(execFile);
test('browser fallback creates a seekable MP3 copy without changing a Rekordbox original',async t=>{
 const ffmpeg=process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',ffprobe=process.env.FFPROBE_PATH||'/opt/homebrew/bin/ffprobe';
 try{await access(ffmpeg);await access(ffprobe);await access('.data/rekordbox/venv/bin/python')}catch{t.skip('Local audio tools required');return}
 const root=await mkdtemp(join(tmpdir(),'crate-audio-fallback-'));
 try{const original=join(root,'original.wav');await run(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2',original]);const before=await readFile(original),info=await stat(original);
  const copy=await browserMp3(original,info,join(root,'cache'));assert.notEqual(copy,original);assert.ok((await inspectMp3(copy,ffprobe)).durationMs>0);
  assert.equal(await browserMp3(original,info,join(root,'cache')),copy);assert.deepEqual(await readFile(original),before);
 }finally{await rm(root,{recursive:true,force:true})}
});
