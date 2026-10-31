import test from 'node:test';
import assert from 'node:assert/strict';
import {spotifyRetryDetails} from '../lib/spotify-retry-message.ts';
test('song and playlist API errors share exact retry durations/deadlines without inventing quota resets or changing permission errors',()=>{
 const now=Date.UTC(2026,9,30,12);
 const limited=spotifyRetryDetails('Spotify is busy.',429,'23644',now);
 assert.match(spotifyRetryDetails('Spotify is busy.',429,'60',now+525).error,/about 1 minute/);
 assert.match(limited.error,/about 6 hours and 35 minutes/);assert.equal(limited.retryAt,now+23644000);assert.match(limited.error,/Spotify has asked us to wait/);
 assert.match(spotifyRetryDetails('Spotify API quota has been reached.',403,new Date(now+3600000).toUTCString(),now).error,/1 hour/);
 assert.match(spotifyRetryDetails('Spotify API quota has been reached.',403,undefined,now).error,/hasn’t said how long/);
 assert.deepEqual(spotifyRetryDetails('Reconnect Spotify to read playlists.',403),{error:'Reconnect Spotify to read playlists.'});
 assert.deepEqual(spotifyRetryDetails('Another download is starting.',429),{error:'Another download is starting.'});
});
