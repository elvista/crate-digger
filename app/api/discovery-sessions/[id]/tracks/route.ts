import { requireUser, apiError, noStore } from '@/lib/route-auth';
import { sessionStore } from '@/lib/session-store';
import {matchingJobStore,matchingRevision} from '@/lib/matching-job';
import {matchingWarnings} from '@/lib/cosine-core';
import {StoreLockedError} from '@/lib/text-store';
import { SpotifyError } from '@/lib/spotify';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); const { id } = await context.params;
    const store=sessionStore(),first=await store.page(user.userId,id,null);
    if(first?.generation){const jobs=matchingJobStore();let release:(()=>Promise<void>)|undefined;try{release=await jobs.lock(id);const state=await jobs.read(user.userId,id);if(state&&first.generation.revision!==matchingRevision(state))await store.replace(user.userId,id,{...first,items:state.items,warnings:matchingWarnings(state),generation:{status:state.status,target:state.target,resolved:state.items.length,retryAt:state.retryAt,revision:matchingRevision(state)}})}catch(e){if(!(e instanceof StoreLockedError))throw e}finally{await release?.()}}
    const result = await store.page(user.userId, id, new URL(request.url).searchParams.get('cursor'));
    if (!result) throw new SpotifyError('This digging session expired or is unavailable. Generate a new queue.', 404);
    return Response.json(result, { headers: noStore });
  } catch (e) { return apiError(e); }
}
