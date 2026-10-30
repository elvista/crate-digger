import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal,createLogin,challenge,validState,appConfig,matchesAppHost} from '../lib/spotify-session.ts';
import {normalizeTrack,normalizeSearch,parseOffset} from '../lib/spotify-data.ts';
const secret='a'.repeat(64);
const fixture={id:'0123456789ABCDEFGHIJKL',name:'Test track',artists:[{name:'Artist one'},{name:'Artist two'}],album:{name:'Test album',images:[{url:'https://i.scdn.co/image/test'}]},duration_ms:180000,explicit:true};

test('encrypted sessions round-trip and reject tampering, wrong keys and invalid secrets',()=>{
 const session={accessToken:'private-access-token',refreshToken:'private-refresh-token',userId:'user1',expiresAt:Date.now()+1000};
 const value=seal(session,secret);assert.equal(value.includes(session.accessToken),false);assert.deepEqual(unseal(value,secret),session);
 const bytes=Buffer.from(value,'base64url');bytes[30]^=1;
 for(const candidate of [bytes.toString('base64url'),'invalid',undefined])assert.equal(unseal(candidate,secret),null);
 assert.equal(unseal(value,'b'.repeat(64)),null);assert.throws(()=>seal({},'short'),/32 characters/);
});
test('OAuth PKCE and callback state reject forged or expired sign-ins',()=>{
 assert.equal(challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
 const login=createLogin();assert.equal(validState(login,login.state),true);
 for(const [candidate,state] of [[login,'different'],[null,login.state],[login,null],[{...login,expiresAt:Date.now()-1},login.state]] as const)assert.equal(validState(candidate,state),false);
 assert.notEqual(createLogin().state,login.state);assert.deepEqual(unseal(seal(login,secret),secret),login);
});
test('OAuth configuration and incoming host validation preserve the exact redirect origin',()=>{
 const old={...process.env};
 try{
  process.env.SPOTIFY_CLIENT_ID='test-client';process.env.SESSION_SECRET=secret;
  for(const uri of ['http://localhost:3000/api/auth/spotify/callback','http://example.com/api/auth/spotify/callback','https://example.com/elsewhere']){process.env.SPOTIFY_REDIRECT_URI=uri;assert.throws(appConfig)}
  process.env.SPOTIFY_REDIRECT_URI='http://127.0.0.1:3000/api/auth/spotify/callback';assert.equal(appConfig().secure,false);
  process.env.SPOTIFY_REDIRECT_URI='https://crate.example/api/auth/spotify/callback';assert.equal(appConfig().secure,true);
 }finally{for(const name of ['SPOTIFY_CLIENT_ID','SPOTIFY_REDIRECT_URI','SESSION_SECRET']){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name]}}
 const request=new Request('http://localhost:8000/api/auth/spotify/login',{headers:{host:'127.0.0.1:8000'}});
 assert.equal(matchesAppHost(request,'http://127.0.0.1:8000'),true);assert.equal(matchesAppHost(request,'http://127.0.0.1:3000'),false);
 assert.equal(matchesAppHost(new Request('http://localhost:8000/login',{headers:{host:'attacker.example'}}),'http://127.0.0.1:8000'),false);
});
test('track normalization preserves real metadata and rejects unavailable IDs and unsafe artwork',()=>{
 const track=normalizeTrack(fixture,'Deep house')!;
 assert.equal(track.artist,'Artist one, Artist two');assert.equal(track.album,'Test album');assert.equal(track.sourceUrl,`https://open.spotify.com/track/${fixture.id}`);assert.equal(track.explicit,true);
 assert.equal('bpm' in track,false);assert.equal('previewUrl' in track,false);
 for(const value of [{...fixture,is_playable:false},{...fixture,id:'../invalid'},null])assert.equal(normalizeTrack(value,'Deep house'),null);
 for(const album of [{},{images:[{url:'https://evil.example/image'}]}])assert.equal(normalizeTrack({...fixture,album},'Deep house')?.artworkUrl,null);
});
test('search deduplicates playable results and validates bounded pagination',()=>{
 const page=normalizeSearch({tracks:{items:[fixture,fixture,{...fixture,is_playable:false}],next:'https://untrusted.example'}},'Deep house',0);
 assert.equal(page.items.length,1);assert.equal(page.nextCursor,'10');
 assert.equal(normalizeSearch({tracks:{items:[],next:null}},'Deep house',10).nextCursor,null);
 assert.equal(normalizeSearch({tracks:{items:[],next:'url'}},'Deep house',1000).nextCursor,null);
 assert.throws(()=>normalizeSearch({tracks:{}},'Deep house',0));
 assert.equal(parseOffset(null),0);assert.equal(parseOffset('10'),10);
 for(const value of ['-1','1001','1.5','01','https://evil.example','2e2'])assert.throws(()=>parseOffset(value));
});
