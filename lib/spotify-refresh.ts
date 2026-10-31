import {createHash} from 'node:crypto';
import {seal,unseal,type Session} from './spotify-session.ts';
import {StoreLockedError,type TextStore} from './text-store.ts';
export class RefreshBusyError extends Error{}
type TokenResponse={access_token:string;refresh_token?:string;expires_in:number;scope?:string};
/** Share a rotated token across independent request workers before either updates its cookie. */
export async function refreshSessionDurably(session:Session,store:TextStore,clientId:string,secret:string,exchange:(refreshToken:string)=>Promise<TokenResponse>,now=Date.now):Promise<Session>{
 const key=createHash('sha256').update(`${clientId}:${session.userId}:${session.refreshToken}`).digest('hex');
 const name=`refresh/${key}.json`;
 const remembered=async()=>{const raw=await store.read(name);const value=unseal<Session>(raw??undefined,secret);return value?.userId===session.userId&&typeof value.refreshToken==='string'&&typeof value.accessToken==='string'&&Number.isFinite(value.expiresAt)?value:null};
 for(let attempt=0;attempt<80;attempt++){
  const saved=await remembered();if(saved&&saved.expiresAt>now()+60000)return saved;if(saved&&saved.refreshToken!==session.refreshToken)return refreshSessionDurably(saved,store,clientId,secret,exchange,now);
  let release:(()=>Promise<void>);try{release=await store.lock(`refresh/${key}`)}catch(e){if(!(e instanceof StoreLockedError))throw e;await new Promise(resolve=>setTimeout(resolve,250));continue}
  try{
   const another=await remembered();if(another&&another.expiresAt>now()+60000)return another;if(another&&another.refreshToken!==session.refreshToken)return refreshSessionDurably(another,store,clientId,secret,exchange,now);
   const data=await exchange(session.refreshToken);
   const next={...session,accessToken:data.access_token,refreshToken:data.refresh_token||session.refreshToken,scope:data.scope||session.scope,expiresAt:now()+data.expires_in*1000};
   await store.write(name,seal(next,secret));return next;
  }finally{await release()}
 }
 throw new RefreshBusyError('Spotify sign-in is refreshing in another request. Try again shortly.');
}
