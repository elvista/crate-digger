import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExport,exportPlaylist,PlaylistExportError,type ExportReceipt} from '../lib/playlist-export.ts';
import {hasPlaylistWriteScope} from '../lib/playback-settings.ts';
const id=(n:number)=>String(n).padStart(22,'0');
const uri=(n:number)=>`spotify:track:${id(n)}`;
const input=(extra:Record<string,unknown>={})=>parseExport({operationId:'abcd1234-abcd-1234-abcd-123456789abc',mode:'new',name:'My crate',public:false,uris:[uri(1)],...extra});
function store(){let receipt:ExportReceipt|null=null;return{load:async()=>receipt,save:async(r:ExportReceipt)=>{receipt=JSON.parse(JSON.stringify(r))},get:()=>receipt}}
test('export validates tracks, destination, visibility and deduplicates tracks',()=>{assert.deepEqual(input({uris:[uri(1),uri(1)]}).uris,[uri(1)]);for(const extra of [{uris:[]},{uris:['spotify:episode:'+id(1)]},{mode:'existing',playlistId:'../x'},{name:' '},{public:'yes'}])assert.throws(()=>input(extra),PlaylistExportError);});
test('playlist write permission requires both public and private scopes',()=>{assert.equal(hasPlaylistWriteScope('playlist-modify-private'),false);assert.equal(hasPlaylistWriteScope('playlist-modify-private playlist-modify-public'),true)});
test('new playlists default private and append through current Spotify endpoints',async()=>{const s=store(),calls:{path:string;body?:any}[]=[];const result=await exportPlaylist(input(),'owner',async(path,options)=>{calls.push({path,body:options?.body?JSON.parse(options.body):undefined});if(path==='me/playlists')return{id:id(9)};if(path.includes('/items'))return options?{snapshot_id:'x'}:{items:[],next:null};return{owner:{id:'owner'}}},s.load,s.save);assert.equal(calls[0].path,'me/playlists');assert.equal(calls[0].body.public,false);assert.equal(calls.at(-1)!.path,`playlists/${id(9)}/items`);assert.equal(result.added,1);assert.equal(s.get()?.phase,'done');});
test('existing playlists skip existing tracks and completed retries cause no writes',async()=>{const s=store();let writes=0;const run=()=>exportPlaylist(input({mode:'existing',playlistId:id(9),uris:[uri(1),uri(2)]}),'owner',async(path,options)=>{if(options){writes++;assert.deepEqual(JSON.parse(options.body!).uris,[uri(2)]);return{}}return path.includes('/items')?{items:[{item:{uri:uri(1)}}],next:null}:{owner:{id:'owner'}}},s.load,s.save);assert.equal((await run()).alreadyPresent,1);await run();assert.equal(writes,1);});
test('rejects another user playlist before writing',async()=>{const s=store();await assert.rejects(exportPlaylist(input({mode:'existing',playlistId:id(9)}),'owner',async()=>({owner:{id:'someone-else'}}),s.load,s.save),e=>e instanceof PlaylistExportError&&e.status===403);});
test('partial batch retry rereads items and never adds successful batches again',async()=>{const s=store();const added=new Set<string>();let failed=false,creates=0;const request=input({uris:Array.from({length:150},(_,i)=>uri(i+1))});const api=async(path:string,options?:{method?:'GET'|'POST';body?:string})=>{if(path==='me/playlists'){creates++;return{id:id(9)}}if(options){const uris=JSON.parse(options.body!).uris as string[];if(added.size===100&&!failed){failed=true;throw new Error('Network failure')}uris.forEach(u=>added.add(u));return{}}if(path.includes('/items')){const offset=Number(new URLSearchParams(path.split('?')[1]).get('offset'));return{items:[...added].slice(offset,offset+50).map(uri=>({track:{uri}})),next:offset+50<added.size?'next':null}}return{owner:{id:'owner'}}};await assert.rejects(exportPlaylist(request,'owner',api,s.load,s.save));const result=await exportPlaylist(request,'owner',api,s.load,s.save);assert.equal(added.size,150);assert.equal(creates,1);assert.equal(result.added,50);assert.equal(result.alreadyPresent,100);});
test('ambiguous playlist creation cannot silently create a duplicate on retry',async()=>{const s=store();let creates=0;const api=async()=>{creates++;throw new Error('Response lost')};await assert.rejects(exportPlaylist(input(),'owner',api,s.load,s.save));await assert.rejects(exportPlaylist(input(),'owner',api,s.load,s.save),e=>e instanceof PlaylistExportError&&e.status===409);assert.equal(creates,1);});
test('save returns the real item count including existing duplicates, without incrementing on duplicate saves',async()=>{
 const s=store();const result=await exportPlaylist(input({mode:'existing',playlistId:id(9),uris:[uri(1),uri(2)]}),'owner',async(path,options)=>options?{snapshot_id:'confirmed'}:path.includes('/items')?{items:[{item:{uri:uri(1)}},{item:{uri:uri(1)}},{item:{uri:uri(3)}}],next:null}:{owner:{id:'owner'}},s.load,s.save);
 assert.equal(result.added,1);assert.equal(result.alreadyPresent,1);assert.equal(result.count,4);
 const duplicate=await exportPlaylist(input({mode:'existing',playlistId:id(9),uris:[uri(1)]}),'owner',async(path,options)=>{assert.equal(options,undefined);return path.includes('/items')?{items:[{item:{uri:uri(1)}}],next:null}:{owner:{id:'owner'}}},async()=>null,async()=>{});
 assert.equal(duplicate.added,0);assert.equal(duplicate.count,1);
});
test('Crate Finds reuses an owned playlist, ignores another owner, and searches later pages before creating',async()=>{
 const s=store();let creates=0;const pages:number[]=[];
 const result=await exportPlaylist(input({mode:'finds'}),'owner',async(path,options)=>{
  if(path.startsWith('me/playlists?')){const offset=Number(new URLSearchParams(path.split('?')[1]).get('offset'));pages.push(offset);return offset===0?{items:[{id:id(8),name:'Crate Finds',owner:{id:'someone-else'}}],next:'next'}:{items:[{id:id(9),name:'Crate Finds',owner:{id:'owner'}}],next:null}}
  if(path==='me/playlists'){creates++;throw new Error('Must not create a duplicate')}
  if(path.includes('/items'))return options?{snapshot_id:'saved'}:{items:[],next:null};
  return{id:id(9),name:'Crate Finds',owner:{id:'owner'}};
 },s.load,s.save);
 assert.deepEqual(pages,[0,50]);assert.equal(creates,0);assert.equal(result.playlistId,id(9));assert.equal(result.added,1);assert.equal(result.playlist?.name,'Crate Finds');
});
test('Crate Finds creates a private playlist once and reuses the receipt on retry',async()=>{
 const s=store();let creates=0,writes=0;
 const api=async(path:string,options?:{method?:'GET'|'POST';body?:string})=>{
  if(path.startsWith('me/playlists?'))return{items:[],next:null};
  if(path==='me/playlists'){creates++;const body=JSON.parse(options!.body!);assert.equal(body.name,'Crate Finds');assert.equal(body.public,false);return{id:id(9)}}
  if(path.includes('/items')){if(options){writes++;return{snapshot_id:'saved'}}return{items:[],next:null}}
  return{id:id(9),name:'Crate Finds',owner:{id:'owner'}};
 };
 const request=input({mode:'finds',name:'Ignored',playlistId:id(7),public:true});assert.equal(request.name,'Crate Finds');assert.equal(request.playlistId,'');assert.equal(request.public,false);
 await exportPlaylist(request,'owner',api,s.load,s.save);await exportPlaylist(request,'owner',api,s.load,s.save);
 assert.equal(creates,1);assert.equal(writes,1);
});
test('Crate Finds recovers a lost creation response by finding the existing playlist',async()=>{
 const s=store();let created=false,creates=0;
 const api=async(path:string,options?:{method?:'GET'|'POST';body?:string})=>{
  if(path.startsWith('me/playlists?'))return{items:created?[{id:id(9),name:'Crate Finds',owner:{id:'owner'}}]:[],next:null};
  if(path==='me/playlists'){created=true;creates++;throw new Error('Response lost')}
  if(path.includes('/items'))return options?{snapshot_id:'saved'}:{items:[],next:null};
  return{id:id(9),name:'Crate Finds',owner:{id:'owner'}};
 };
 await assert.rejects(exportPlaylist(input({mode:'finds'}),'owner',api,s.load,s.save));
 assert.equal((await exportPlaylist(input({mode:'finds'}),'owner',api,s.load,s.save)).added,1);assert.equal(creates,1);
});
test('Crate Finds never creates a second playlist when creation confirmation is still ambiguous',async()=>{
 const s=store();let creates=0;
 const api=async(path:string)=>{if(path.startsWith('me/playlists?'))return{items:[],next:null};creates++;throw new Error('Response lost')};
 await assert.rejects(exportPlaylist(input({mode:'finds'}),'owner',api,s.load,s.save));
 await assert.rejects(exportPlaylist(input({mode:'finds'}),'owner',api,s.load,s.save),e=>e instanceof PlaylistExportError&&e.status===409);
 assert.equal(creates,1);
});
test('separate Save actions reuse Crate Finds and append only the newly selected song',async()=>{
 let created=false,creates=0;const tracks=new Set<string>();
 const api=async(path:string,options?:{method?:'GET'|'POST';body?:string})=>{
  if(path.startsWith('me/playlists?'))return{items:created?[{id:id(9),name:'Crate Finds',owner:{id:'owner'}}]:[],next:null};
  if(path==='me/playlists'){created=true;creates++;return{id:id(9)}}
  if(path.includes('/items')){if(options){JSON.parse(options.body!).uris.forEach((uri:string)=>tracks.add(uri));return{snapshot_id:'saved'}}return{items:[...tracks].map(uri=>({item:{uri}})),next:null}}
  return{id:id(9),name:'Crate Finds',owner:{id:'owner'}};
 };
 const first=store(),second=store();
 assert.equal((await exportPlaylist(input({mode:'finds'}),'owner',api,first.load,first.save)).count,1);
 assert.equal((await exportPlaylist(input({mode:'finds',uris:[uri(2)]}),'owner',api,second.load,second.save)).count,2);
 assert.equal(creates,1);assert.deepEqual([...tracks],[uri(1),uri(2)]);
});
