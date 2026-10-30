import {createHash} from 'node:crypto';
import {StoreLockedError,type TextStore} from './text-store.ts';
export class ProviderPausedError extends Error{status=429;retryAfter:string;constructor(seconds:number){super('Spotify is temporarily busy. Please wait before trying again.');this.retryAfter=String(Math.max(1,Math.ceil(seconds)))}}
export function retrySeconds(raw:string|null,now=Date.now()){if(raw&&/^\d+$/.test(raw))return Math.max(1,Number(raw));const date=raw?Date.parse(raw):NaN;return Number.isFinite(date)?Math.max(1,Math.ceil((date-now)/1000)):60;}
/** Lock plus persisted cooldown covers every server instance using these credentials. */
export function createProviderCache(storage:TextStore,scope:string,policy?:{limit:number;windowMs:number}){
 const prefix=createHash('sha256').update(scope).digest('hex');
 return async function cached<T>(key:string|null,ttl:number,load:()=>Promise<T>):Promise<T>{
  const name=key?`${prefix}/${createHash('sha256').update(key).digest('hex')}.json`:null;
  if(name){const hit=await storage.read(name);if(hit){const entry=JSON.parse(hit);if(entry.expiresAt>Date.now())return entry.value}}
  let release:(()=>Promise<void>)|undefined;const deadline=Date.now()+15000;
  while(!release){try{release=await storage.lock(`${prefix}/requests`)}catch(e){if(!(e instanceof StoreLockedError))throw e;if(Date.now()>=deadline)throw new ProviderPausedError(1);await new Promise(resolve=>setTimeout(resolve,100))}}
  try{
   const raw=await storage.read(`${prefix}/cooldown.json`),until=raw?Number(JSON.parse(raw).until):0;
   if(until>Date.now())throw new ProviderPausedError((until-Date.now())/1000);
   if(policy){
    const rawBudget=await storage.read(`${prefix}/budget.json`);const calls:number[]=rawBudget?JSON.parse(rawBudget).calls:[];
    const recent=calls.filter(time=>time>Date.now()-policy.windowMs);
    if(recent.length>=policy.limit)throw new ProviderPausedError((recent[0]+policy.windowMs-Date.now())/1000);
    await storage.write(`${prefix}/budget.json`,JSON.stringify({calls:[...recent,Date.now()]}));
   }
   try{const value=await load();
    const v=value as {tracks?:{items?:unknown[]};data?:unknown[]};const empty=Array.isArray(v?.tracks?.items)&&!v.tracks.items.length||Array.isArray(v?.data)&&!v.data.length;
    if(name)await storage.write(name,JSON.stringify({expiresAt:Date.now()+(empty?Math.min(ttl,30*60000):ttl),value}));return value}

   catch(e){const err=e as {status?:number;retryAfter?:string};if(err.status===429)await storage.write(`${prefix}/cooldown.json`,JSON.stringify({until:Date.now()+retrySeconds(err.retryAfter??null)*1000}));throw e}
  }finally{await release()}
 };
}
