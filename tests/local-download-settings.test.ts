import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localSettingsStore,validateDownloadFolder} from '../lib/local-download-settings.ts';
test('local folder settings survive restart, stay account-scoped and reject unavailable destinations',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-local-settings-'));
 try{
  const folder=join(root,'Music');await mkdir(folder);
  const store=localSettingsStore(join(root,'settings'));
  await assert.rejects(()=>store.save('one',{downloadFolder:join(root,'disconnected','Music'),libraryPath:null}),/unavailable/);
  await assert.rejects(()=>validateDownloadFolder('../relative'),/absolute/);
  const saved=await store.save('one',{downloadFolder:folder,libraryPath:null});
  assert.deepEqual(await localSettingsStore(join(root,'settings')).read('one'),saved);
  assert.notEqual((await store.read('two')).downloadFolder,saved.downloadFolder);
  await store.save('one',{downloadFolder:folder,libraryPath:null,autoImport:false});
  assert.equal((await localSettingsStore(join(root,'settings')).read('one')).autoImport,false);
  const alias=join(root,'alias');await symlink(folder,alias);
  assert.equal(await validateDownloadFolder(alias),saved.downloadFolder);
 }finally{await rm(root,{recursive:true,force:true})}
});
