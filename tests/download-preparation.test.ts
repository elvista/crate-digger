import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDownloadTracks} from '../lib/download-preparation.ts';

test('a checked source prepares 10 reused and 18 new recordings, then reuses all 28 for another destination',async()=>{
 const make=(n:number)=>({spotifyTrackId:`spotify:${String(n).padStart(22,'0')}`,videoId:String(n).padStart(11,'0'),acquisition:'download' as 'download'|'reuse',title:`Song ${n}`,artist:'Fixture',durationMs:180000});
 const tracks=Array.from({length:28},(_,n)=>make(n));
 const source=new Map(tracks.map(t=>[t.spotifyTrackId,t]));
 const first=await prepareDownloadTracks(tracks.slice(10),source,tracks.slice(0,10).map(t=>t.spotifyTrackId),async track=>Number(track.title.slice(5))<10?{status:'available',recording:{videoId:track.videoId,filename:`${track.title}.mp3`,recordingId:`audio:${track.videoId}`}}:{status:'missing'});
 assert.equal(first.length,28);assert.equal(first.filter(t=>t.acquisition==='reuse').length,10);assert.equal(first.filter(t=>t.acquisition==='download').length,18);
 const second=await prepareDownloadTracks([],source,tracks.map(t=>t.spotifyTrackId),async track=>({status:'available',recording:{videoId:track.videoId,filename:`${track.title}.mp3`,recordingId:`audio:${track.videoId}`}}));
 assert.equal(second.length,28);assert.ok(second.every(t=>t.acquisition==='reuse'));
});

test('preparation rejects stale source membership, changed files and conflicting versions',async()=>{
 const track={spotifyTrackId:'spotify:'+'a'.repeat(22),videoId:'aaaaaaaaaaa',acquisition:'reuse' as const,title:'Original',artist:'Fixture'};
 await assert.rejects(prepareDownloadTracks([],new Map(),[track.spotifyTrackId],async()=>({status:'available'})),/source playlist changed/);
 await assert.rejects(prepareDownloadTracks([track],new Map(),[],async()=>({status:'missing'})),/existing file is missing/);
 await assert.rejects(prepareDownloadTracks([{...track,acquisition:'download' as const,title:'Remix'}],new Map(),[],async()=>({status:'needs-review',message:'Version conflict'})),/Version conflict/);
 const alias={...track,spotifyTrackId:'spotify:'+'b'.repeat(22)};
 const prepared=await prepareDownloadTracks([track,alias],new Map(),[],async()=>({status:'available',recording:{videoId:track.videoId,filename:'same.mp3',recordingId:'audio:same'}}));
 assert.equal(prepared.length,1);
});
