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

- **Play source songs only** paginates playlist contents, removes unavailable/local/episode items, and merges originals without duplicates. Each playlist is bounded at 500 source items; truncation is explicitly reported.
- **Find related tracks** attempts the app's Spotify Recommendations endpoint, batching at most five seed tracks per request. If Spotify denies that feature (403/404), the app switches to clearly labeled **artist-based discovery** using other releases by seed artists. This fallback does not claim audio similarity.
- Seed sampling balances multiple sources across playlist positions. Selected individual seeds take priority. Related queues exclude source IDs, reviewed IDs and matching ISRCs where returned; up to 50 tracks are retained. Cosine queues preserve matching rank and remove the older three-tracks-per-artist cap.
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

The integration uses Bearer authentication, a Crate User-Agent, `/search/bulk`, `/search`, and `/tracks/{id}/similar`. Every selected source song reaches bulk lookup in batches of 50. Individual title, collaborator, and artist fallback searches recover misses; fuzzy matches are included and labeled. It sends search text, never Spotify tokens or audio, to cosine.club.

`lib/cosine-core.ts` runs a serializable matching job. Initial batches allow 12 Spotify searches and 20 cosine reads in a 45-second step. The browser continues through POST `/api/discovery-sessions/{id}/continue` while the page is open, preserving the current card. Private jobs resume after reopening and retain partial results during cooldowns. Source ingestion still precedes job creation and can fail if Spotify is already paused.

The target is 50 unique playable Spotify recordings after source/reviewed/ISRC filtering, not 50 candidates inspected. Full bulk pools expand to 50 neighbors; short queues expand through up to 20 direct-neighbor hubs with a 1,500-candidate bound. Exhaustion is reported. Direct results rank above second-hop and broader artist discovery; mapping confidence, cosine score, seed support, and version labels remain separate. Related versions do not inherit an analyzed recording's cosine score.

Durable search caches and recording mappings reduce repeated searches. Spotify caches are scoped by app and user (whose token determines catalog availability), with 24-hour positive TTL and 30-minute negative-search TTL. Cosine responses have a one-hour cache. Shared locks and persisted Retry-After cover server instances using the same credentials. Our conservative rolling budget admits up to 18 searches / 30 seconds, reserving room up to 24 total calls for interactive operations; these are app settings, not Spotify's published limits. Checking the app session now uses the signed-in profile already stored in the encrypted session rather than requesting `/me` on every page load.

“Change recording” searches Spotify and replaces a result after validating session ownership and recording availability. The chosen mapping is reused and labeled; it receives no inherited cosine score. Mappings currently expire after 24 hours. Offline fixtures cover the four user examples, fuzzy matching, versions, ranking, expansion to 50, resume, cache reuse, ownership, and cooldowns. Fresh live validation remains dependent on the earlier Spotify cooldown ending.

Bulk source discovery: playlist songs and individually selected tracks feed independent song-similarity searches. Results supported by multiple source songs rank higher; remaining candidate slots are spread across seeds. Originals, reviewed tracks and duplicate recordings are excluded. This does not claim a combined-playlist embedding. Existing playlist ingestion reads at most 500 items per playlist and reports truncation. Large multi-playlist searches remain subject to provider rate limits and request timeouts.

Bulk-source live validation: all 25 loaded songs from a selected playlist were submitted; 2 seeds matched and 24 of 40 candidate lookups resolved to playable Spotify versions. The UI showed the coverage warnings and played a result from the new queue. Final queue size may be lower after reviewed-track exclusion, deduplication and artist diversity limits.

### Direct Spotify saving

Save, swipe right, or press Right to add the current song to **Crate Finds** in Spotify. The server searches every accessible playlist page for an exact-name playlist owned by the signed-in user. It creates a private Crate Finds playlist only if none exists. An account-level filesystem lock serializes these saves to prevent concurrent creation. Only a confirmed Spotify response advances discovery; failures leave the track visible with a retry action. The local Crate tab and collection view have been removed. Existing browser decision history remains available for reviewed-track exclusion and undo; undo does not remove tracks already saved to Spotify.

Swipe up, press Up, or use the playlist arrow to choose a different existing owned playlist. Up/Down moves between destinations, Enter adds and advances, and Escape cancels. Successful saves publish the confirmed track count to the sidebar and other open app tabs, including a newly created Crate Finds playlist.

Playlist saving uses POST /me/playlists and POST /playlists/{id}/items. Destination contents are read first to skip duplicates. Private filesystem receipts protect retries and partial batches. If a creation response is lost, retry searches for Crate Finds before proceeding; it never blindly creates another playlist. Receipts and locks require durable storage; use a database and distributed lock when deploying multiple instances. Both playlist-modify-private and playlist-modify-public scopes are required; reconnect Spotify if those scopes have not yet been granted.

### Playlist downloads (local host)

Downloads is a separate menu item. Select one Spotify playlist and load their songs (50 tracks per download batch). Match titles to five YouTube candidates per song, review the precise version/duration, select matches, then download standalone MP3s directly to the folder configured in Settings. This does not download Spotify streams. It does not bypass restricted/DRM videos or import browser cookies.

Requires a persistent local Node process plus yt-dlp and ffmpeg/ffprobe. Defaults are `/opt/homebrew/bin/yt-dlp`, `/opt/homebrew/bin/ffmpeg`, and `/opt/homebrew/bin/ffprobe`; override with `YTDLP_PATH`, `FFMPEG_PATH`, and `FFPROBE_PATH`. Version 2 jobs capture the saved output folder and directory identity. Workers stage on that filesystem, write title/artist/available album ID3 tags with a stream copy, verify MP3 properties, flush and publish without replacing an existing recording. Same-filesystem hard-link publication currently requires a compatible destination such as APFS; unsupported drives report an error. Source-video receipts under `.crate-digger/recordings/` retain a hash so repeat jobs can verify and reuse completed audio without another download. Durable publication intents allow a restart to complete a saved MP3/receipt using the staged inode/device and hash. Receipts also verify MPEG data separately from ID3 tags, allowing Rekordbox analysis tag edits while rejecting changed audio; old receipts require proof of their original full checksum before upgrading. No new ZIP is created. Legacy ZIP jobs remain available through the authenticated legacy file route.

Background workers report per-track stages, saved/reused results and partial failures. Permanent music and recording receipts are never removed by job-spool cleanup. Jobs and receipts persist across page reloads. The detached worker imports saved MP3s automatically unless disabled in Settings, waits while Rekordbox or its agent runs, and supports import-only retries. Next.js startup instrumentation scans unfinished local jobs immediately and every 30 seconds. OS account/worker/mapping locks prevent competing control actions and duplicate workers; crash loops pause after three recoveries in five minutes. Detached workers may continue across browser closure/server restarts; the recovery supervisor requires the local server running. This local filesystem architecture does not run on Vercel serverless.

YouTube matches are metadata-based suggestions, not verified identical recordings. Users review candidate versions before starting a job; use audio you are authorized to download. MP3 conversion cannot restore quality missing from a compressed source. Spotify source lists are capped at the existing 500-items-per-playlist ingestion limit and the page offers next-50 batches for the remaining loaded tracks.

Downloads accepts one playlist and one active conversion job per account at a time; each job may contain multiple selected songs. Source playlist IDs/names and Spotify recording IDs are captured with each new job. The local Rekordbox destination resolver reads live ordinary/intelligent/folder entries and full paths, persists account/library/source-ID-scoped mappings, and requests explicit choices for ambiguity, intelligent-only matches and removed destinations. Missing names become create-on-import intents. Existing destination IDs survive renames; an optimistic write check protects newer explicit choices from stale automatic resolutions. No extra Spotify lookups are needed for these mappings. The Python helper now performs guarded imports under a shared writer lock: verified encrypted backup, immediate transaction, correct local registration flags/inode, path-based collection reuse, missing memberships only, durable database/auxiliary XML journal, and fresh read-back before success. Existing collection cues, grids and metadata are preserved. Create mappings are promoted to verified playlist IDs without overwriting newer choices. Generated import backups retain five per library plus unfinished-journal dependencies. Import failures leave MP3s available for retry without another download. Durable Stop markers finish the current file or commit/XML reconciliation safely, preserve completed work, and prevent automatic restart until Resume. Retry checks back off from 15 to 120 seconds for Rekordbox, writer locks and missing original drives. Account-scoped request keys return the original job after a lost response, and server-backed latest-job lookup restores progress without local browser storage.

Single-song cosine discovery expands full bulk responses through the dedicated similarity endpoint (up to 50 neighbors). Different ISRCs no longer reject an entire reissue group; duration differences influence rank.

Version-inclusive digging prefers an exact seed but permits labeled approximate seeds. Spotify searches may include related originals, edits, or remixes of each catalog recommendation. These are labeled related versions and carry no inherited cosine audio score. Direct analyzed matches take priority over an alternate-version entry for the same Spotify track. Featured artist credits and complete comma/ampersand collaboration credits are normalized for matching.

### Additional Spotify request reuse

Playlist source caches store a complete normalized source list under the account, playlist ID, and Spotify snapshot ID for 24 hours. Each generation checks fresh playlist metadata first. If the snapshot is unchanged, source item pages are reused (a 500-song source needs one metadata call instead of ten item pages plus two metadata calls). A changed snapshot refetches and validates all pages before caching. Downloads use the same source cache across batches.

A private account-scoped read cache shares library list pages across source and destination pickers for 30 seconds and reuses search/track responses for 24 hours (empty searches: 30 minutes). Full track metadata from searches and playlist item reads prewarms direct track lookups. Incomplete album-track objects are not reused as full track records. Playlist writes invalidate the library cache before and after the attempt, including ambiguous failures. Playlist export explicitly bypasses read caches for fresh ownership, discovery, and duplicate checks; playback commands are never cached.

Successful Crate Finds saves remember its playlist ID. Later saves validate its current name and owner directly, avoiding a repeat scan of every library page. Deleted, renamed, or unowned IDs trigger normal fresh discovery. Membership reads and write receipts still protect against duplicate saves and preserve confirmed counts.
