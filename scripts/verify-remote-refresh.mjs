/** Isolated cross-process token-rotation acceptance against the configured Blob store. */
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {del} from '@vercel/blob';
import {createTextStore} from '../lib/text-store.ts';
import {refreshSessionDurably} from '../lib/spotify-refresh.ts';

const [, , mode, namespace] = process.argv;
const store=createTextStore(process.cwd(),namespace);
const session={userId:'fixture',name:'Fixture',scope:'playlist-read-private',accessToken:'expired',refreshToken:'old-token',expiresAt:Date.now()-1000};
const clientId='remote-acceptance-fixture',secret='fixture-secret-longer-than-thirty-two-characters';
const exchange=async token=>{
  if(token!=='old-token')throw new Error('Unexpected refresh token.');
  const release=await store.lock('exchange-counter');
  try { const count=Number(await store.read('exchange-counter.json')||0);await store.write('exchange-counter.json',String(count+1)); }
  finally { await release(); }
  await new Promise(resolve=>setTimeout(resolve,300));
  return {access_token:'rotated-access',refresh_token:'rotated-refresh',expires_in:3600};
};

if(mode==='refresh'){
  const updated=await refreshSessionDurably(session,store,clientId,secret,exchange);
  if(updated.accessToken!=='rotated-access'||updated.refreshToken!=='rotated-refresh')throw new Error('Rotated token was not shared.');
  process.stdout.write('shared\n');
}else{
  if(!store.remote)throw new Error('BLOB_READ_WRITE_TOKEN is required.');
  const scope=`stability-rotation-${randomUUID()}`;
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--experimental-strip-types',process.argv[1],'refresh',scope],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
    let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);
    child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err.trim()||`Child exited ${code}`)));
  });
  const key=createHash('sha256').update(`${clientId}:${session.userId}:${session.refreshToken}`).digest('hex');
  try{
    const results=await Promise.all([run(),run()]);
    if(results.some(value=>value!=='shared')||await createTextStore(process.cwd(),scope).read('exchange-counter.json')!=='1')throw new Error('Parallel requests did not converge on one exchange.');
    if(await run()!=='shared'||await createTextStore(process.cwd(),scope).read('exchange-counter.json')!=='1')throw new Error('A stale session repeated the exchange.');
    process.stdout.write(JSON.stringify({parallelWorkers:2,spotifyExchanges:1,staleSessionReused:true})+'\n');
  }finally{
    await del([`crate-digger/${scope}/exchange-counter.json`,`crate-digger/${scope}/refresh/${key}.json`]);
  }
}
