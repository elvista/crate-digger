import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverySaveService,saveDefaultDiscoveryTrack} from '../lib/default-discovery-save.ts';
import {defaultRekordboxDestination} from '../lib/rekordbox-default.ts';
import type {Track} from '../lib/catalog.ts';
test('recommendation and local recording saves use their own services with no cross-service fallback',async()=>{
 const original=globalThis.fetch,calls:{path:string;body:any}[]=[];const track:Track={id:'spotify:'+'a'.repeat(22),title:'Example',artist:'Artist',durationMs:120000,genre:'',album:'',sourceUrl:'',artworkUrl:null,explicit:false};
 globalThis.fetch=(async(input:any,init:any)=>{const path=String(input);calls.push({path,body:init?.body?JSON.parse(init.body):null});return Response.json(path==='/api/rekordbox/save'?{id:'job'}:path.startsWith('/api/downloads/jobs')?{rekordbox:{status:'imported'}}:path.startsWith('/api/track-search')?{items:[track]}:{added:true})}) as typeof fetch;
 try{
  assert.equal(discoverySaveService(track),'spotify');assert.equal(discoverySaveService({...track,id:'rekordbox:123'}),'rekordbox');
  await saveDefaultDiscoveryTrack(discoverySaveService({...track,id:'rekordbox:123'}),{...track,id:'rekordbox:123'},'operation',()=>{});assert.deepEqual(calls.map(c=>c.path),['/api/rekordbox/save','/api/downloads/jobs?id=job']);assert.equal(calls[0].body.mode,'finds');assert.equal(calls[0].body.playlistId,undefined);
  calls.length=0;await saveDefaultDiscoveryTrack(discoverySaveService(track),track,'operation',()=>{});assert.ok(calls.some(c=>c.path==='/api/playlist-export'));assert.ok(calls.every(c=>!c.path.startsWith('/api/rekordbox')&&!c.path.startsWith('/api/downloads')));assert.equal(calls.at(-1)?.body.mode,'finds');
  calls.length=0;globalThis.fetch=(async(input:any)=>{calls.push({path:String(input),body:null});return Response.json({error:'Local recording missing'},{status:409})}) as typeof fetch;await assert.rejects(saveDefaultDiscoveryTrack('rekordbox',track,'operation',()=>{}),/Local recording missing/);assert.deepEqual(calls.map(c=>c.path),['/api/rekordbox/save']);
 }finally{globalThis.fetch=original}
});
test('Rekordbox default reuses the ordinary root Crate Finds and never adopts a same-name nested or smart playlist',()=>{
 const nested={id:'1',name:'Crate Finds',parentId:'folder',path:'Sets / Crate Finds',attribute:0};assert.deepEqual(defaultRekordboxDestination([nested]),{mode:'create',name:'Crate Finds',parentId:'root'});
 const root={...nested,id:'2',parentId:'root',path:'Crate Finds'};assert.equal((defaultRekordboxDestination([nested,root]) as {id:string}).id,'2');assert.equal(defaultRekordboxDestination([{...root,attribute:4}]).mode,'create');assert.throws(()=>defaultRekordboxDestination([root,{...root,id:'3'}]),/Several root/);
});
