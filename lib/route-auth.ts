import { CosineError } from './cosine-core';
import 'server-only';
import { playbackSession, localSession, SpotifyError, spotifyErrorResponse } from './spotify';
import { appConfig, matchesAppHost } from './spotify-session';
import { DiscoveryError } from './discovery-core';
export const requireUser = playbackSession;
export const requireLocalUser = localSession;
export function requireOrigin(request: Request) { const config = appConfig(); if (request.headers.get('origin') !== config.origin || !matchesAppHost(request, config.origin)) throw new SpotifyError('Invalid request origin.', 403); }
export function apiError(error: unknown,provider?:'local'|'youtube'|'app') { const mapped=error instanceof CosineError ? new SpotifyError(error.message,error.status,error.retryAfter,undefined,'cosine') : error instanceof DiscoveryError ? new SpotifyError(error.message, error.status,undefined,undefined,'app') : error;return spotifyErrorResponse(provider&&mapped instanceof SpotifyError?new SpotifyError(mapped.message,mapped.status,mapped.retryAfter,mapped.code,provider):mapped); }
export const noStore = { 'Cache-Control': 'no-store', 'Vary': 'Cookie' };
