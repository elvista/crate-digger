import { CosineError } from './cosine-core';
import 'server-only';
import { playbackSession, SpotifyError, spotifyErrorResponse } from './spotify';
import { appConfig, matchesAppHost } from './spotify-session';
import { DiscoveryError } from './discovery-core';
export const requireUser = playbackSession;
export function requireOrigin(request: Request) { const config = appConfig(); if (request.headers.get('origin') !== config.origin || !matchesAppHost(request, config.origin)) throw new SpotifyError('Invalid request origin.', 403); }
export function apiError(error: unknown) { return spotifyErrorResponse(error instanceof CosineError ? new SpotifyError(error.message,error.status,error.retryAfter) : error instanceof DiscoveryError ? new SpotifyError(error.message, error.status) : error); }
export const noStore = { 'Cache-Control': 'no-store', 'Vary': 'Cookie' };
