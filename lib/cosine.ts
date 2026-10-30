import 'server-only';
import { CosineError, type ProviderRead } from './cosine-core';

// Local process budget + a bounded TTL cache. No audio, Spotify tokens or playlists are sent.
const cache=new Map<string,{expires:number;value:unknown}>();
let windowStarted=0, requests=0,blockedUntil=0;
export function createCosineReader(signal?:AbortSignal): ProviderRead {
  const key=process.env.COSINE_API_KEY?.trim();
  if(!key)throw new CosineError('Add COSINE_API_KEY to the server environment to enable cosine.club audio similarity. Get a key at cosine.club/account/api.',503);
  return async(path,options):Promise<unknown>=>{
    if(!(options?.method==='POST'?path==='search/bulk':/^(search\?|tracks\/[a-zA-Z0-9_-]{1,100}\/similar\?)/.test(path)))throw new CosineError('Invalid cosine.club request.',400);
    signal?.throwIfAborted();
    const cacheKey=`${options?.method||'GET'}:${path}:${options?JSON.stringify(options.body):''}`;
    const now=Date.now(),hit=cache.get(cacheKey);if(hit&&hit.expires>now)return hit.value;
    if(now-windowStarted>=60000){windowStarted=now;requests=0}
    if(now<blockedUntil||requests>=100)throw new CosineError('cosine.club is busy. Wait a minute and try again.',429,String(Math.max(1,Math.ceil((Math.max(blockedUntil,windowStarted+60000)-now)/1000))));
    requests++;
    let response:Response;
    try {response=await fetch(`https://cosine.club/api/v1/${path}`,{method:options?.method||'GET',body:options?JSON.stringify(options.body):undefined,headers:{...(options?{'Content-Type':'application/json'}:{}),Authorization:`Bearer ${key}`,'User-Agent':'Crate/0.1 (music discovery)',Accept:'application/json'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(options?45000:12000)]):AbortSignal.timeout(options?45000:12000),redirect:'error',cache:'no-store'});}
    catch {if(signal?.aborted)throw new CosineError('Generation cancelled.',499);throw new CosineError('cosine.club could not be reached. Try again.');}
    if(response.status===401||response.status===403)throw new CosineError('cosine.club rejected the API key. Check COSINE_API_KEY in the server environment.',503);
    if(response.status===429){const raw=response.headers.get('retry-after');const retry=raw&&/^\d{1,6}$/.test(raw)?raw:'60';blockedUntil=Date.now()+Number(retry)*1000;throw new CosineError('cosine.club rate limit reached. Please try again later.',429,retry);}
    if(response.status===404)throw new CosineError('This track is unavailable on cosine.club.',404);
    if(!response.ok)throw new CosineError('cosine.club is temporarily unavailable. Try again.');
    let value:unknown;try{value=await response.json()}catch{throw new CosineError('cosine.club returned an unreadable response. Try again.');}
    if(!value||typeof value!=='object'||(value as {success?:boolean}).success!==true)throw new CosineError('cosine.club returned an unsuccessful response. Try again.');
    if(cache.size>=500)cache.delete(cache.keys().next().value!);cache.set(cacheKey,{expires:Date.now()+60*60*1000,value});return value;
  };
}
