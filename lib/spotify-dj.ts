import 'server-only';
import { spotifyRequest, SpotifyError } from './spotify';
import { featuresToMetadata } from './dj-metadata';
const blockedUntil = new Map<string, number>();
export async function spotifyDJMetadata(userId: string, trackId: string) {
  if ((blockedUntil.get(userId) || 0) > Date.now()) return null;
  try { return featuresToMetadata(await spotifyRequest(`audio-features/${trackId.slice(8)}`)); }
  catch (e) {
    if (e instanceof SpotifyError && [403, 404, 429].includes(e.status)) {
      if (blockedUntil.size > 200) blockedUntil.clear();
      blockedUntil.set(userId, Date.now() + (e.status === 429 ? 60000 : 600000));
    }
    return null;
  }
}
