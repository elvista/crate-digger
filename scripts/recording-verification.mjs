/** Verify unchanged MPEG bytes even when Rekordbox has rewritten ID3 tags. */
import {open,stat,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
async function id3Prefix(path){
 const file=await open(path,'r');
 try{
  const header=Buffer.alloc(10);await file.read(header,0,10,0);
  if(header.toString('ascii',0,3)!=='ID3')return Buffer.alloc(0);
  if(![3,4].includes(header[3])||(header[3]===4&&(header[5]&16)))throw new Error('This MP3 metadata layout cannot be verified safely.');
  const size=10+header.subarray(6,10).reduce((n,v)=>n*128+(v&127),0);
  if(size>1000000||size>(await file.stat()).size)throw new Error('Invalid MP3 metadata size.');
  const prefix=Buffer.alloc(size);await file.read(prefix,0,size,0);return prefix;
 }finally{await file.close()}
}
async function hash(path,{prefix=Buffer.alloc(0),start=0,end}={}){
 const h=createHash('sha256');h.update(prefix);
 for await(const bytes of createReadStream(path,{start,end}))h.update(bytes);
 return h.digest('hex');
}
export async function audioHash(path){
 const prefix=await id3Prefix(path),size=(await stat(path)).size;
 let end=size-1;
 if(size>=128){const f=await open(path,'r');try{const tag=Buffer.alloc(3);await f.read(tag,0,3,size-128);if(tag.toString()==='TAG')end-=128}finally{await f.close()}}
 if(end<prefix.length)throw new Error('The MP3 has no audio data.');
 return hash(path,{start:prefix.length,end});
}
async function originalReceiptMatches(path,prior,job){
 if(!prior.audio?.tags||!prior.sha256)return false;
 // A legacy receipt has no MPEG checksum. Rebuild its exact historical ID3
 // prefix, then prove the original WHOLE file checksum with current audio bytes.
 // Never infer identity from duration, title or a new checksum alone.
 const stage=await mkdtemp(join(job.outputFolder,'.crate-digger','verify-'));
 try{
  const copy=join(stage,'tags.mp3');
  const metadata=Object.entries(prior.audio.tags).flatMap(([k,v])=>['-metadata',`${k}=${v}`]);
  await run(job.ffmpeg,['-nostdin','-v','error','-i',path,'-map','0','-c','copy','-map_metadata','-1',...metadata,'-id3v2_version','3',copy],{timeout:30000,maxBuffer:1000000});
  const prefix=await id3Prefix(copy),current=await id3Prefix(path);
  return await hash(path,{prefix,start:current.length})===prior.sha256;
 }catch{return false}finally{await rm(stage,{recursive:true,force:true})}
}
export async function verifiedReceipt(path,prior,job){
 const whole=await hash(path),audio=await audioHash(path);
 if(whole!==prior.sha256){
  const matches=prior.audioSha256?audio===prior.audioSha256:await originalReceiptMatches(path,prior,job);
  if(!matches)throw new Error('The existing MP3 audio changed or cannot be verified. It has been left untouched.');
 }
 return {...prior,version:2,sha256:whole,audioSha256:audio};
}
