import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTextStore} from '../lib/text-store.ts';
import {createSpotifyReadCache} from '../lib/spotify-read-cache.ts';
import {createPlaylistSourceCache} from '../lib/playlist-source-cache.ts';
import {generateDiscovery,parseSelection} from '../lib/discovery-core.ts';
const id=(n:number)=>String(n).padStart(22,'0');
const raw=(n:number)=>({id:id(n),name:`Song ${n}`,duration_ms:240000,type:'track',artists:[{id:id(n+1000),name:'Artist'}],album:{name:'Album',images:[]}});
async function temporary(run:(root:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'crate-read-reuse-'));try{await run(root)}finally{await rm(root,{recursive:true,force:true})}}
test('search results prewarm full tracks, including after another server instance starts',async()=>temporary(async root=>{
 let calls=0;const api=async()=>{calls++;return{tracks:{items:[raw(1),raw(2)]}}};
 const first=createSpotifyReadCache(createTextStore(root,'test'),'owner',api);
 await first('search?q=Artist&type=track&limit=10');
 const next=createSpotifyReadCache(createTextStore(root,'test'),'owner',api);
 assert.equal((await next(`tracks/${id(1)}`)).name,'Song 1');assert.equal(calls,1);
 await next('search?limit=10&type=track&q=Artist');assert.equal(calls,1);
}));
test('library lists are reused across pickers and invalidated after successful and ambiguous writes',async()=>temporary(async root=>{
 let reads=0,count=2;const api=async(path:string,options:{method?:string})=>{if(options.method==='POST'){count++;if(count===4)throw new Error('Response lost');return{snapshot_id:'updated'}}reads++;return{items:[{id:id(1),tracks:{total:count}}]}};
 const cached=createSpotifyReadCache(createTextStore(root,'test'),'owner',api);
 const path='me/playlists?limit=50&offset=0';
 await cached(path);await cached(path);assert.equal(reads,1);
 await cached(`playlists/${id(1)}/items`,{method:'POST',body:'{}'});
 assert.equal((await cached(path)).items[0].tracks.total,3);assert.equal(reads,2);
 await assert.rejects(cached(`playlists/${id(1)}/items`,{method:'POST',body:'{}'}));
 assert.equal((await cached(path)).items[0].tracks.total,4);assert.equal(reads,3);
}));
test('write-safety reads bypass cache and playback commands never get reused',async()=>temporary(async root=>{
 let calls=0;const cached=createSpotifyReadCache(createTextStore(root,'test'),'owner',async()=>({items:[],number:++calls}));
 const path='me/playlists?limit=50&offset=0';await cached(path);await cached(path,{fresh:true});assert.equal(calls,2);
 await cached('me/player/play?device_id=one',{method:'PUT',body:'{}'});await cached('me/player/play?device_id=one',{method:'PUT',body:'{}'});assert.equal(calls,4);
}));
test('cached private library and track metadata stay scoped to the signed-in account',async()=>temporary(async root=>{
 let calls=0;const api=async()=>{calls++;return raw(1)};
 await createSpotifyReadCache(createTextStore(root,'test'),'account-a',api)(`tracks/${id(1)}`);
 await createSpotifyReadCache(createTextStore(root,'test'),'account-b',api)(`tracks/${id(1)}`);assert.equal(calls,2);
}));
test('incomplete album-track metadata is not mistaken for a complete track response',async()=>temporary(async root=>{
 let calls=0;const cached=createSpotifyReadCache(createTextStore(root,'test'),'owner',async path=>{calls++;if(path.startsWith('albums/')){const {album:_,...partial}=raw(1);return{items:[partial]}}return raw(1)});
 await cached(`albums/${id(99)}/tracks?limit=50`);await cached(`tracks/${id(1)}`);assert.equal(calls,2);
}));
test('unchanged 500-song playlists need one snapshot check instead of twelve API reads',async()=>temporary(async root=>{
 const cache=createPlaylistSourceCache(createTextStore(root,'test'),'owner');let snapshot='one',calls=0;
 const api=async(path:string)=>{calls++;if(path===`playlists/${id(99)}`)return{id:id(99),name:'Source',snapshot_id:snapshot};const offset=Number(new URLSearchParams(path.split('?')[1]).get('offset'));return{items:Array.from({length:50},(_,i)=>({item:raw(offset+i+1)})),next:offset<450?'next':null}};
 const selection=parseSelection({playlistIds:[id(99)],trackIds:[],mode:'playlist',relatedMethod:'cosine',genre:'',reviewedIds:[]});
 const first=await generateDiscovery(selection,api,undefined,undefined,undefined,cache);assert.equal(first.items.length,500);assert.equal(calls,12);
 calls=0;const second=await generateDiscovery(selection,api,undefined,undefined,undefined,cache);assert.equal(second.items.length,500);assert.equal(calls,1);
 snapshot='two';calls=0;await generateDiscovery(selection,api,undefined,undefined,undefined,cache);assert.equal(calls,12);
}));
test('playlist changes during fetching cannot poison the snapshot cache',async()=>temporary(async root=>{
 const cache=createPlaylistSourceCache(createTextStore(root,'test'),'owner');let reads=0;
 const selection=parseSelection({playlistIds:[id(99)],trackIds:[],mode:'playlist',relatedMethod:'cosine',genre:'',reviewedIds:[]});
 await assert.rejects(generateDiscovery(selection,async path=>path===`playlists/${id(99)}`?{id:id(99),name:'Source',snapshot_id:++reads===1?'before':'after'}:{items:[{item:raw(1)}],next:null},undefined,undefined,undefined,cache));
 assert.equal(await cache.get(id(99),'before'),null);
}));
test('concurrent picker reads share one library request while fresh write-safety checks remain independent',async()=>temporary(async root=>{
 let calls=0;const api=async()=>{calls++;await new Promise(r=>setTimeout(r,20));return{items:[]}};
 const a=createSpotifyReadCache(createTextStore(root,'test'),'owner-single-flight',api),b=createSpotifyReadCache(createTextStore(root,'test'),'owner-single-flight',api);
 await Promise.all([a('me/playlists?limit=50&offset=0'),b('me/playlists?limit=50&offset=0')]);assert.equal(calls,1);
 await b('me/playlists?limit=50&offset=0',{fresh:true});assert.equal(calls,2);
}));
