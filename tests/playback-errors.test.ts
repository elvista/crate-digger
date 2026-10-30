import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playbackIssue,pauseBeforeStarting} from '../lib/playback-errors.ts';
test('an unloaded SDK pause cannot block the first playback request',async()=>{
 const order:string[]=[];
 await pauseBeforeStarting({pause:async()=>{order.push('pause');throw new Error('Cannot perform operation; no list was loaded')}});order.push('start');
 assert.deepEqual(order,['pause','start']);
});
test('playback failures offer the correct recovery and preserve the provider cooldown',()=>{
 const issue=playbackIssue('Cannot perform operation; no list was loaded');
 assert.equal(issue.recovery,'retry');assert.doesNotMatch(issue.message,/no list/);
 for(const [kind,expected] of [['authentication_error','reconnect'],['account_error','reconnect'],['autoplay_failed','activate']])assert.equal(playbackIssue('',kind).recovery,expected,kind);
 assert.match(playbackIssue('','account_error').message,/Premium/);
 assert.match(playbackIssue('','NO_ACTIVE_DEVICE',404).message,/browser player/);
 assert.match(playbackIssue('','PLAYBACK_UNAVAILABLE',404).message,/recording or player/);
 const cooldown=playbackIssue('Matching will resume after cooldown','',429,'67227',1000);
 assert.equal(cooldown.retryAt,67228000);assert.equal(cooldown.recovery,'wait');assert.doesNotMatch(cooldown.message,/matching/i);
});
