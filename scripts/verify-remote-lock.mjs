/** One-off real Blob acceptance check. Run with BLOB_READ_WRITE_TOKEN set. */
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {del} from '@vercel/blob';
import {createTextStore,StoreLockedError} from '../lib/text-store.ts';

const [, , mode, namespace, name] = process.argv;
const storeFor = scope => createTextStore(process.cwd(),scope);

if (mode === 'contend') {
  const store=storeFor(namespace);
  try {
    const release=await store.lock(name);
    try { await new Promise(resolve=>setTimeout(resolve,1200)); }
    finally { await release(); }
    process.stdout.write('acquired\n');
  } catch (error) {
    if (!(error instanceof StoreLockedError)) throw error;
    process.stdout.write('locked\n');
  }
} else if (mode === 'read') {
  const value=await storeFor(namespace).read(name);
  if (value !== 'cross-instance') throw new Error('Remote read did not see the other instance’s write.');
  process.stdout.write('read\n');
} else {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN is required.');
  const scope=`stability-acceptance-${randomUUID()}`,store=storeFor(scope),key='fixture/value.json';
  if (!store.remote) throw new Error('Remote storage was not selected.');
  const child=(action,target)=>new Promise((resolve,reject)=>{
    const processHandle=spawn(process.execPath,['--experimental-strip-types',process.argv[1],action,scope,target],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
    let out='',err='';processHandle.stdout.on('data',chunk=>out+=chunk);processHandle.stderr.on('data',chunk=>err+=chunk);
    processHandle.on('error',reject);processHandle.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err.trim()||`Child exited ${code}`)));
  });
  try {
    await store.write(key,'cross-instance');
    if (await child('read',key)!=='read') throw new Error('Cross-instance read failed.');
    const results=await Promise.all([child('contend','fixture/lock'),child('contend','fixture/lock')]);
    if (results.filter(result=>result==='acquired').length!==1||results.filter(result=>result==='locked').length!==1) throw new Error(`Lock contention failed: ${results.join(', ')}`);
    if (await child('contend','fixture/lock')!=='acquired') throw new Error('Released lock could not be acquired.');
    process.stdout.write(JSON.stringify({remoteRead:true,oneWinner:true,releasedLockReusable:true})+'\n');
  } finally {
    await del(`crate-digger/${scope}/${key}`);
  }
}
