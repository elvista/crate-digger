import 'server-only';
import {join} from 'node:path';
import {createTextStore} from './text-store';
import {seal,unseal,appConfig} from './spotify-session';
import type {MatchingState} from './cosine-core';
export {matchingRevision} from './matching-revision';
export function matchingJobStore(){
 const storage=createTextStore(join(process.cwd(),'.data/matching'),'matching'),secret=appConfig().secret;
 const valid=(id:string)=>/^[a-f0-9-]{36}$/.test(id);
 return{
 async read(owner:string,id:string){if(!valid(id))return null;const raw=await storage.read(`${id}.json`);const value=unseal<{owner:string;expiresAt:number;state:MatchingState}>(raw??undefined,secret,16000000);return value&&value.owner===owner&&value.expiresAt>Date.now()?value.state:null},
 async write(owner:string,id:string,state:MatchingState){if(!valid(id))throw new Error('Invalid matching job');await storage.write(`${id}.json`,seal({owner,expiresAt:Date.now()+12*3600000,state},secret))},
 async lock(id:string){if(!valid(id))throw new Error('Invalid matching job');return storage.lock(id)}
 };
}
