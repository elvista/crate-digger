import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankVideos} from '../lib/youtube-match.ts';
const video=(id:string,title:string,duration:number)=>({id,title,duration,channel:'Example channel'});
test('YouTube matching prefers artist, exact version and matching duration',()=>{const results=rankVideos('Night (Club Remix)','Example',240000,[video('aaaaaaaaaaa','Example - Night (Radio Edit)',180),video('bbbbbbbbbbb','Example - Night (Club Remix)',241),video('ccccccccccc','Example Night (Club Remix) live set',3600)]);assert.equal(results[0].id,'bbbbbbbbbbb');assert.equal(results[0].url,'https://www.youtube.com/watch?v=bbbbbbbbbbb')});
test('YouTube matching discards malformed IDs and produces only canonical video URLs',()=>{assert.deepEqual(rankVideos('Song','Artist',1000,[video('../../etc','Song',1),{},null]),[])});
test('YouTube matching supports non-English song names and finite bounded scores',()=>{const results=rankVideos('বাংলা গান','শিল্পী',240000,[video('aaaaaaaaaaa','অন্য গান',240),video('bbbbbbbbbbb','শিল্পী বাংলা গান',240)]);assert.equal(results[0].id,'bbbbbbbbbbb');assert.ok(results.every(v=>v.score>=0&&v.score<=1))});
test('different versions and unknown durations never receive likely-match scores',()=>{assert.ok(rankVideos('Song','Artist',240000,[video('aaaaaaaaaaa','Artist Song Live',240)])[0].score<.8);assert.ok(rankVideos('Song Robert Remix','Artist',240000,[video('aaaaaaaaaaa','Artist Song Another Remix',240)])[0].score<.8);assert.ok(rankVideos('Song','Artist',240000,[video('aaaaaaaaaaa','Artist Song',0)])[0].score<.8)});
