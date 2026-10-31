import {recordingMappings} from '@/lib/recording-mappings';
import {matchingJobStore,matchingRevision} from '@/lib/matching-job';
import {advanceMatching,matchingWarnings} from '@/lib/cosine-core';
import {createCosineReader} from '@/lib/cosine';
import {sessionStore} from '@/lib/session-store';
import {requireOrigin,requireUser,apiError,noStore} from '@/lib/route-auth';
import {spotifyRequest,SpotifyError} from '@/lib/spotify';
import {StoreLockedError} from '@/lib/text-store';
export const maxDuration=60;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 let release:(()=>Promise<void>)|undefined;
 try{
  requireOrigin(request);const user=await requireUser(),{id}=await context.params;
  const jobs=matchingJobStore(),store=sessionStore();
  const page=await store.page(user.userId,id,null);if(!page)throw new SpotifyError('This digging session expired.',404);
  release=await jobs.lock(id);
  const state=await jobs.read(user.userId,id);if(!state)throw new SpotifyError('No resumable matching job found.',404);
  await advanceMatching(state,createCosineReader(request.signal),spotifyRequest,request.signal,undefined,recordingMappings(user.userId));
  await jobs.write(user.userId,id,state);
  const generation={status:state.status,target:state.target,resolved:state.items.length,retryAt:state.retryAt,revision:matchingRevision(state)};
  await store.replace(user.userId,id,{...page,items:state.items,warnings:matchingWarnings(state),generation});
  // Full snapshots are small (at most 50); the client preserves its active card.
  return Response.json({...page,items:state.items,total:state.items.length,nextCursor:null,warnings:matchingWarnings(state),generation},{headers:noStore});
 }catch(e){if(e instanceof StoreLockedError)return Response.json({error:'Matching is already running.'},{status:409,headers:noStore});return apiError(e)}
 finally{await release?.()}
}
