import {mkdir,readFile,writeFile,rename,rm,readdir,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {get,put,del,list} from '@vercel/blob';
export class StoreLockedError extends Error{}
export type TextStore={remote:boolean;read:(key:string)=>Promise<string|null>;write:(key:string,value:string)=>Promise<void>;lock:(key:string)=>Promise<()=>Promise<void>>;prune?:(before:number)=>Promise<void>};
/** Private origin reads preserve receipt/lock consistency across serverless instances. */
export function createTextStore(root:string,namespace:string):TextStore{
 const remote=!!process.env.BLOB_READ_WRITE_TOKEN;
 if(process.env.VERCEL&&!remote)throw new Error('Private storage is not configured for this deployment.');
 const key=(name:string)=>{if(!/^[a-zA-Z0-9_./-]+$/.test(name)||name.includes('..')||name.startsWith('/'))throw new Error('Invalid storage key');return remote?`crate-digger/${namespace}/${name}`:join(root,name)};
 if(!remote)return{remote:false,
  async read(name){try{return await readFile(key(name),'utf8')}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}},
  async write(name,value){const path=key(name);await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,value,{mode:0o600});await rename(temp,path)},
  async lock(name){const path=key(`${name}.lock`);await mkdir(dirname(path),{recursive:true,mode:0o700});try{await mkdir(path,{mode:0o700})}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new StoreLockedError('A save is already running. Retry shortly.');throw e}return async()=>{await rm(path,{recursive:true,force:true})}},
  async prune(before){try{for(const name of(await readdir(root)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,200)){const path=join(root,name);if((await stat(path)).mtimeMs<before)await rm(path,{force:true})}}catch{}},
 };
 const read=async(name:string)=>{const result=await get(key(name),{access:'private',useCache:false});if(!result)return null;if(result.statusCode!==200)throw new Error('Unreadable storage response');return {text:await new Response(result.stream).text(),etag:result.blob.etag}};
 return{remote:true,
  async read(name){return(await read(name))?.text??null},
  async write(name,value){await put(key(name),value,{access:'private',allowOverwrite:true,addRandomSuffix:false,contentType:'application/json',cacheControlMaxAge:60})},
  async lock(name){const pathname=key(`${name}.lock`),prior=await read(`${name}.lock`);if(prior&&JSON.parse(prior.text).expiresAt>Date.now())throw new StoreLockedError('A save is already running. Retry shortly.');
   let claimed;try{claimed=await put(pathname,JSON.stringify({token:randomUUID(),expiresAt:Date.now()+600000}),{access:'private',addRandomSuffix:false,...(prior?{ifMatch:prior.etag,allowOverwrite:true}:{allowOverwrite:false}),cacheControlMaxAge:60})}catch{throw new StoreLockedError('A save is already running or storage is temporarily unavailable. Retry shortly.')}
   return async()=>{await del(pathname,{ifMatch:claimed.etag})};
  },
  async prune(before){const page=await list({prefix:`crate-digger/${namespace}/`,limit:200});const expired=page.blobs.filter(blob=>blob.uploadedAt.getTime()<before).map(blob=>blob.url);if(expired.length)await del(expired)},
 };
}
