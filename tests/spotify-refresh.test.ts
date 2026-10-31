import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTextStore} from '../lib/text-store.ts';
import {refreshSessionDurably} from '../lib/spotify-refresh.ts';
import type {Session} from '../lib/spotify-session.ts';

test('independent requests converge on one rotated Spotify token and stale cookies reuse it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'crate-refresh-'));
 try{const session:Session={userId:'fixture',name:'Fixture',scope:'playlist-read-private',accessToken:'expired',refreshToken:'old-token',expiresAt:Date.now()-1000};let exchanges=0;
  const exchange=async(token:string)=>{assert.equal(token,'old-token');exchanges++;await new Promise(resolve=>setTimeout(resolve,100));return {access_token:'new-access',refresh_token:'new-token',expires_in:3600}};
  const secret='fixture-secret-longer-than-thirty-two-characters';
  const [first,second]=await Promise.all([refreshSessionDurably(session,createTextStore(root,'refresh'),'client',secret,exchange),refreshSessionDurably(session,createTextStore(root,'refresh'),'client',secret,exchange)]);
  assert.equal(exchanges,1);assert.equal(first.refreshToken,'new-token');assert.deepEqual(second,first);
  const stale=await refreshSessionDurably(session,createTextStore(root,'refresh'),'client',secret,exchange);assert.equal(stale.accessToken,'new-access');assert.equal(exchanges,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
