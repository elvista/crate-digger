import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileLock} from '../scripts/download-runtime.mjs';

const run=promisify(execFile);
/** A browser-compatible copy; the Rekordbox original is never modified. */
export async function browserMp3(path:string,source:Awaited<ReturnType<typeof stat>>,root=join(process.cwd(),'.data/rekordbox-audio')){
 const id=createHash('sha256').update(JSON.stringify([path,source.dev,source.ino,source.size,source.mtimeMs])).digest('hex');
 const target=join(root,`${id}.mp3`);
 await mkdir(root,{recursive:true,mode:0o700});
 const ready=async()=>{try{const info=await stat(target);return info.isFile()&&info.size>100?info:null}catch{return null}};
 if(await ready())return target;
 const release=await fileLock(join(root,`${id}.lock`));
 try{
  if(await ready())return target;
  const temporary=join(root,`${id}.${randomUUID()}.mp3`);
  try{
   await run(process.env.FFMPEG_PATH||'/opt/homebrew/bin/ffmpeg',['-nostdin','-v','error','-i',path,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k','-y',temporary],{timeout:180000,maxBuffer:1000000});
   if(!(await stat(temporary)).size)throw new Error('No playable audio was produced.');
   const after=await stat(path);if(after.dev!==source.dev||after.ino!==source.ino||after.size!==source.size||after.mtimeMs!==source.mtimeMs)throw new Error('The source recording changed during playback preparation.');
   await rename(temporary,target);
  }finally{await rm(temporary,{force:true})}
  return target;
 }finally{await release()}
}
