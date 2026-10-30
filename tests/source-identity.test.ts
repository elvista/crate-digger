import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceIdentity,sourceNamesMatch,sourceDraftMethod} from '../lib/source-identity.ts';
test('source drafts preserve identity and matching method independently of the current queue',()=>{
 const active={playlistIds:['a','b'],trackIds:['c'],mode:'related' as const,relatedMethod:'cosine' as const};
 assert.equal(sourceIdentity(active),sourceIdentity({...active,playlistIds:['b','a']}));
 assert.notEqual(sourceIdentity(active),sourceIdentity({...active,trackIds:['d']}));
 assert.notEqual(sourceIdentity(active),sourceIdentity({...active,relatedMethod:'artists'}));
 assert.equal(sourceIdentity({...active,mode:'playlist'}),sourceIdentity({...active,mode:'playlist',relatedMethod:'artists'}));
 assert.equal(sourceNamesMatch(['Peach — salute'],['Latch — Disclosure']),false);assert.equal(sourceNamesMatch(['A','B'],['B','A']),true);
 assert.equal(sourceDraftMethod('artists',active),'artists');assert.equal(sourceDraftMethod(undefined,active),'cosine');assert.equal(sourceDraftMethod('bad',active),'cosine');
 assert.equal(sourceDraftMethod(undefined,{...active,relatedMethod:'auto'}),'auto');
});
