import { requireUser, requireOrigin, apiError, noStore } from '@/lib/route-auth';
import { spotifyRequest, SpotifyError } from '@/lib/spotify';
import { parseSpotifyLink, normalizePlaylist } from '@/lib/discovery-core';
import { normalizeTrack } from '@/lib/spotify-data';
export async function POST(request: Request) {
  try {
    requireOrigin(request); await requireUser(); let body; try { body = await request.json(); } catch { throw new SpotifyError('Invalid link.', 400); }
    if (typeof body?.url !== 'string' || body.url.length > 1000) throw new SpotifyError('Paste a Spotify playlist or track link.', 400);
    const parsed = parseSpotifyLink(body.url);
    const data = await spotifyRequest(`${parsed.type === 'playlist' ? 'playlists' : 'tracks'}/${parsed.id}`);
    const item = parsed.type === 'playlist' ? normalizePlaylist(data) : normalizeTrack(data, 'Selected seed');
    if (!item) throw new SpotifyError('This Spotify source is unavailable.', 404);
    return Response.json({ type: parsed.type, item }, { headers: noStore });
  } catch (e) { return apiError(e); }
}
