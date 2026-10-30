import 'server-only';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createTextStore} from './text-store';
import {appConfig,seal,unseal} from './spotify-session';
import type {Track} from './catalog';
export type RecordingMappings={get:(id:string)=>Promise<Track[]|null>;set:(id:string,tracks:Track[])=>Promise<void>};
export function recordingMappings(owner:string):RecordingMappings{
 const storage=createTextStore(join(process.cwd(),'.data/mappings'),'mappings');const {clientId,secret}=appConfig();
 const key=(id:string)=>`${createHash('sha256').update(`${clientId}:${owner}:${id}`).digest('hex')}.json`;
 return{
 async get(id){const raw=await storage.read(key(id));const data=unseal<{expiresAt:number;tracks:Track[]}>(raw??undefined,secret,1000000);return data&&data.expiresAt>Date.now()?data.tracks:null},
 async set(id,tracks){await storage.write(key(id),seal({expiresAt:Date.now()+24*3600000,tracks},secret))}
 };
}
