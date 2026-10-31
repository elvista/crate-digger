import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTextStore,StoreLockedError} from '../lib/text-store.ts';
test('durable text stores share data across instances and reject conflicting saves until released',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-store-'));try{
 const first=createTextStore(root,'test'),second=createTextStore(root,'test');
 assert.equal(await first.read('owner/receipt.json'),null);
 const release=await first.lock('owner/save');
 await assert.rejects(second.lock('owner/save'),StoreLockedError);
 await first.write('owner/receipt.json','{"phase":"done"}');
 assert.equal(await second.read('owner/receipt.json'),'{"phase":"done"}');
 await release();const releaseAgain=await second.lock('owner/save');await releaseAgain();
 await assert.rejects(first.read('../other-account'));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('a killed lock holder releases the OS lease without deleting a live contender lock',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-crash-lock-'));
 const script=`import {createTextStore} from ${JSON.stringify(new URL('../lib/text-store.ts',import.meta.url).href)};await createTextStore(${JSON.stringify(root)},'test').lock('owner/save');console.log('locked');await new Promise(()=>{});`;
 const child=spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture lock did not start')),5000);child.stdout.once('data',()=>{clearTimeout(timer);resolve()});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Fixture lock exited early'))})});
  const contender=createTextStore(root,'test');await assert.rejects(contender.lock('owner/save'),StoreLockedError);
  child.kill('SIGKILL');await new Promise(resolve=>child.once('close',resolve));
  const release=await contender.lock('owner/save');await release();
 }finally{child.kill('SIGKILL');await rm(root,{recursive:true,force:true})}
});
