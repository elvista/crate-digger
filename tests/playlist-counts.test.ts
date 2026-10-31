import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberPlaylistCount,withPlaylistCounts} from '../lib/playlist-counts.ts';
const id='1234567890123456789012';
const owner='spotify-owner';
const base=Date.now();
test('a confirmed write updates every cached playlist copy without changing its selection metadata',()=>{
 rememberPlaylistCount({playlistId:id,count:26,at:base,owner});
 const list=[{id,count:25,name:'DJ Nifty'},{id:'different',count:8,name:'Digging'}];
 assert.deepEqual(withPlaylistCounts(list,owner,base+100),[{id,count:26,name:'DJ Nifty'},list[1]]);
 assert.equal(list[0].count,25);
 assert.equal(withPlaylistCounts([{id,count:24}],owner,base+200)[0].count,26);
 assert.equal(withPlaylistCounts([{id,count:27}],owner,base+62000)[0].count,27);
});
test('duplicate saves use the confirmed total rather than blindly incrementing, and older cross-tab updates cannot roll it back',()=>{
 rememberPlaylistCount({playlistId:id,count:26,at:base+1000,owner});
 assert.equal(withPlaylistCounts([{id,count:26}],owner,base+1100)[0].count,26);
 assert.equal(rememberPlaylistCount({playlistId:id,count:25,at:base+900,owner}),null);
 assert.equal(withPlaylistCounts([{id,count:25}],owner,base+1200)[0].count,26);
 assert.equal(rememberPlaylistCount({playlistId:id,count:-1,at:base+1300,owner}),null);
});
test('confirmed saves notify mounted views and incoming cross-tab saves update their cached totals',async()=>{
 const {publishPlaylistCount,subscribePlaylistCounts}=await import('../lib/playlist-counts.ts');
 const browser=new EventTarget();const storage=new Map<string,string>();
 Object.assign(globalThis,{window:browser,localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
 const id2='abcdefghijklmnopqrstuv';let sidebar=[{id:id2,count:25}],picker=[{id:id2,count:25}];
 const stopSidebar=subscribePlaylistCounts(owner,()=>{sidebar=withPlaylistCounts(sidebar,owner)});
 const stopPicker=subscribePlaylistCounts(owner,()=>{picker=withPlaylistCounts(picker,owner)});
 publishPlaylistCount(id2,26,undefined,owner);
 assert.equal(sidebar[0].count,26);assert.equal(picker[0].count,26);
 publishPlaylistCount(id2,26,undefined,owner);assert.equal(sidebar[0].count,26);
 const remote=new Event('storage');Object.assign(remote,{key:`crate-playlist-count-update:${owner}`,newValue:JSON.stringify({playlistId:id2,count:27,at:Date.now()+1,owner})});browser.dispatchEvent(remote);
 assert.equal(sidebar[0].count,27);assert.equal(picker[0].count,27);
 assert.equal(withPlaylistCounts([{id:id2,count:25}],owner,Date.now()+2)[0].count,27);
 stopSidebar();stopPicker();Reflect.deleteProperty(globalThis,'window');Reflect.deleteProperty(globalThis,'localStorage');
});
test('saved counts and songs persist across navigation beyond the temporary event window',async()=>{
 const {syncBrowserPlaylist}=await import('../lib/playlist-counts.ts');const values=new Map<string,string>();const owner='owner',id='z'.repeat(22),key=`crate-download-workspace:${owner}`;
 values.set(key,JSON.stringify({selected:[id],library:[{id,name:'Crate Finds',count:2}],rows:[{track:{id:'old1'}},{track:{id:'old2'}}]}));values.set('crate-download-workspace:other',values.get(key)!);
 Object.assign(globalThis,{localStorage:{get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 try{const playlist={id,name:'Crate Finds',count:4} as any;const tracks=[{id:'new1'},{id:'new2'}] as any;syncBrowserPlaylist(owner,playlist,tracks);syncBrowserPlaylist(owner,playlist,tracks);const restored=JSON.parse(values.get(key)!);assert.equal(restored.library[0].count,4);assert.equal(restored.rows.length,4);assert.equal(JSON.parse(values.get('crate-download-workspace:other')!).library[0].count,2)}finally{Reflect.deleteProperty(globalThis,'localStorage')}
});
test('a later account never receives another account’s playlist event, even for the same playlist ID',async()=>{
 const {publishPlaylistCount,subscribePlaylistCounts}=await import('../lib/playlist-counts.ts');
 const browser=new EventTarget(),values=new Map<string,string>(),playlistId='q'.repeat(22);let seen=0;
 Object.assign(globalThis,{window:browser,localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 try{const stop=subscribePlaylistCounts('account-b',()=>seen++);publishPlaylistCount(playlistId,4,undefined,'account-a');assert.equal(seen,0);assert.equal(withPlaylistCounts([{id:playlistId,count:2}],'account-b')[0].count,2);stop()}finally{Reflect.deleteProperty(globalThis,'window');Reflect.deleteProperty(globalThis,'localStorage')}
});
test('a full first page plus confirmed new songs survives workspace restoration',async()=>{
 const {readDownloadWorkspace}=await import('../lib/download-workspace.ts');const {syncBrowserPlaylist}=await import('../lib/playlist-counts.ts');const playlistId='z'.repeat(22),owner='page-boundary';
 const track=(index:number)=>({id:`spotify:${String(index).padStart(22,'0')}`,title:`Track ${index}`,artist:'Artist',durationMs:180000});
 const rows=Array.from({length:50},(_,index)=>({track:track(index),matches:[],chosen:'',selected:false,error:''}));const key=`crate-download-workspace:${owner}`;
 const values=new Map([[key,JSON.stringify({version:1,selected:[playlistId],library:[{id:playlistId,name:'Crate Finds',count:50}],rows,warnings:[],nextOffset:50,showSources:false,query:''})]]);
 Object.assign(globalThis,{localStorage:{get length(){return values.size},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
 try{syncBrowserPlaylist(owner,{id:playlistId,name:'Crate Finds',count:52} as any,[track(50),track(51)] as any);const restored=readDownloadWorkspace(values.get(key)!);assert.equal(restored?.rows.length,52);assert.equal(restored?.rows[51].track.title,'Track 51');assert.equal(restored?.nextOffset,50)}finally{Reflect.deleteProperty(globalThis,'localStorage')}
});
test('a full refresh replaces removed playlists beyond page one',async()=>{
 const {refreshBrowserLibrary}=await import('../lib/playlist-counts.ts');const account='refresh-two-pages',key=`crate-saved-library:${account}`;
 const old=Array.from({length:75},(_,i)=>({id:String(i).padStart(22,'0'),name:`Playlist ${i}`,count:1}));const current=old.filter(p=>p.id!==old[65].id);const storage=new Map([[key,JSON.stringify({version:1,selected:[],rows:[],library:old,warnings:[],showSources:true,nextOffset:null,query:''})]]);let calls=0;
 Object.assign(globalThis,{localStorage:{get length(){return storage.size},key:(i:number)=>[...storage.keys()][i]??null,getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)},fetch:async(url:string)=>{calls++;const offset=Number(new URL(url,'http://localhost').searchParams.get('cursor'));return {ok:true,json:async()=>({items:current.slice(offset,offset+50),nextCursor:offset+50<current.length?String(offset+50):null,saved:false})}}});
 try{const result=await refreshBrowserLibrary(account);assert.equal(calls,2);assert.equal(result.complete,true);assert.equal(result.items.length,74);assert.equal(JSON.parse(storage.get(key)!).library.some((p:{id:string})=>p.id===old[65].id),false);assert.equal((await refreshBrowserLibrary(account)).items.length,74);assert.equal(calls,2)}finally{Reflect.deleteProperty(globalThis,'localStorage');Reflect.deleteProperty(globalThis,'fetch')}
});
