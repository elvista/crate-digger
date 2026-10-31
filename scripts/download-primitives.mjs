import {open,realpath,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

export async function syncFolder(folder){const f=await open(folder,'r');try{await f.sync()}catch(e){if(!['EINVAL','ENOTSUP'].includes(e.code))throw e}finally{await f.close()}}
export async function saveJson(path,value){
 const temp=path+'.'+randomUUID()+'.tmp';
 try{const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync()}finally{await f.close()}
  await rename(temp,path);await syncFolder(join(path,'..'));
 }finally{await rm(temp,{force:true})}
}
export class DestinationError extends Error {constructor(message,code){super(message);this.code=code}}
export async function checkDestination(job){
 let folder,info;
 try{folder=await realpath(job.outputFolder);info=await stat(folder)}catch{throw new DestinationError('Download folder unavailable. Reconnect the original drive to resume.','destination_unavailable')}
 if(folder!==job.outputFolder||!info.isDirectory()||String(info.dev)!==job.destinationIdentity.device||String(info.ino)!==job.destinationIdentity.inode)throw new DestinationError('Waiting for the original download folder. Reconnect its drive; this job will not switch folders.','destination_changed');
 return folder;
}
export async function inspectMp3(path,ffprobe,signal){
 let data;try{const {stdout}=await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',path],{timeout:30000,maxBuffer:1000000,signal});data=JSON.parse(stdout)}catch{if(signal?.aborted)signal.throwIfAborted();throw new Error('MP3 verification failed. The output is missing or unreadable.')}
 const stream=data.streams?.find(s=>s.codec_type==='audio'&&s.codec_name==='mp3');
 const duration=Number(data.format?.duration),size=(await stat(path)).size;
 if(!stream||!Number.isFinite(duration)||duration<=0||size<100)throw new Error('MP3 verification failed. The output contains no playable audio.');
 return {durationMs:Math.round(duration*1000),size,sampleRate:Number(stream.sample_rate),channels:stream.channels,tags:data.format.tags||{}};
}
