import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playbackOwnership} from '../lib/playback-ownership.ts';
test('only another tabs explicit Play request asks the current player to release ownership',()=>{
 const listeners=new Set<(event:{data:unknown})=>void>();let released=0;const posted:unknown[]=[];
 const channel={postMessage:(data:unknown)=>posted.push(data),addEventListener:(_:'message',fn:(event:{data:unknown})=>void)=>{listeners.add(fn)},removeEventListener:(_:'message',fn:(event:{data:unknown})=>void)=>{listeners.delete(fn)}};
 const owner=playbackOwnership(channel,'a',()=>released++);
 for(const data of [null,{}, {type:'hello',id:'b'}, {type:'play-here',id:'a'}])for(const fn of listeners)fn({data});
 assert.equal(released,0);owner.request();assert.deepEqual(posted,[{type:'play-here',id:'a'}]);
 for(const fn of listeners)fn({data:{type:'play-here',id:'b'}});assert.equal(released,1);
 owner.close();assert.equal(listeners.size,0);
});
