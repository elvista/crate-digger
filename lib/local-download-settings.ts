import {homedir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import {mkdir,open,readFile,realpath,rename,rm,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
export type LocalDownloadSettings={version:1;revision:string;downloadFolder:string;libraryPath:string|null;autoImport:boolean};
export function defaultDownloadFolder(){return join(homedir(),'Music','Crate Digger')}
export async function validateDownloadFolder(value:unknown){
 if(typeof value!=='string'||!value.trim()||value.includes('\0')||value.length>4096)throw new Error('Choose a valid download folder.');
 const expanded=value.trim().replace(/^~(?=\/|$)/,homedir());
 if(!isAbsolute(expanded))throw new Error('Use an absolute folder path.');
 let folder:string;
 try{folder=await realpath(expanded);if(!(await stat(folder)).isDirectory())throw new Error();}
 catch{throw new Error('Folder unavailable. Choose an existing folder or reconnect its drive.');}
 const probe=join(folder,`.crate-write-check-${randomUUID()}`);
 try{const f=await open(probe,'wx',0o600);await f.close();}
 catch{throw new Error('This folder is not writable. Choose another folder.');}
 finally{await rm(probe,{force:true})}
 return folder;
}
export async function validateLibraryPath(value:unknown){
 if(value===null||value==='')return null;
 if(typeof value!=='string'||value.length>4096||value.includes('\0'))throw new Error('Use the full path to master.db.');
 const expanded=value.trim().replace(/^~(?=\/|$)/,homedir());
 if(!isAbsolute(expanded)||!expanded.endsWith('/master.db'))throw new Error('Use the full path to master.db.');
 try{const p=await realpath(expanded);if(!(await stat(p)).isFile())throw new Error();return p;}
 catch{throw new Error('Rekordbox database unavailable. Reconnect its drive or use automatic detection.');}
}
export function localSettingsStore(root=join(process.cwd(),'.data','local-settings')){
 const path=(owner:string)=>join(root,createHash('sha256').update(owner).digest('hex')+'.json');
 return {
  async read(owner:string):Promise<LocalDownloadSettings>{
   try{const d=JSON.parse(await readFile(path(owner),'utf8'));
    if(d.version!==1||typeof d.downloadFolder!=='string'||!isAbsolute(d.downloadFolder)||!(d.libraryPath===null||typeof d.libraryPath==='string'))throw new Error('Saved local settings are invalid.');
    return {version:1,revision:typeof d.revision==='string'?d.revision:'legacy',downloadFolder:d.downloadFolder,libraryPath:d.libraryPath,autoImport:d.autoImport!==false};
   }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {version:1,revision:'default',downloadFolder:defaultDownloadFolder(),libraryPath:null,autoImport:true};}
  },
  async save(owner:string,input:{downloadFolder:unknown;libraryPath:unknown;autoImport?:unknown}):Promise<LocalDownloadSettings>{
   const settings:LocalDownloadSettings={version:1,revision:randomUUID(),downloadFolder:await validateDownloadFolder(input.downloadFolder),libraryPath:await validateLibraryPath(input.libraryPath),autoImport:input.autoImport!==false};
   await mkdir(root,{recursive:true,mode:0o700});
   const temp=resolve(root,`.${randomUUID()}.tmp`);
   try{const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify(settings));await f.sync()}finally{await f.close()}
    await rename(temp,path(owner));const dir=await open(root,'r');try{await dir.sync()}finally{await dir.close()}
   }finally{await rm(temp,{force:true})}
   return settings;
  }
 };
}
