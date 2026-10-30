import test from 'node:test';
import assert from 'node:assert/strict';
import {baseTrackTitle,relatedTrackVersion,trackVersionLabel} from '../lib/track-versions.ts';
test('version matching keeps musical subtitles while recognizing named remixes, edits and originals',()=>{
 assert.equal(baseTrackTitle('The Wolves (Act I and II)'),'The Wolves (Act I and II)');
 assert.equal(relatedTrackVersion('Latch','Latch - Jamie Jones Remix'),true);
 assert.equal(relatedTrackVersion('Latch (Radio Edit)','Latch - Jamie Jones Remix'),true);
 assert.equal(relatedTrackVersion('Latch','Latch (Live)'),false);
 assert.equal(relatedTrackVersion('Latch','Latch (Acoustic)'),false);
 assert.equal(relatedTrackVersion('Latch','Different Song (Remix)'),false);
 assert.equal(trackVersionLabel('Latch - Jamie Jones Remix'),'Remix');
 assert.equal(trackVersionLabel('Latch (Radio Edit)'),'Edit');
 assert.equal(trackVersionLabel('Latch'),'Original');
 assert.equal(trackVersionLabel('Peach VIP'),'Edit');
 assert.equal(relatedTrackVersion('Peach','Peach VIP'),true);
 assert.equal(trackVersionLabel('Live Your Life'),'Original');
 assert.equal(relatedTrackVersion('Live Your Life','Live Your Life (Club Remix)'),true);
});
