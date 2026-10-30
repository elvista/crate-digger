import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineDiscovery, cosineTracks, sameRecording, CosineError } from '../lib/cosine-core.ts';
import { generateDiscovery, parseSelection } from '../lib/discovery-core.ts';
import { normalizeTrack } from '../lib/spotify-data.ts';
const id=(n:number)=>String(n).padStart(22,'0');
const raw=(n:number,title='Night (Club Remix)',artist='Example')=>({id:id(n),name:title,duration_ms:240000,artists:[{id:id(n+100),name:artist}],album:{name:'Release'}});
const seed=normalizeTrack(raw(1),'Seed')!;
const cosineTrack=(n:number,title='Night (Club Remix)',artist='Example')=>({id:String(n),track:title,artist,name:`${artist} - ${title}`,score:.85});
const bulk=(seedTrack=seed,similar=[cosineTrack(2,'Day (Dub Mix)','Another')])=>({data:{results:[{query:`${seedTrack.artist.split(',')[0]} - ${seedTrack.title}`,track:{...cosineTrack(1),track:seedTrack.title,artist:seedTrack.artist},similar_tracks:similar}],unmatched:[]}});
const selection=(mode:'related'|'playlist'='related')=>parseSelection({playlistIds:[],trackIds:[id(1)],reviewedIds:[],mode,relatedMethod:'cosine',genre:''});
test('cosine matching preserves remix/version words while tolerating punctuation and accents',()=>{
 assert.equal(sameRecording({title:'Nïght - Club Remix',artist:'Example'},seed),true);
 for(const title of ['Night','Night (Radio Edit)','Night (Other Remix)','Night (Club Remix) Live'])assert.equal(sameRecording({title,artist:'Example'},seed),false);
 assert.equal(sameRecording({title:seed.title,artist:'Someone Else'},seed),false);
});
test('cosine schema rejects malformed lists and unsafe provider identifiers',()=>{
 assert.throws(()=>cosineTracks({}),CosineError);
 assert.deepEqual(cosineTracks([{...cosineTrack(2),id:'../../secrets'},cosineTrack(3)]).map(t=>t.id),['3']);
});
test('cosine similarity resolves the exact Spotify version and attaches provenance',async()=>{
 const calls:string[]=[];
 const result=await cosineDiscovery([seed],async path=>{calls.push(path);return bulk();},async()=>({tracks:{items:[raw(2,'Day','Another'),raw(3,'Day (Dub Mix)','Another')]}}));
 assert.deepEqual(calls,['search/bulk']);assert.equal(result.items[0].id,`spotify:${id(3)}`);assert.equal(result.items[0].similaritySource,'cosine.club');assert.equal(result.items[0].similarityScore,.85);
});
test('unmatched seeds never trigger artist fallback or Spotify guesses',async()=>{
 let spotifyCalls=0;const result=await cosineDiscovery([seed],async path=>path==='search/bulk'?{data:{results:[],unmatched:['Example - Night (Club Remix)']}}:{data:[cosineTrack(2,'Night')]},async()=>{spotifyCalls++;return{}});
 assert.equal(result.items.length,0);assert.equal(spotifyCalls,0);assert.match(result.warnings.join(' '),/not been substituted/);
});
test('uncertain, unavailable and differently remixed Spotify results are omitted',async()=>{
 const result=await cosineDiscovery([seed],async()=>bulk(seed,[cosineTrack(2,'Day')]),async()=>({tracks:{items:[{...raw(2,'Day'),is_playable:false},raw(3,'Day (Live)')]}}));assert.equal(result.items.length,0);
});
test('provider rate limits and cancellation stop generation without fallback requests',async()=>{
 let count=0;await assert.rejects(cosineDiscovery([seed],async()=>{count++;throw new CosineError('Rate limited',429,'60')},async()=>({})),e=>e instanceof CosineError&&e.status===429);assert.equal(count,1);
 const abort=new AbortController();await assert.rejects(cosineDiscovery([seed],async()=>{abort.abort();return{data:[]}},async()=>({}),abort.signal),e=>e instanceof CosineError&&e.status===499);
});
test('source selection routes cosine sessions through the provider and excludes seed/reviewed records',async()=>{
 let providerCalls=0;
 const result=await generateDiscovery({...selection(),reviewedIds:[`spotify:${id(2)}`]},async path=>{assert.equal(path,`tracks/${id(1)}`);return raw(1)},undefined,undefined,async seeds=>{providerCalls++;assert.equal(seeds[0].id,seed.id);return {items:[seed,normalizeTrack(raw(2),'x')!,normalizeTrack(raw(3),'x')!],warnings:['Audio similarity']}});
 assert.equal(providerCalls,1);assert.equal(result.method,'cosine');assert.deepEqual(result.items.map(t=>t.id),[`spotify:${id(3)}`]);assert.match(result.warnings.join(' '),/2 matches were excluded/);
});
test('playlist-only digging does not require or call cosine',async()=>{
 const result=await generateDiscovery(selection('playlist'),async()=>raw(1));assert.equal(result.method,'playlist');assert.equal(result.items.length,1);
});

test('every playlist source song reaches cosine, even beyond the old 8/25-seed sample',async()=>{
 const songs=Array.from({length:75},(_,i)=>raw(i+1,`Source ${i}`,'Same artist'));
 let received=0;
 const result=await generateDiscovery(parseSelection({playlistIds:[id(90)],trackIds:[],reviewedIds:[],mode:'related',relatedMethod:'cosine',genre:''}),async path=>path===`playlists/${id(90)}`?{id:id(90),name:'Sources'}:{items:songs.map(item=>({item})),next:null},undefined,undefined,async seeds=>{received=seeds.length;return{items:[],warnings:[]}});
 assert.equal(received,75);assert.equal(result.seedCount,75);
});
test('bulk search sends all songs in batches of at most 50 and has no 8-seed truncation',async()=>{
 const seeds=Array.from({length:75},(_,i)=>normalizeTrack(raw(i+1,`Song ${i}`),'Seed')!);
 const sizes:number[]=[];
 const result=await cosineDiscovery(seeds,async(path,options)=>{
  assert.equal(path,'search/bulk');assert.equal(options?.method,'POST');sizes.push(options!.body.tracks.length);
  return{data:{results:options!.body.tracks.map((query,i)=>({query,track:cosineTrack(i,query.split(' - ')[1]),similar_tracks:[]})),unmatched:[]}};
 },async()=>{throw new Error('No candidates expected')});
 assert.deepEqual(sizes,[50,25]);assert.match(result.warnings[0],/Matched 75 of 75 source songs/);
});
test('bulk candidates supported by multiple sources rank first, with duplicate originals excluded',async()=>{
 const second=normalizeTrack(raw(2,'Other seed'),'Seed')!;const lookedUp:string[]=[];
 const result=await cosineDiscovery([seed,second],async()=>({data:{results:[
  {query:`Example - ${seed.title}`,track:cosineTrack(1),similar_tracks:[cosineTrack(5,'Solo'),cosineTrack(6,'Shared'),cosineTrack(1)]},
  {query:'Example - Other seed',track:cosineTrack(2,'Other seed'),similar_tracks:[cosineTrack(6,'Shared')]}
 ],unmatched:[]}}),async path=>{const q=new URLSearchParams(path.split('?')[1]).get('q')!;const title=q.includes('Shared')?'Shared':'Solo';lookedUp.push(title);return{tracks:{items:[raw(title==='Shared'?6:5,title)]}}});
 assert.deepEqual(lookedUp,['Shared','Solo']);assert.equal(result.items[0].similaritySeedCount,2);assert.match(result.items[0].reason!,/2 source songs/);
});
test('an unmatched bulk track retries single-track lookup without accepting another remix',async()=>{
 const calls:string[]=[];const result=await cosineDiscovery([seed],async path=>{calls.push(path);if(path==='search/bulk')return{data:{results:[],unmatched:['Example - Night (Club Remix)']}};if(path.startsWith('search?'))return{data:[cosineTrack(9,'Night - Club Remix')]};return{data:{similar_tracks:[cosineTrack(2,'Day')]}}},async()=>({tracks:{items:[raw(2,'Day')]}}));
 assert.equal(calls.length,3);assert.equal(calls[2],'tracks/9/similar?limit=50');assert.equal(result.items.length,1);
});
test('Spotify reissues with different ISRCs and matching durations still produce a recommendation',async()=>{
 const result=await cosineDiscovery([seed],async()=>bulk(seed,[cosineTrack(2,'Soul Sisters','Weldon Irvine')]),async()=>({tracks:{items:[
  {...raw(2,'Soul Sisters','Weldon Irvine'),duration_ms:456813,external_ids:{isrc:'USHKR0980903'}},
  {...raw(3,'Soul Sisters','Weldon Irvine'),duration_ms:456813,external_ids:{isrc:'JPV502300098'}}
 ]}}));
 assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Soul Sisters');assert.equal(result.items[0].similaritySource,'cosine.club');
});
test('different-length recordings with the same title remain ambiguous and are excluded',async()=>{
 const result=await cosineDiscovery([seed],async()=>bulk(seed,[cosineTrack(2,'Song','Artist')]),async()=>({tracks:{items:[
  {...raw(2,'Song','Artist'),duration_ms:660480,external_ids:{isrc:'USME30902236'}},
  {...raw(3,'Song','Artist'),duration_ms:591706,external_ids:{isrc:'USBQU1300035'}}
 ]}}));
 assert.equal(result.items.length,0);
});
test('single-song discovery expands a full 20-neighbor bulk result through the dedicated 50-song endpoint',async()=>{
 const neighbors=Array.from({length:50},(_,i)=>cosineTrack(i+10,`Related ${i}`,`Artist ${i}`));const calls:string[]=[];
 const result=await cosineDiscovery([seed],async path=>{calls.push(path);if(path==='search/bulk')return bulk(seed,neighbors.slice(0,20));assert.equal(path,'tracks/1/similar?limit=50');return{data:{similar_tracks:neighbors}}},async path=>{
  const q=new URLSearchParams(path.split('?')[1]).get('q')!;const index=Number(/Related (\d+)/.exec(q)![1]);return{tracks:{items:[raw(index+10,`Related ${index}`,`Artist ${index}`)]}};
 });
 assert.equal(result.items.length,50);assert.equal(new Set(result.items.map(t=>t.id)).size,50);assert.deepEqual(calls,['search/bulk','tracks/1/similar?limit=50']);
});
test('missing catalog coverage names the unmatched seed instead of substituting another song by its artist',async()=>{
 const bon=normalizeTrack(raw(1,'The Wolves (Act I and II)','Bon Iver'),'Seed')!;let spotifyRequests=0;
 const result=await cosineDiscovery([bon],async path=>path==='search/bulk'?{data:{results:[],unmatched:['Bon Iver - The Wolves (Act I and II)']}}:{data:[cosineTrack(2,'Flume','Bon Iver')]},async()=>{spotifyRequests++;return{}});
 assert.equal(result.items.length,0);assert.equal(spotifyRequests,0);assert.match(result.warnings.join(' '),/Not matched in cosine.club: The Wolves \(Act I and II\) — Bon Iver/);
});
