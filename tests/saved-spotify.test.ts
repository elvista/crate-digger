import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {savedSpotify} from '../lib/saved-spotify.ts';
import {downloadSourceState} from '../lib/download-source-snapshot.ts';
test('saved playlists avoid provider reads, survive quota errors and remain account scoped; explicit refresh replaces them',async()=>{
 const owner='fixture-'+randomUUID();let calls=0;const load=async()=>{calls++;return {items:['song']}};
 await savedSpotify(owner,'playlist',load);const saved=await savedSpotify(owner,'playlist',load);assert.equal(calls,1);assert.equal(saved.saved,true);
 const blocked=async()=>{throw Object.assign(new Error('quota'),{status:429})};assert.equal((await savedSpotify(owner,'playlist',blocked,true)).saved,true);
 await assert.rejects(savedSpotify(owner+'other','playlist',blocked));
 assert.equal((await savedSpotify(owner,'playlist',async()=>({items:['updated']}),true)).saved,false);
});
test('same-count provider removals and reordering replace the source snapshot and change its revision',async()=>{
 const owner='revision-'+randomUUID(),id='b'.repeat(22);
 const track=(letter:string)=>({id:`spotify:${letter.repeat(22)}`,title:letter,artist:'Fixture',durationMs:120000});
 await savedSpotify(owner,'songs:'+id,async()=>({items:[track('a'),track('b'),track('c')],warnings:[]}));
 const before=await downloadSourceState(owner,id);assert.deepEqual(before.items.map(t=>t.title),['a','b','c']);assert.equal(before.complete,true);
 await savedSpotify(owner,'songs:'+id,async()=>({items:[track('c'),track('d'),track('a')],warnings:[]}),true);
 const after=await downloadSourceState(owner,id);assert.deepEqual(after.items.map(t=>t.title),['c','d','a']);assert.notEqual(after.revision,before.revision);
});
test('confirmed playlist saves patch durable counts and songs without another provider call',async()=>{
 const {syncSavedPlaylist}=await import('../lib/saved-spotify.ts');const owner='sync-'+randomUUID(),id='a'.repeat(22);let reads=0;
 await savedSpotify(owner,'library:0',async()=>({items:[{id,name:'Crate Finds',count:2}],nextCursor:null}));
 await savedSpotify(owner,'songs:'+id,async()=>({items:[{id:'spotify:old1'},{id:'spotify:old2'}],seedCount:2}));
 const tracks=[{id:'spotify:new1'},{id:'spotify:new2'}];await syncSavedPlaylist(owner,{id,name:'Crate Finds',count:4},tracks);
 const load=async()=>{reads++;throw new Error('Provider must not be called')};
 assert.equal((await savedSpotify(owner,'library:0',load)).items[0].count,4);
 assert.equal((await savedSpotify(owner,'songs:'+id,load)).items.length,4);
 await syncSavedPlaylist(owner,{id,name:'Crate Finds',count:4},tracks);
 assert.equal((await savedSpotify(owner,'songs:'+id,load)).items.length,4);assert.equal(reads,0);
});
