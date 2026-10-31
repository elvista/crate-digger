import {rekordboxRequest} from '@/lib/rekordbox';
import {localSettingsStore} from '@/lib/local-download-settings';
import {recordingMappings} from '@/lib/recording-mappings';
import {matchingJobStore,matchingRevision} from '@/lib/matching-job';
import { createCosineReader } from '@/lib/cosine';
import { advanceMatching,createMatchingState,matchingWarnings,type MatchingState } from '@/lib/cosine-core';
import { requireUser, requireOrigin, apiError, noStore } from '@/lib/route-auth';
import { parseSelection, generateDiscovery } from '@/lib/discovery-core';
import { sessionStore } from '@/lib/session-store';
import { spotifyRequest, SpotifyError, playlistSourceCache } from '@/lib/spotify';
import { hasPlaylistScope } from '@/lib/playback-settings';
import {randomUUID} from 'node:crypto';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    requireOrigin(request); const user = await requireUser(); let body; try { body = await request.json(); } catch { throw new SpotifyError('Invalid source selection.', 400); }
    const selection = parseSelection(body);
    if (selection.playlistIds.some(id=>!id.startsWith('rekordbox:')) && !hasPlaylistScope(user.scope)) throw new SpotifyError('Reconnect Spotify to allow reading selected playlists.', 403);
    const cosine = selection.mode === 'related' && selection.relatedMethod === 'cosine' ? createCosineReader(request.signal) : null;
    let state:MatchingState|undefined;
    const result = await generateDiscovery(selection, async path=>{if(!path.startsWith('rekordbox/'))return spotifyRequest(path);const libraryPath=(await localSettingsStore().read(user.userId)).libraryPath;const id=path.slice(10);const library=await rekordboxRequest<{playlists:any[]}>('playlists',{libraryPath});const playlist=library.playlists.find(p=>p.id===id&&p.attribute===0);if(!playlist)throw new SpotifyError('Rekordbox playlist unavailable.',404);const data=await rekordboxRequest<{items:any[]}>('source-tracks',{libraryPath,playlistId:id});return {...data,name:playlist.path};}, request.signal, undefined, cosine ? async seeds => {
      state=createMatchingState(seeds,selection.reviewedIds);
      await advanceMatching(state,cosine,spotifyRequest,request.signal,undefined,recordingMappings(user.userId));
      return{items:state.items,warnings:matchingWarnings(state)};
    } : undefined,playlistSourceCache(user.userId));
    if (request.signal.aborted) throw new SpotifyError('Generation cancelled.', 499);
    result.sourceSelection={playlistIds:selection.playlistIds,trackIds:selection.trackIds,mode:selection.mode,relatedMethod:selection.relatedMethod};
    if(state)result.generation={status:state.status,target:50,resolved:state.items.length,retryAt:state.retryAt,revision:matchingRevision(state)};
    const store = sessionStore(),id=randomUUID();
    // Publish the authoritative matching state before the visible projection.
    // A crash between writes leaves only an expiring orphan job, never a
    // session that claims to be resumable without its matching state.
    if(state)await matchingJobStore().write(user.userId,id,state);
    const session = await store.create(user.userId, result,id);
    return Response.json(await store.page(user.userId, session.id, null), { headers: noStore });
  } catch (e) { return apiError(e); }
}
