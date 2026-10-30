import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStartPercent, normalizeStartPercent, startPosition, PlaybackQueue, hasPlaybackScope, PLAYBACK_SCOPES, clampSeek } from '../lib/playback-settings.ts';
test('playback settings retain the default, restore preferences and constrain positions to the recording',()=>{
 for(const value of [null,'{broken','{"startPercent":"75"}'])assert.equal(readStartPercent(value),50);
 assert.equal(startPosition(240000,50),120000);assert.equal(readStartPercent('{"startPercent":25}'),25);assert.equal(startPosition(240000,25),60000);assert.equal(startPosition(240000,0),0);
 assert.equal(normalizeStartPercent(150),95);assert.equal(normalizeStartPercent(-1),0);assert.equal(normalizeStartPercent(NaN),50);assert.equal(startPosition(0,50),0);assert.equal(startPosition(1,95),0);
 assert.equal(clampSeek(-1000,240000),0);assert.equal(clampSeek(250000,240000),239999);assert.equal(clampSeek(90000,240000),90000);assert.equal(clampSeek(NaN,240000),0);assert.equal(clampSeek(100,0),0);
});
test('older sessions need to reconnect before accessing playback',()=>{assert.equal(hasPlaybackScope(undefined),false);assert.equal(hasPlaybackScope('streaming'),false);assert.equal(hasPlaybackScope(PLAYBACK_SCOPES.join(' ')),true);});
test('rapid swipes serialize commands and coalesce obsolete pending cards',async()=>{const queue=new PlaybackQueue();const calls:string[]=[];let release!:()=>void;const first=new Promise<void>(resolve=>{release=resolve});let finished!:()=>void;const done=new Promise<void>(resolve=>{finished=resolve});queue.enqueue(async()=>{calls.push('start A');await first;calls.push('end A')});queue.enqueue(async()=>{calls.push('obsolete B')});queue.enqueue(async()=>{calls.push('start C');finished()});assert.deepEqual(calls,['start A']);release();await done;assert.deepEqual(calls,['start A','end A','start C']);});
test('clearing pending playback prevents an obsolete song from starting',async()=>{const queue=new PlaybackQueue();let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});let completed!:()=>void;const done=new Promise<void>(resolve=>{completed=resolve});let obsolete=false;queue.enqueue(async()=>{await pending;completed()});queue.enqueue(async()=>{obsolete=true});queue.clear();release();await done;assert.equal(obsolete,false);});

