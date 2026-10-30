import {recordingMappings} from '@/lib/recording-mappings';
import {matchingJobStore} from '@/lib/matching-job';
import { createCosineReader } from '@/lib/cosine';
import { advanceMatching,createMatchingState,matchingWarnings,type MatchingState } from '@/lib/cosine-core';
import { requireUser, requireOrigin, apiError, noStore } from '@/lib/route-auth';
import { parseSelection, generateDiscovery } from '@/lib/discovery-core';
import { sessionStore } from '@/lib/session-store';
import { spotifyRequest, SpotifyError, playlistSourceCache } from '@/lib/spotify';
import { hasPlaylistScope } from '@/lib/playback-settings';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    requireOrigin(request); const user = await requireUser(); let body; try { body = await request.json(); } catch { throw new SpotifyError('Invalid source selection.', 400); }
    const selection = parseSelection(body);
    if (selection.playlistIds.length && !hasPlaylistScope(user.scope)) throw new SpotifyError('Reconnect Spotify to allow reading selected playlists.', 403);
    const cosine = selection.mode === 'related' && selection.relatedMethod === 'cosine' ? createCosineReader(request.signal) : null;
    let state:MatchingState|undefined;
    const result = await generateDiscovery(selection, spotifyRequest, request.signal, undefined, cosine ? async seeds => {
      state=createMatchingState(seeds,selection.reviewedIds);
      await advanceMatching(state,cosine,spotifyRequest,request.signal,undefined,recordingMappings(user.userId));
      return{items:state.items,warnings:matchingWarnings(state)};
    } : undefined,playlistSourceCache(user.userId));
    if (request.signal.aborted) throw new SpotifyError('Generation cancelled.', 499);
    result.sourceSelection={playlistIds:selection.playlistIds,trackIds:selection.trackIds,mode:selection.mode,relatedMethod:selection.relatedMethod};
    if(state)result.generation={status:state.status,target:50,resolved:state.items.length,retryAt:state.retryAt};
    const store = sessionStore(); const session = await store.create(user.userId, result);
    if(state)await matchingJobStore().write(user.userId,session.id,state);
    return Response.json(await store.page(user.userId, session.id, null), { headers: noStore });
  } catch (e) { return apiError(e); }
}
