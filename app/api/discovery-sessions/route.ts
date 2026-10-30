import { createCosineReader } from '@/lib/cosine';
import { cosineDiscovery } from '@/lib/cosine-core';
import { requireUser, requireOrigin, apiError, noStore } from '@/lib/route-auth';
import { parseSelection, generateDiscovery } from '@/lib/discovery-core';
import { sessionStore } from '@/lib/session-store';
import { spotifyRequest, SpotifyError } from '@/lib/spotify';
import { hasPlaylistScope } from '@/lib/playback-settings';
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    requireOrigin(request); const user = await requireUser(); let body; try { body = await request.json(); } catch { throw new SpotifyError('Invalid source selection.', 400); }
    const selection = parseSelection(body);
    if (selection.playlistIds.length && !hasPlaylistScope(user.scope)) throw new SpotifyError('Reconnect Spotify to allow reading selected playlists.', 403);
    const cosine = selection.mode === 'related' && selection.relatedMethod === 'cosine' ? createCosineReader(request.signal) : null;
    const result = await generateDiscovery(selection, spotifyRequest, request.signal, undefined, cosine ? seeds => cosineDiscovery(seeds,cosine,spotifyRequest,request.signal) : undefined);
    if (request.signal.aborted) throw new SpotifyError('Generation cancelled.', 499);
    const store = sessionStore(); const session = await store.create(user.userId, result);
    return Response.json(await store.page(user.userId, session.id, null), { headers: noStore });
  } catch (e) { return apiError(e); }
}
