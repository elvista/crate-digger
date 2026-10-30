import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),manifest=process.argv[2],root=dirname(manifest);
const job=JSON.parse(await readFile(manifest,'utf8'));
const save=async()=>{job.updatedAt=Date.now();const temp=manifest+'.tmp';await writeFile(temp,JSON.stringify(job),{mode:0o600});await rename(temp,manifest)};
const files=[];job.status='running';await save();
for(let i=0;i<job.tracks.length;i++){
 const track=job.tracks[i];job.current=`${track.artist} — ${track.title}`;await save();
 const name=`${String(i+1).padStart(2,'0')} - ${track.artist} - ${track.title}`.normalize('NFKC').replace(/[^\p{L}\p{N} ._()-]/gu,'_').slice(0,60);
 try{await run(job.ytdlp,['--ignore-config','--no-playlist','--no-warnings','--socket-timeout','20','--retries','1','--max-filesize','100M','--match-filter','duration <= 1800','-x','--audio-format','mp3','--audio-quality','0','--ffmpeg-location',job.ffmpeg,'-o',join(root,name+'.%(ext)s'),'--',`https://www.youtube.com/watch?v=${track.videoId}`],{timeout:180000,maxBuffer:2000000});await stat(join(root,name+'.mp3'));files.push(name+'.mp3');job.completed++;}catch{job.failures.push(`${track.artist} — ${track.title}: unavailable, restricted, or conversion failed.`)}await save();
}
if(files.length){try{await run('/usr/bin/zip',['-q','-0',join(root,'tracks.zip'),'--',...files],{cwd:root,timeout:60000,maxBuffer:1000000});job.status='done'}catch{job.status='failed';job.failures.push('Could not create the ZIP archive.')}}else job.status='failed';job.current='';await save();
