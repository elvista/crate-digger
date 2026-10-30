import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
