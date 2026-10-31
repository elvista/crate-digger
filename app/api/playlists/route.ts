import {savedSpotify} from '@/lib/saved-spotify';
import { requireUser, apiError, noStore } from '@/lib/route-auth';
import { spotifyRequest, SpotifyError } from '@/lib/spotify';
import { hasPlaylistScope } from '@/lib/playback-settings';
import { normalizePlaylist, object } from '@/lib/discovery-core';
import { parseOffset } from '@/lib/spotify-data';
export async function GET(request: Request) {
  try {
    const session = await requireUser(); if (!hasPlaylistScope(session.scope)) throw new SpotifyError('Reconnect Spotify to allow reading your playlists.', 403);
    let offset; try { offset = parseOffset(new URL(request.url).searchParams.get('cursor')); } catch { throw new SpotifyError('Invalid playlist cursor.', 400); }
    const result=await savedSpotify(session.userId,`library:${offset}`,async()=>{
    const data = object(await spotifyRequest(`me/playlists?limit=50&offset=${offset}`,{fresh:new URL(request.url).searchParams.get('refresh')==='1'}));
    if (!Array.isArray(data.items)) throw new SpotifyError('Spotify returned an unreadable playlist list.');
    return { items: data.items.map(normalizePlaylist).filter(Boolean), nextCursor: data.next && offset < 1000 ? String(offset + 50) : null };},new URL(request.url).searchParams.get('refresh')==='1');
    return Response.json(result,{headers:noStore});
  } catch (e) { return apiError(e); }
}
