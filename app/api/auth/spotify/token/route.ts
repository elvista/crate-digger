import { playbackSession, spotifyErrorResponse, SpotifyError } from '@/lib/spotify';
import { hasPlaybackScope } from '@/lib/playback-settings';
export async function GET() {
  try {
    const session = await playbackSession();
    if (!hasPlaybackScope(session.scope)) throw new SpotifyError('Reconnect Spotify to enable playback.', 403);
    // The official SDK requires a short-lived access token in memory. Never expose the refresh token.
    return Response.json({ accessToken: session.accessToken }, { headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie' } });
  } catch (e) { return spotifyErrorResponse(e); }
}
