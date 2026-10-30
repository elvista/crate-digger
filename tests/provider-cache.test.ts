import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTextStore} from '../lib/text-store.ts';
import {createProviderCache,ProviderPausedError,retrySeconds} from '../lib/provider-cache.ts';
test('persisted cooldown stops another instance and cache hits still work without requests',async()=>{
 assert.equal(retrySeconds('67227'),67227);assert.equal(retrySeconds(new Date(120000).toUTCString(),60000),60);assert.equal(retrySeconds('invalid'),60);
 const root=await mkdtemp(join(tmpdir(),'crate-cooldown-'));try{
 const cache=createProviderCache(createTextStore(root,'test'),'app');await cache('known',10000,async()=>42);
 await assert.rejects(cache('new',10000,async()=>{throw Object.assign(new Error('Busy'),{status:429,retryAfter:'3600'})}));
 const second=createProviderCache(createTextStore(root,'test'),'app');assert.equal(await second('known',10000,async()=>0),42);
 await assert.rejects(second(null,0,async()=>{throw new Error('Must not reach provider')}),e=>e instanceof ProviderPausedError&&Number(e.retryAfter)>3500);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('a shared rolling request budget pauses a second reader before it reaches the provider',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-budget-'));try{
 const first=createProviderCache(createTextStore(root,'test'),'app',{limit:2,windowMs:30000});
 await first('one',10000,async()=>1);await first('two',10000,async()=>2);
 const second=createProviderCache(createTextStore(root,'test'),'app',{limit:2,windowMs:30000});
 await assert.rejects(second('three',10000,async()=>{throw new Error('Budget exceeded')}),e=>e instanceof ProviderPausedError);
 assert.equal(await second('one',10000,async()=>0),1);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('a normal concurrent request waits for the provider slot instead of returning a false 429',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-serial-'));try{
 let active=0,maximum=0,calls=0;
 const load=async()=>{active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,30));active--;return ++calls};
 const a=createProviderCache(createTextStore(root,'test'),'app'),b=createProviderCache(createTextStore(root,'test'),'app');
 const values=await Promise.all([a(null,0,load),b(null,0,load)]);
 assert.equal(maximum,1);assert.deepEqual(values.sort(),[1,2]);
 }finally{await rm(root,{recursive:true,force:true})}
});
