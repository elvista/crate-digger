import { appConfig, matchesAppHost } from '@/lib/spotify-session';
import { hasPlaybackScope, startPosition } from '@/lib/playback-settings';
import { playbackSession, spotifyRequest, spotifyErrorResponse, SpotifyError } from '@/lib/spotify';
export async function POST(request: Request) {
  try {
    const config = appConfig();
    if (request.headers.get('origin') !== config.origin || !matchesAppHost(request, config.origin)) throw new SpotifyError('Invalid request origin.', 403);
    const session = await playbackSession();
    if (!hasPlaybackScope(session.scope)) throw new SpotifyError('Reconnect Spotify to enable playback.', 403);
    let body; try { body = await request.json(); } catch { throw new SpotifyError('Invalid playback request.', 400); }
    if (!body || !/^spotify:[A-Za-z0-9]{22}$/.test(body.trackId) || typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.deviceId) || !Number.isFinite(body.durationMs) || body.durationMs <= 0 || body.durationMs > 86400000 || !Number.isFinite(body.startPercent) || body.startPercent < 0 || body.startPercent > 95) throw new SpotifyError('Invalid playback request.', 400);
    try {
      await spotifyRequest(`me/player/play?device_id=${encodeURIComponent(body.deviceId)}`, { method: 'PUT', body: JSON.stringify({ uris: [`spotify:track:${body.trackId.slice(8)}`], position_ms: startPosition(body.durationMs, body.startPercent) }) });
    } catch (e) { if (e instanceof SpotifyError && e.status === 403) throw new SpotifyError('Spotify Premium and playback permission are required. Reconnect Spotify if needed.', 403); throw e; }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return spotifyErrorResponse(e); }
}
