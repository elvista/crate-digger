import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberPlaylistCount,withPlaylistCounts} from '../lib/playlist-counts.ts';
const id='1234567890123456789012';
test('a confirmed write updates every cached playlist copy without changing its selection metadata',()=>{
 rememberPlaylistCount({playlistId:id,count:26,at:1000});
 const list=[{id,count:25,name:'DJ Nifty'},{id:'different',count:8,name:'Digging'}];
 assert.deepEqual(withPlaylistCounts(list,1100),[{id,count:26,name:'DJ Nifty'},list[1]]);
 assert.equal(list[0].count,25);
 assert.equal(withPlaylistCounts([{id,count:24}],1200)[0].count,26);
 assert.equal(withPlaylistCounts([{id,count:27}],62000)[0].count,27);
});
test('duplicate saves use the confirmed total rather than blindly incrementing, and older cross-tab updates cannot roll it back',()=>{
 rememberPlaylistCount({playlistId:id,count:26,at:2000});
 assert.equal(withPlaylistCounts([{id,count:26}],2100)[0].count,26);
 assert.equal(rememberPlaylistCount({playlistId:id,count:25,at:1900}),null);
 assert.equal(withPlaylistCounts([{id,count:25}],2200)[0].count,26);
 assert.equal(rememberPlaylistCount({playlistId:id,count:-1,at:3000}),null);
});
test('confirmed saves notify mounted views and incoming cross-tab saves update their cached totals',async()=>{
 const {publishPlaylistCount,subscribePlaylistCounts}=await import('../lib/playlist-counts.ts');
 const browser=new EventTarget();const storage=new Map<string,string>();
 Object.assign(globalThis,{window:browser,localStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
 const id2='abcdefghijklmnopqrstuv';let sidebar=[{id:id2,count:25}],picker=[{id:id2,count:25}];
 const stopSidebar=subscribePlaylistCounts(()=>{sidebar=withPlaylistCounts(sidebar)});
 const stopPicker=subscribePlaylistCounts(()=>{picker=withPlaylistCounts(picker)});
 publishPlaylistCount(id2,26);
 assert.equal(sidebar[0].count,26);assert.equal(picker[0].count,26);
 publishPlaylistCount(id2,26);assert.equal(sidebar[0].count,26);
 const remote=new Event('storage');Object.assign(remote,{key:'crate-playlist-count-update',newValue:JSON.stringify({playlistId:id2,count:27,at:Date.now()+1})});browser.dispatchEvent(remote);
 assert.equal(sidebar[0].count,27);assert.equal(picker[0].count,27);
 assert.equal(withPlaylistCounts([{id:id2,count:25}],Date.now()+2)[0].count,27);
 stopSidebar();stopPicker();Reflect.deleteProperty(globalThis,'window');Reflect.deleteProperty(globalThis,'localStorage');
});
