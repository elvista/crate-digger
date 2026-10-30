import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryGesture} from '../lib/discovery-gesture.ts';
test('upward swipes open playlists without saving or skipping the song',()=>{
 assert.equal(discoveryGesture({x:12,y:-120},{x:0,y:0}),'playlist');
 assert.equal(discoveryGesture({x:0,y:-6},{x:0,y:-800}),'playlist');
 assert.equal(discoveryGesture({x:-160,y:-300},{x:0,y:0}),'playlist');
});
test('horizontal decisions retain their direction and downward gestures do nothing',()=>{
 assert.equal(discoveryGesture({x:-140,y:10},{x:0,y:0}),'skip');
 assert.equal(discoveryGesture({x:140,y:10},{x:0,y:0}),'save');
 assert.equal(discoveryGesture({x:140,y:300},{x:0,y:0}),null);
 assert.equal(discoveryGesture({x:10,y:-30},{x:0,y:0}),null);
});
