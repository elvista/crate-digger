import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertRekordboxCanOpen,persist} from '../scripts/download-runtime.mjs';
test('opening Rekordbox blocks active imports across accounts and unfinished commits, while allowing safely stopped or completed jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-open-'));
 try{
  const folder=join(root,'a'.repeat(64),randomUUID());await mkdir(folder,{recursive:true});const path=join(folder,'job.json'),id=folder.split('/').at(-1);
  for(const status of ['queued','running','waiting','waiting-drive','importing','recovering','stopping']){
   await persist(path,{id,status,autoImport:true,createdAt:1});await assert.rejects(assertRekordboxCanOpen(root,async()=>false),/pending imports/);
  }
  for(const status of ['done','cancelled','partial']){await persist(path,{id,status,autoImport:true,createdAt:1});await assertRekordboxCanOpen(root,async()=>false)}
  await assert.rejects(assertRekordboxCanOpen(root,async()=>true),/pending imports/);
  await persist(path,{id,status:'running',autoImport:false,createdAt:1});await assertRekordboxCanOpen(root,async()=>false);
 }finally{await rm(root,{recursive:true,force:true})}
});
