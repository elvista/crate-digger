import { requireUser, apiError, noStore } from '@/lib/route-auth';
import { spotifyRequest, SpotifyError } from '@/lib/spotify';
import { normalizeSearch, parseOffset } from '@/lib/spotify-data';
export async function GET(request: Request) {
  try {
    await requireUser(); const params = new URL(request.url).searchParams; const q = params.get('q')?.trim() || '';
    if (!q || q.length > 200) throw new SpotifyError('Enter a track or artist name (up to 200 characters).', 400);
    let offset; try { offset = parseOffset(params.get('cursor')); } catch { throw new SpotifyError('Invalid search cursor.', 400); }
    const query = new URLSearchParams({ q, type: 'track', limit: '10', offset: String(offset) });
    return Response.json(normalizeSearch(await spotifyRequest(`search?${query}`), 'Selected seed', offset), { headers: noStore });
  } catch (e) { return apiError(e); }
}
