import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readDownloadWorkspace} from '../lib/download-workspace.ts';
const id='1234567890123456789012';
const video={id:'abcdefghijk',title:'Song remix',channel:'Artist',duration:240,score:.9,url:'javascript:alert(1)'};
const data={version:1,selected:[id],library:[{id,name:'My playlist'}],rows:[{track:{id:`spotify:${id}`,title:'Song',artist:'Artist',durationMs:240000,sourceUrl:'javascript:alert(1)'},matches:[video],chosen:video.id,selected:true,error:''}],warnings:['Note'],showSources:false,nextOffset:50,query:'My'};
test('download workspace restores source selection, chosen versions and selected tracks',()=>{const restored=readDownloadWorkspace(JSON.stringify(data))!;assert.deepEqual(restored.selected,[id]);assert.equal(restored.rows[0].selected,true);assert.equal(restored.rows[0].chosen,video.id);assert.equal(restored.query,'My');assert.equal(restored.nextOffset,50)});
test('restored links are canonical and invalid candidate selection is cleared',()=>{let r=readDownloadWorkspace(JSON.stringify(data))!;assert.equal(r.rows[0].matches[0].url,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(r.rows[0].track.sourceUrl,`https://open.spotify.com/track/${id}`);r=readDownloadWorkspace(JSON.stringify({...data,rows:[{...data.rows[0],chosen:'bad'}]}))!;assert.equal(r.rows[0].selected,false);assert.equal(r.rows[0].chosen,'')});
test('corrupted or unsupported workspaces fail safely',()=>{for(const raw of [null,'no json','{}',JSON.stringify({...data,version:9})])assert.equal(readDownloadWorkspace(raw),null)});
