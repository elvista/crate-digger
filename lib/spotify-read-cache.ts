import {createHash,randomUUID} from 'node:crypto';
import type {TextStore} from './text-store.ts';
const flights=new Map<string,Promise<any>>();
type Options={method?:'GET'|'PUT'|'POST';body?:string;fresh?:boolean};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'?v as Record<string,unknown>:{};
/** Account-scoped reuse; playback and writes always reach the provider. */
export function createSpotifyReadCache(storage:TextStore,scope:string,api:(path:string,options:Options)=>Promise<any>){
 const prefix=createHash('sha256').update(scope).digest('hex');
 const key=(value:string)=>`${prefix}/${createHash('sha256').update(value).digest('hex')}.json`;
 const epochKey=`${prefix}/library-epoch.json`;
 async function epoch(){return await storage.read(epochKey)||'initial'}
 async function put(name:string,value:unknown,ttl:number){await storage.write(key(name),JSON.stringify({expiresAt:Date.now()+ttl,value}))}
 async function get(name:string){const raw=await storage.read(key(name));if(!raw)return null;const data=JSON.parse(raw);return data.expiresAt>Date.now()?data:null}
 async function warm(value:unknown){
  const v=object(value),tracks=object(v.tracks);
  const values=Array.isArray(tracks.items)?tracks.items:Array.isArray(v.items)?v.items:[value];
  const unique=new Map<string,Record<string,unknown>>();
  for(const entry of values){const e=object(entry),t=object(e.item??e.track??e);
   if(typeof t.id==='string'&&/^[A-Za-z0-9]{22}$/.test(t.id)&&typeof t.name==='string'&&typeof t.duration_ms==='number'&&Array.isArray(t.artists)&&Array.isArray(object(t.album).images)&&t.type!=='episode'&&!t.is_local)unique.set(t.id,t);
  }
  await Promise.all([...unique].map(([id,t])=>put(`tracks/${id}`,t,24*3600000)));
 }
 return async function request(path:string,options:Options={}){
  const method=options.method||'GET';
  const mutatesLibrary=method!=='GET'&&(path==='me/playlists'||/^playlists\/[A-Za-z0-9]{22}(?:\/|$)/.test(path));
  if(mutatesLibrary)await storage.write(epochKey,randomUUID());
  try{
   if(method!=='GET')return await api(path,options);
   let name:string|null=null,ttl=0;
   if(/^me\/playlists\?/.test(path)){name=`library:${await epoch()}:${path}`;ttl=30000}
   else if(/^tracks\/[A-Za-z0-9]{22}$/.test(path)){name=path;ttl=24*3600000}
   else if(path.startsWith('search?')){const q=new URLSearchParams(path.slice(7));q.sort();name=`search?${q}`;ttl=24*3600000}
   if(name&&!options.fresh){const hit=await get(name);if(hit)return hit.value}
   const load=async()=>{
    const value=await api(path,options);
    if(name){const empty=Array.isArray(object(object(value).tracks).items)&&!(object(object(value).tracks).items as unknown[]).length;await put(name,value,empty?30*60000:ttl)}
    await warm(value);return value;
   };
   if(!name||options.fresh)return await load();
   const flightKey=`${prefix}:${name}`;const pending=flights.get(flightKey);if(pending)return await pending;
   const flight=load();flights.set(flightKey,flight);
   try{return await flight}finally{flights.delete(flightKey)}
  }finally{
   // Invalidate even ambiguous write failures: the provider may have accepted the write.
   if(mutatesLibrary)await storage.write(epochKey,randomUUID());
  }
 };
}
