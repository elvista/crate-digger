import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cosineDiscovery,cosineTracks,sameRecording,CosineError,advanceMatching,createMatchingState,matchingWarnings} from '../lib/cosine-core.ts';
import {matchRecording} from '../lib/recording-match.ts';
import {generateDiscovery,parseSelection} from '../lib/discovery-core.ts';
import {normalizeTrack} from '../lib/spotify-data.ts';
const id=(n:number)=>String(n).padStart(22,'0');
const raw=(n:number,title=`Song ${n}`,artist=`Artist ${n}`)=>({id:id(n),name:title,duration_ms:240000,artists:[{id:id(n+1000),name:artist}],album:{name:'Release'}});
const track=(n:number,title?:string,artist?:string)=>normalizeTrack(raw(n,title,artist),'Seed')!;
const ct=(n:number,title=`Song ${n}`,artist=`Artist ${n}`,score=.9)=>({id:String(n),track:title,artist,score});
const seed=track(1);
const bulk=(neighbors=Array.from({length:20},(_,i)=>ct(i+10)))=>({data:{results:[{query:`${seed.artist} - ${seed.title}`,track:ct(1),similar_tracks:neighbors}],unmatched:[]}});
const spotify=async(path:string)=>{const q=new URLSearchParams(path.split('?')[1]).get('q')!;const n=Number(/Song (\d+)/i.exec(q)?.[1]);return{tracks:{items:Number.isFinite(n)?[raw(n)]:[]}}};
const noExpansion=async(path:string)=>path==='search/bulk'?bulk([]):{data:{similar_tracks:[]}};
test('strict recording identity retains versions and primary credit boundaries',()=>{
 assert.equal(sameRecording({title:'Nïght - Club Remix',artist:'Example'},{title:'Night (Club Remix)',artist:'Example'}),true);
 assert.equal(sameRecording({title:'Latch',artist:'Disclosure, Sam Smith'},{title:'Latch',artist:'Disclosure feat. Sam Smith'}),true);
 assert.equal(sameRecording({title:'Latch',artist:'Disclosure'},{title:'Latch (Radio Edit)',artist:'Disclosure'}),false);
 assert.equal(sameRecording({title:'Peach',artist:'salute, Sammy Virji'},{title:'Peach',artist:'Salute & Sammy Virji'}),true);
 assert.equal(sameRecording({title:'Song',artist:'Artist & Band'},{title:'Song',artist:'Artist'}),false);
});
test('fuzzy matching recovers Peach, reversed collaborator credits, and Wolves conjunctions',()=>{
 assert.ok(matchRecording({title:'Peaches',artist:'Sammy Virji'},{title:'Peach',artist:'salute & Sammy Virji'}));
 assert.ok(matchRecording({title:'Peach',artist:'Sammy Virji, salute'},{title:'Peach',artist:'salute & Sammy Virji'}));
 assert.ok(matchRecording({title:'The Wolves (Act I and II)',artist:'Bon Iver'},{title:'The Wolves (Act I & II)',artist:'Bon Iver'}));
 assert.equal(matchRecording({title:'The Wolves (Act I and II)',artist:'Bon Iver'},{title:'Flume',artist:'Bon Iver'}),null);
 assert.equal(matchRecording({title:'Latch',artist:'Disclosure'},{title:'Latch',artist:'Unrelated'}),null);
});
test('live recordings do not enter as originals, while edits and remixes stay eligible',()=>{
 assert.equal(matchRecording({title:'Day',artist:'A'},{title:'Day (Live)',artist:'A'}),null);
 assert.equal(matchRecording({title:'Day',artist:'A'},{title:'Day (Club Remix)',artist:'A'})?.kind,'related-version');
});
test('provider lists reject unsafe IDs and malformed responses',()=>{
 assert.throws(()=>cosineTracks({}),CosineError);
 assert.deepEqual(cosineTracks([{...ct(1),id:'../../secrets'},ct(2)]).map(t=>t.id),['2']);
});
test('50-neighbor seed expansion produces 50 unique ranked playable Spotify songs',async()=>{
 const neighbors=Array.from({length:50},(_,i)=>ct(i+10,undefined,undefined,1-i*.01));const calls:string[]=[];
 const result=await cosineDiscovery([seed],async path=>{calls.push(path);return path==='search/bulk'?bulk(neighbors.slice(0,20)):{data:{similar_tracks:neighbors}}},spotify);
 assert.equal(result.items.length,50);assert.equal(new Set(result.items.map(t=>t.id)).size,50);
 assert.deepEqual(calls,['search/bulk','tracks/1/similar?limit=50']);
 assert.equal(result.items[0].similarityScore,1);assert.ok(result.items.every((t,i,a)=>i===0||a[i-1].matchRank!>=t.matchRank!));
});
test('searching 50 candidates is not completion: second-hop candidates replace Spotify misses',async()=>{
 const neighbors=Array.from({length:50},(_,i)=>ct(i+10));let expansions=0;
 const result=await cosineDiscovery([seed],async path=>{
  if(path==='search/bulk')return bulk(neighbors.slice(0,20));
  if(path==='tracks/1/similar?limit=50')return{data:{similar_tracks:neighbors}};
  expansions++;return{data:{similar_tracks:Array.from({length:50},(_,i)=>ct(i+100))}};
 },async path=>{const n=Number(/Song (\d+)/i.exec(new URLSearchParams(path.split('?')[1]).get('q')!)?.[1]);return n>=34&&n<60?{tracks:{items:[]}}:spotify(path)});
 assert.equal(result.items.length,50);assert.ok(expansions>0);assert.ok(result.items.some(t=>t.matchProvenance==='second-hop'));
 assert.ok(result.items.filter(t=>t.matchProvenance==='second-hop').every(t=>t.similarityScore===undefined));
});
test('resume batches preserve progress and do not repeat completed candidate searches',async()=>{
 const neighbors=Array.from({length:50},(_,i)=>ct(i+10));let calls=0;
 const cosine=async(path:string)=>path==='search/bulk'?bulk():{data:{similar_tracks:neighbors}};
 let state=createMatchingState([seed]);
 await advanceMatching(state,cosine,async p=>{calls++;return spotify(p)},undefined,{spotify:12,cosine:20,milliseconds:10000});
 assert.equal(state.items.length,12);assert.equal(state.status,'running');state=JSON.parse(JSON.stringify(state));
 while(state.status==='running')await advanceMatching(state,cosine,async p=>{calls++;return spotify(p)},undefined,{spotify:12,cosine:20,milliseconds:10000});
 assert.equal(state.items.length,50);assert.equal(calls,50);
});
test('Spotify cooldown retains partial results and the failed candidate for later resume',async()=>{
 const state=createMatchingState([seed]);let count=0;
 const cosine=async(path:string)=>path==='search/bulk'?bulk([ct(10),ct(11)]):{data:{similar_tracks:[]}};
 await advanceMatching(state,cosine,async p=>{if(++count===2)throw Object.assign(new Error('Busy'),{status:429,retryAfter:'67227'});return spotify(p)});
 assert.equal(state.status,'paused');assert.equal(state.items.length,1);assert.ok(state.retryAt!>Date.now()+67000000);
 await advanceMatching(state,cosine,async()=>{throw new Error('Cooldown must not send requests')});
 state.retryAt=Date.now()-1;await advanceMatching(state,cosine,spotify);
 assert.equal(state.items.length,2);assert.equal(state.status,'complete');
});
test('cosine cooldown pauses before any Spotify calls and abort cancels without fallback',async()=>{
 const state=createMatchingState([seed]);let calls=0;
 await advanceMatching(state,async()=>{throw new CosineError('Busy',429,'60')},async()=>{calls++;return{}});
 assert.equal(state.status,'paused');assert.equal(state.tasks.length,1);assert.equal(calls,0);
 const abort=new AbortController();abort.abort();await assert.rejects(advanceMatching(createMatchingState([seed]),noExpansion,spotify,abort.signal),e=>e instanceof CosineError&&e.status===499);
});
test('Latch bulk miss recovers featured credits and chooses exact original over radio edit',async()=>{
 const latch=track(1,'Latch','Disclosure, Sam Smith');const calls:string[]=[];
 const result=await cosineDiscovery([latch],async path=>{
  calls.push(path);if(path==='search/bulk')return{data:{results:[],unmatched:['Latch']}};
  if(path.startsWith('search?'))return{data:[ct(8,'Latch (Radio Edit)','Disclosure feat. Sam Smith'),ct(9,'Latch','Disclosure feat. Sam Smith')]};
  return{data:{similar_tracks:path==='tracks/9/similar?limit=50'?[ct(10)]:[]}};
 },spotify);
 assert.equal(result.items.length,1);assert.equal(calls.includes('tracks/9/similar?limit=50'),true);
});
test('Peach individual search recovers a bulk false negative and records automatic typo correction',async()=>{
 const peach=track(1,'Peaches','Sammy Virji');
 const state=createMatchingState([peach]);
 await advanceMatching(state,async path=>path==='search/bulk'?{data:{results:[],unmatched:['Peaches']}}:path.startsWith('search?')?{data:[ct(1245384,'Peach','salute & Sammy Virji')]}:{data:{similar_tracks:[]}},spotify);
 assert.equal(state.matchedSeeds.length,1);assert.match(matchingWarnings(state).join(' '),/Using approximate seed: Peach/);
});
test('unresolved Wolves uses explicitly labeled artist discovery instead of claiming a work match',async()=>{
 const wolves=track(1,'The Wolves (Act I and II)','Bon Iver');
 const state=createMatchingState([wolves]);
 await advanceMatching(state,async path=>path==='search/bulk'?{data:{results:[],unmatched:['Wolves']}}:path.startsWith('search?')?{data:[ct(5,'Flume','Bon Iver')]}:{data:{similar_tracks:[ct(10)]}},spotify);
 assert.equal(state.matchedSeeds.length,0);assert.equal(state.items[0].matchProvenance,'artist-fallback');assert.equal(state.items[0].similarityScore,undefined);
 assert.match(matchingWarnings(state).join(' '),/broader artist-based discovery/);
});
test('Fela-compatible reissues and differing durations no longer reject an entire result group',async()=>{
 const state=createMatchingState([seed]);
 await advanceMatching(state,async path=>path==='search/bulk'?bulk([ct(10,'Soul Sisters','Weldon Irvine')]):{data:{similar_tracks:[]}},async()=>({tracks:{items:[{...raw(10,'Soul Sisters','Weldon Irvine'),duration_ms:456813,external_ids:{isrc:'ONE'}},{...raw(11,'Soul Sisters','Weldon Irvine'),duration_ms:459000,external_ids:{isrc:'TWO'}}]}}));
 assert.equal(state.items.length,1);assert.equal(state.items[0].title,'Soul Sisters');
});
test('related versions keep separate identities, no inherited score, and exact mappings replace related ones',async()=>{
 const state=createMatchingState([seed]);
 await advanceMatching(state,async path=>path==='search/bulk'?bulk([ct(10,'Day','Another'),ct(11,'Day (Club Remix)','Another')]):{data:{similar_tracks:[]}},async()=>({tracks:{items:[raw(10,'Day','Another'),raw(11,'Day (Club Remix)','Another'),raw(12,'Day (Radio Edit)','Another'),raw(13,'Day (Live)','Another')]}}));
 assert.equal(state.items.length,3);const remix=state.items.find(t=>t.title==='Day (Club Remix)')!;
 assert.equal(remix.similarityMatch,'exact');assert.equal(remix.similarityTrackId,'11');assert.equal(state.items.find(t=>t.title==='Day (Radio Edit)')?.similarityScore,undefined);
});
test('failed strict Spotify query broadens to unquoted queries and accepts a plausible fuzzy match',async()=>{
 const state=createMatchingState([seed]);let calls=0;
 await advanceMatching(state,async path=>path==='search/bulk'?bulk([ct(10,'Peaches','salute & Sammy Virji')]):{data:{similar_tracks:[]}},async()=>({tracks:{items:++calls<2?[]:[raw(10,'Peach','salute, Sammy Virji')]}}));
 assert.equal(state.items.length,1);assert.equal(state.items[0].similarityMatch,'approximate');assert.ok(calls>=2);
});
test('50 target is counted after reviewed, seed, reissue and unavailable filtering',async()=>{
 const state=createMatchingState([seed],[track(10).id]);
 await advanceMatching(state,async path=>path==='search/bulk'?bulk([ct(10),ct(11),ct(12)]):{data:{similar_tracks:[]}},async path=>{
 const n=Number(/Song (\d+)/i.exec(new URLSearchParams(path.split('?')[1]).get('q')!)?.[1]);
 return{tracks:{items:[{...raw(n),is_playable:n!==12}]}};
 });
 assert.deepEqual(state.items.map(t=>t.id),[track(11).id]);assert.equal(state.status,'complete');assert.match(matchingWarnings(state).join(' '),/Found 1\/50/);
});
test('all selected playlist songs reach cosine and same-artist matches are not capped at three',async()=>{
 const songs=Array.from({length:75},(_,i)=>raw(i+1,`Source ${i}`,'Same artist'));let received=0;
 const result=await generateDiscovery(parseSelection({playlistIds:[id(90)],trackIds:[],reviewedIds:[],mode:'related',relatedMethod:'cosine',genre:''}),async path=>path===`playlists/${id(90)}`?{id:id(90),name:'Sources'}:{items:songs.map(item=>({item})),next:null},undefined,undefined,async seeds=>{received=seeds.length;return{items:Array.from({length:50},(_,i)=>track(i+100,undefined,'Same artist')),warnings:[]}});
 assert.equal(received,75);assert.equal(result.items.length,50);
});
test('all seeds bulk in batches of 50; unresolved seeds after eight receive fallback searches',async()=>{
 const seeds=Array.from({length:75},(_,i)=>track(i+1));const sizes:number[]=[];const state=createMatchingState(seeds);
 await advanceMatching(state,async(path,options)=>{if(path==='search/bulk'){sizes.push(options!.body.tracks.length);return{data:{results:options!.body.tracks.map((query,i)=>({query,track:ct((sizes.length-1)*50+i+1),similar_tracks:[]})),unmatched:[]}}}return{data:[]}},spotify,undefined,{spotify:12,cosine:100,milliseconds:10000});
 assert.deepEqual(sizes,[50,25]);assert.equal(state.matchedSeeds.length,75);
});
test('verified recording mappings avoid all Spotify searches on a repeated generation',async()=>{
 const state=createMatchingState([seed]);let writes=0;const values=new Map<string,ReturnType<typeof track>[]>();
 const mapping={get:async(id:string)=>values.get(id)??null,set:async(id:string,tracks:ReturnType<typeof track>[])=>{writes++;values.set(id,tracks)}};
 const cosine=async(path:string)=>path==='search/bulk'?bulk([ct(10)]):{data:{similar_tracks:[]}};
 await advanceMatching(state,cosine,spotify,undefined,undefined,mapping);assert.equal(writes,1);
 const repeated=createMatchingState([seed]);await advanceMatching(repeated,cosine,async()=>{throw new Error('Mapping should avoid requests')},undefined,undefined,mapping);
 assert.equal(repeated.items.length,1);assert.equal(repeated.lookups,0);
});
test('an explicitly corrected recording is reused with honest provenance instead of a cosine score',async()=>{
 const state=createMatchingState([seed]);
 await advanceMatching(state,async(path:string)=>path==='search/bulk'?bulk([ct(10)]):{data:{similar_tracks:[]}},async()=>{throw new Error('Use the saved choice')},undefined,undefined,{get:async()=>[{...track(100,'User choice','Chosen artist'),matchConfirmedByUser:true}],set:async()=>{}});
 assert.equal(state.items[0].title,'User choice');assert.equal(state.items[0].similarityMatch,'approximate');assert.equal(state.items[0].similarityScore,undefined);assert.match(state.items[0].reason!,/Your chosen Spotify recording/);
});
