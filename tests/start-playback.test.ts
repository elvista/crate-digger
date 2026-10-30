import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startPlayback} from '../lib/start-playback.ts';
test('inactive device transfers once and retries the requested recording at the correct position',async()=>{
 const calls:{path:string;body:any}[]=[];
 await startPlayback(async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});if(calls.length===1)throw Object.assign(new Error('No device'),{status:404,code:'NO_ACTIVE_DEVICE'})},'browser','spotify:track:123',109000,async milliseconds=>{assert.equal(milliseconds,750)});
 assert.deepEqual(calls.map(c=>c.path),['me/player/play?device_id=browser','me/player','me/player/play?device_id=browser']);
 assert.deepEqual(calls[1].body,{device_ids:['browser'],play:false});assert.equal(calls[2].body.position_ms,109000);
});
test('normal playback makes one request, and cooldown or unknown 404 never triggers retries',async()=>{
 let calls=0;await startPlayback(async()=>{calls++},'browser','uri',0);assert.equal(calls,1);
 for(const status of [429,404,403]){calls=0;await assert.rejects(startPlayback(async()=>{calls++;throw Object.assign(new Error('Failure'),{status})},'browser','uri',0));assert.equal(calls,1)}
});
