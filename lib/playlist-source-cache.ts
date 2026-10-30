import {createHash} from 'node:crypto';
import type {Track} from './catalog.ts';
import type {TextStore} from './text-store.ts';
export type PlaylistSource={tracks:Track[];truncated:boolean};
export type PlaylistSourceCache={get:(id:string,snapshot:string)=>Promise<PlaylistSource|null>;set:(id:string,snapshot:string,value:PlaylistSource)=>Promise<void>};
/** Only completed, snapshot-validated playlist reads enter this private cache. */
export function createPlaylistSourceCache(storage:TextStore,scope:string):PlaylistSourceCache{
 const key=(id:string,snapshot:string)=>`${createHash('sha256').update(`${scope}:${id}:${snapshot}`).digest('hex')}.json`;
 return{
 async get(id,snapshot){if(!snapshot)return null;const raw=await storage.read(key(id,snapshot));if(!raw)return null;const entry=JSON.parse(raw);return entry.expiresAt>Date.now()?entry.value:null},
 async set(id,snapshot,value){if(snapshot)await storage.write(key(id,snapshot),JSON.stringify({expiresAt:Date.now()+24*3600000,value}))}
 };
}
