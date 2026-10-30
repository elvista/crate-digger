import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistFocusIndex} from '../lib/playlist-keyboard.ts';
test('playlist arrow navigation starts, wraps and supports Home/End',()=>{
 assert.equal(playlistFocusIndex('ArrowDown',-1,3),0);
 assert.equal(playlistFocusIndex('ArrowDown',2,3),0);
 assert.equal(playlistFocusIndex('ArrowUp',0,3),2);
 assert.equal(playlistFocusIndex('Home',2,3),0);
 assert.equal(playlistFocusIndex('End',0,3),2);
 assert.equal(playlistFocusIndex('ArrowDown',0,0),null);
 assert.equal(playlistFocusIndex('Enter',0,3),null);
});
