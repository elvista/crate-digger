import {matchingJobStore} from '@/lib/matching-job';
import {recordingMappings} from '@/lib/recording-mappings';
import {matchingWarnings} from '@/lib/cosine-core';
import {normalizeTrack} from '@/lib/spotify-data';
import {sessionStore} from '@/lib/session-store';
import {requireOrigin,requireUser,apiError,noStore} from '@/lib/route-auth';
import {spotifyRequest,SpotifyError} from '@/lib/spotify';
import {StoreLockedError} from '@/lib/text-store';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 let release:(()=>Promise<void>)|undefined;
 try{
  requireOrigin(request);const user=await requireUser(),{id}=await context.params;
  const body=await request.json();if(!/^[A-Za-z0-9]{22}$/.test(body.spotifyId)||typeof body.cosineId!=='string'||typeof body.replaceId!=='string')throw new SpotifyError('Choose a valid Spotify recording.',400);
  const jobs=matchingJobStore();release=await jobs.lock(id);const state=await jobs.read(user.userId,id);
  const old=state?.items.find(t=>t.id===body.replaceId&&t.similarityTrackId===body.cosineId);
  const candidate=state?.candidates.find(t=>t.id===body.cosineId);
  if(!state||!old||!candidate)throw new SpotifyError('This match is no longer available.',404);
  const replacement=normalizeTrack(await spotifyRequest(`tracks/${body.spotifyId}`),'Audio similarity');if(!replacement)throw new SpotifyError('This recording is unavailable.',404);
  if(state.items.some(t=>t.id===replacement.id&&t.id!==old.id))throw new SpotifyError('This recording is already in your queue. Choose another version.',409);
  const chosen={...replacement,matchConfirmedByUser:true,similaritySource:'cosine.club' as const,similarityMatch:'approximate' as const,similarityTrackId:candidate.id,matchConfidence:1,matchRank:old.matchRank,matchProvenance:old.matchProvenance,reason:`Your chosen Spotify recording for ${candidate.title} by ${candidate.artist} · cosine.club`};
  await recordingMappings(user.userId).set(candidate.id,[{...replacement,matchConfirmedByUser:true}]);
  state.items=state.items.filter(t=>t.id!==old.id&&t.id!==chosen.id);state.items.push(chosen);state.items.sort((a,b)=>(b.matchRank??0)-(a.matchRank??0));
  const store=sessionStore(),page=await store.page(user.userId,id,null);if(!page)throw new SpotifyError('This session expired.',404);
  await jobs.write(user.userId,id,state);
  await store.replace(user.userId,id,{...page,items:state.items,warnings:matchingWarnings(state),generation:{status:state.status,target:50,resolved:state.items.length,retryAt:state.retryAt}});
  return Response.json({track:chosen,replacedId:old.id},{headers:noStore});
 }catch(e){if(e instanceof StoreLockedError)return Response.json({error:'Matching is updating. Try again shortly.'},{status:409,headers:noStore});return apiError(e)}
 finally{await release?.()}
}
