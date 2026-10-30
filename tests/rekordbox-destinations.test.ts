import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileLock} from '../scripts/download-runtime.mjs';
import {destinationMappingPath,destinationStore,resolvePlaylistDestination,validateSourcePlaylist,type LibraryPlaylists,type RekordboxPlaylist} from '../lib/rekordbox-destinations.ts';
test('playlist destinations resolve ordinary names and preserve scoped IDs through renames, ambiguity and removed targets',async()=>{
 const source=validateSourcePlaylist({id:'a'.repeat(22),name:'My set'});
 const p:RekordboxPlaylist={id:'11',name:'My set',path:'Sets / My set',parentId:'folder',attribute:0};
 const library:LibraryPlaylists={libraryId:'lib-one',libraryPath:'/one/master.db',playlists:[p]};
 assert.equal(resolvePlaylistDestination(source,[p],null).status,'ready');
 assert.deepEqual(resolvePlaylistDestination(source,[],null),{status:'ready',source,destination:{mode:'create',name:'My set',parentId:'root'},mapped:false});
 assert.equal((resolvePlaylistDestination(source,[p,{...p,id:'12',path:'Archive / My set'}],null) as {reason:string}).reason,'ambiguous');
 assert.equal((resolvePlaylistDestination(source,[{...p,attribute:4}],null) as {reason:string}).reason,'intelligent');
 const root=await mkdtemp(join(tmpdir(),'crate-rb-mappings-'));
 try{
  const destination={mode:'existing' as const,id:p.id,name:p.name,path:p.path};
  await destinationStore(root).save('owner',library,source,destination);
  const unlock=await fileLock(destinationMappingPath('owner',library,source.id,root)+'.lock');
  try{await assert.rejects(destinationStore(root).save('owner',library,source,destination),/being updated/)}finally{await unlock()}
  const saved=await destinationStore(root).read('owner',library,source.id);assert.ok(saved);
  const renamed=resolvePlaylistDestination({...source,name:'Renamed Spotify playlist'},[{...p,name:'Renamed in Rekordbox',path:'Sets / Renamed in Rekordbox'}],saved);
  assert.equal(renamed.status,'ready');if(renamed.status==='ready')assert.equal(renamed.destination.name,'Renamed in Rekordbox');
  assert.equal((resolvePlaylistDestination(source,[],saved) as {reason:string}).reason,'removed');
  assert.equal(await destinationStore(root).save('owner',library,source,{mode:'create',name:'Stale automatic choice',parentId:'root'},null),false);
  assert.deepEqual((await destinationStore(root).read('owner',library,source.id))?.destination,destination);
  assert.equal(await destinationStore(root).read('other-owner',library,source.id),null);
  assert.equal(await destinationStore(root).read('owner',{...library,libraryPath:'/copy/master.db'},source.id),null);
  assert.equal(await destinationStore(root).read('owner',{...library,libraryId:'other'},source.id),null);
  assert.throws(()=>validateSourcePlaylist({id:'bad',name:'My set'}));
 }finally{await rm(root,{recursive:true,force:true})}
});
