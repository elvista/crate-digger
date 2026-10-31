import 'server-only';
import {execFile} from 'node:child_process';
import {join} from 'node:path';
export type RekordboxStatus={
  schemaSupported:boolean; missing:string[]; libraryPath:string; discoverySource:string;
  usingOverride?:boolean; overrideMatchesActiveLibrary?:boolean; versions:string[]; tracks?:number; playlists?:number; libraryId?:string;
  blockingProcesses:string[]|null; processCheckError:string|null;
  installedLibraryWritesEnabled:boolean; stage:'connected';
};
export async function rekordboxRequest<T>(action:'health'|'playlists'|'source-tracks'|'content-file'|'match-content',data:Record<string,unknown>={}):Promise<T>{
 if(process.env.VERCEL)throw new Error('Rekordbox requires the local app on your Mac.');
 return new Promise((resolve,reject)=>{
  const child=execFile(join(process.cwd(),'.data/rekordbox/venv/bin/python'),[join(process.cwd(),'scripts/rekordbox/bridge.py')],
   {timeout:20000,maxBuffer:2000000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout)=>{
    if((error as NodeJS.ErrnoException)?.code==='ENOENT'){reject(new Error('Set up the local Rekordbox connector first.'));return;}
    try{const response=JSON.parse(stdout);if(!response.ok)throw new Error(response.error||'Rekordbox connection failed.');if(error)throw new Error('Rekordbox connection failed.');resolve(response.result);}
    catch(e){reject(e instanceof SyntaxError?new Error('Could not inspect the local Rekordbox library.'):e)}
   });
  child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify({...data,action}));
 });
}
export async function rekordboxStatus(libraryPath:string|null=null):Promise<RekordboxStatus>{return rekordboxRequest('health',{libraryPath})}
