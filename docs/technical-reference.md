# Crate

Electronic music discovery with Spotify sign-in, a swipe deck, Spotify Web Playback SDK, and direct saves to Spotify playlists.

## Set up Spotify sign-in

1. Register your application at https://developer.spotify.com/dashboard and enable Web API access.
2. Register this **exact** redirect URI:
   `http://127.0.0.1:3000/api/auth/spotify/callback`
3. Copy `.env.example` to `.env.local`. Set `SPOTIFY_CLIENT_ID` to your application's client ID. Generate `SESSION_SECRET` with `openssl rand -hex 32`. No Spotify client secret is needed: authorization uses PKCE.
4. Run `npm install` and `npm run dev`.
5. Open **http://127.0.0.1:3000** and choose **Sign in with Spotify**. Start and complete sign-in on the same host; localhost and 127.0.0.1 do not share cookies.

For deployment, register an HTTPS callback, set `SPOTIFY_REDIRECT_URI` to it, and retain the same private session secret across instances. Changing that secret signs out existing sessions. Keep `.env.local` out of version control.

Spotify Development Mode has account eligibility and allowed-user limits. Configure test users in your app dashboard and check the current Spotify quota-mode requirements. Public availability requires the appropriate Spotify app access. The ChatGPT Spotify connector does not supply an OAuth client ID for this standalone app.

## Authentication

- Sign-in uses Authorization Code + PKCE (S256), a random one-time state, and a 10-minute encrypted login cookie.
- Access and refresh tokens live in an AES-256-GCM encrypted HttpOnly, SameSite=Lax session cookie. Production cookies require HTTPS. Refresh tokens remain server-only. The SDK receives a short-lived access token in browser memory through an authenticated no-store endpoint; tokens are never written to localStorage.
- Route handlers refresh access tokens before expiration and retry once after an upstream 401.
- Sign-out removes the app session; it does not sign out of Spotify globally or revoke unrelated applications. Spotify app permissions can be removed in the Spotify account dashboard.
- Streaming, private profile, email and playback-control permissions are requested. Existing users must reconnect once to grant the new scopes. No library-writing permissions are requested. Saving in Crate does not write to Spotify.

## Catalog and playback

- Authenticated search uses `/v1/search` with `type=track`, genre queries and pages of 10 results, compatible with the current development-mode search limit.
- Returned track metadata includes artists, album, artwork, duration and a link to Spotify. BPM, key and record-label data are not fabricated.
- Each newly displayed track is automatically started through Spotify's Web Playback SDK at 50% of its duration by default. Spotify Premium, Web Playback SDK access in your developer app, and playback permissions are required.
- `/settings` lets listeners choose a start position from 0–95%. Changes save immediately in this browser and apply when returning to discovery. Reset restores 50%.
- Browsers can require an initial interaction to enable sound. The player provides Enable sound / retry controls and activates audio on pointer and keyboard gestures. Network and SDK initialization still affect start latency.
- Advancing cards pauses old audio immediately and serializes play requests so a stale request cannot finish after the latest card. Switching views, signing out or backgrounding pauses playback. Returning from the background requires Play unless another card is shown.
- Pagination deduplicates IDs and refills before the deck is empty. Abort controllers and request generations reject responses from old genres.
- Local decisions are saved before advancing. Libraries are stored per Spotify user in this browser, survive reloads and support undo and CSV export. No cloud synchronization is implemented.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

Tests cover encrypted sessions, tampering, state validation, PKCE, redirect configuration, metadata mapping and pagination. Live OAuth and catalog verification require your registered Spotify client ID and a permitted Spotify account.

Official documentation:
- https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- https://developer.spotify.com/documentation/web-api/reference/search
- https://developer.spotify.com/documentation/embeds/tutorials/creating-an-embed

## Playlist and seed discovery

Choose **playlists & seed tracks** above the deck. Select up to 10 playlists and 25 individual seeds, search by track/artist, or paste an `open.spotify.com` URL / Spotify URI. Reconnect Spotify once for private/collaborative playlist-read permission. Only accessible playlists can be read. Discovery reads sources; explicit Save actions write to Spotify playlists.

- **Dig selected tracks** paginates playlist contents, removes unavailable/local/episode items, and merges originals without duplicates. Each playlist is bounded at 500 source items; truncation is explicitly reported.
- **Find related tracks** attempts the app's Spotify Recommendations endpoint, batching at most five seed tracks per request. If Spotify denies that feature (403/404), the app switches to clearly labeled **artist-based discovery** using other releases by seed artists. This fallback does not claim audio similarity.
- Seed sampling balances multiple sources across playlist positions. Selected individual seeds take priority. Related queues exclude source IDs, reviewed IDs and matching ISRCs where returned; up to 50 diverse candidates are retained, with at most three per primary artist.
- Generation can be cancelled. A replacement queue is installed only after successful completion. Rate limits and transient failures do not trigger further fallback requests.
- Generated queues persist for 12 hours in encrypted files under `.data/discovery/`. IDs, pagination cursors and session reads are owner scoped. The browser remembers the active session per Spotify account and reloads it after refresh.
- The filesystem store targets this local/self-hosted app. Deployments with read-only/ephemeral filesystems or multiple independent hosts must replace it with durable owner-scoped database storage before relying on persisted queues.

## Timeline and DJ metadata

The player includes a keyboard/touch/mouse seek bar, elapsed and total time, and previous/next song navigation. Browsing history does not record save/skip decisions. Seeking issues a single SDK command on release; old-card seek events are rejected. Playback position updates between SDK events. Paused playback resumes at the paused position; new cards retain the configurable 50% starting default.

Spotify's current API access does not guarantee waveform, key or BPM. **Settings → DJ metadata** accepts JSON from a provider/file you are authorized to use. Every entry is keyed by `spotify:TRACK_ID` and includes a source plus optional `bpm`, `musicalKey`, and `waveform: {durationMs, peaks}`. Imports are validated, limited to 100 tracks/2 MB, and saved per signed-in user under `.data/dj-metadata/` with private filesystem permissions. Waveforms contain real supplied amplitude peaks (2–2048 values between 0 and 1), not fabricated bars; the duration must match the Spotify recording exactly. Missing or mismatched waveforms show a regular seek bar and an unavailable label. Metadata failures never block playback.

No audio is captured or analyzed from Spotify playback. There is no paid metadata provider configured; coverage depends on the verified metadata you import. `.data/` is ignored by version control.

When available for the registered app, BPM/key are also resolved from Spotify Audio Features. Access denials are cached briefly to avoid repeated restricted API calls. Waveforms still require supplied amplitude data; the app never synthesizes them from Spotify audio.

### cosine.club audio similarity

Create a free key at https://cosine.club/account/api and set `COSINE_API_KEY` in `.env.local` (server-only; never prefix it with NEXT_PUBLIC_). Select Change sources → Find related tracks → Similar sound · cosine.club, then generate a new queue. Existing saved queues retain their original provider.

The integration follows https://registry.scalar.com/@cosine/apis/cosineclub-api: Bearer authentication, Crate User-Agent, `/search/bulk`, `/search`, and `/tracks/{id}/similar`. It reads the songs from selected sources and uses POST `/search/bulk` in batches of up to 50 songs, with individual-track retries for up to 8 unmatched songs. It resolves at most 60 ranked candidates to Spotify for each queue. Exact normalized titles (including remix/version words) and primary artists must match. Unmatched tracks are omitted with coverage warnings; no artist-only fallback is substituted. It sends search text only, not Spotify tokens or audio. New releases and multi-artist credits may have incomplete coverage. Similarity scores are model distances, not probabilities of liking a track.

Calls have timeouts/cancellation, a bounded one-hour cache and a conservative in-process rate budget under the documented 120 requests/minute. HTTP 429 preserves Retry-After and blocks further calls temporarily. Use a shared limiter/cache before deploying multiple workers/instances. Live provider validation requires the API key; tests use documented-schema fixtures.

Live validation: authenticated cosine.club search + similarity endpoints produced 30 candidates from 1 of 8 conservatively matched seeds in a real playlist test; 19 candidates resolved to playable Spotify versions. The browser generated a cosine session and started Spotify playback. These are a single test's coverage figures, not a catalog-wide guarantee.

Bulk source discovery: playlist songs and individually selected tracks feed independent song-similarity searches. Results supported by multiple source songs rank higher; remaining candidate slots are spread across seeds. Originals, reviewed tracks and duplicate recordings are excluded. This does not claim a combined-playlist embedding. Existing playlist ingestion reads at most 500 items per playlist and reports truncation. Large multi-playlist searches remain subject to provider rate limits and request timeouts.

Bulk-source live validation: all 25 loaded songs from a selected playlist were submitted; 2 seeds matched and 24 of 40 candidate lookups resolved to playable Spotify versions. The UI showed the coverage warnings and played a result from the new queue. Final queue size may be lower after reviewed-track exclusion, deduplication and artist diversity limits.

### Direct Spotify saving

Save, swipe right, or press Right to add the current song to **Crate Finds** in Spotify. The server searches every accessible playlist page for an exact-name playlist owned by the signed-in user. It creates a private Crate Finds playlist only if none exists. An account-level filesystem lock serializes these saves to prevent concurrent creation. Only a confirmed Spotify response advances discovery; failures leave the track visible with a retry action. The local Crate tab and collection view have been removed. Existing browser decision history remains available for reviewed-track exclusion and undo; undo does not remove tracks already saved to Spotify.

Swipe up, press Up, or use the playlist arrow to choose a different existing owned playlist. Up/Down moves between destinations, Enter adds and advances, and Escape cancels. Successful saves publish the confirmed track count to the sidebar and other open app tabs, including a newly created Crate Finds playlist.

Playlist saving uses POST /me/playlists and POST /playlists/{id}/items. Destination contents are read first to skip duplicates. Private filesystem receipts protect retries and partial batches. If a creation response is lost, retry searches for Crate Finds before proceeding; it never blindly creates another playlist. Receipts and locks require durable storage; use a database and distributed lock when deploying multiple instances. Both playlist-modify-private and playlist-modify-public scopes are required; reconnect Spotify if those scopes have not yet been granted.

### Playlist downloads (local host)

Downloads is a separate menu item. Select one Spotify playlist and load their songs (50 tracks per download batch). Match titles to five YouTube candidates per song, review the precise version/duration, select matches, then convert and download the MP3 ZIP. This does not download Spotify streams. It does not bypass restricted/DRM videos or import browser cookies.

Requires a persistent local Node process plus yt-dlp, ffmpeg/ffprobe and `/usr/bin/zip`. Defaults are `/opt/homebrew/bin/yt-dlp` and `/opt/homebrew/bin/ffmpeg`; override with `YTDLP_PATH` and `FFMPEG_PATH`. Extraction uses argument arrays, fixed YouTube video URLs, per-file size/time limits, private owner-scoped spool folders and authenticated archive downloads. ZIPs stream to the browser. Background workers report progress and partial failures, and jobs persist across page reloads; old spool directories are cleaned up after 24 hours when starting another job. This worker architecture is not suitable for serverless deployment; use a dedicated job runner and private object storage there.

YouTube matches are metadata-based suggestions, not verified identical recordings. Users review candidate versions before starting a job; use audio you are authorized to download. MP3 conversion cannot restore quality missing from a compressed source. Spotify source lists are capped at the existing 500-items-per-playlist ingestion limit and the page offers next-50 batches for the remaining loaded tracks.

Downloads accepts one playlist and one active conversion job per account at a time; each job may contain multiple selected songs.
