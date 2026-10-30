# Playlist and seed-based discovery plan

## Intended experience

Replace the genre-only toolbar with a source selector. Users can select multiple Spotify playlists, individual tracks, or both. Genres become optional filters.

Offer two explicit modes:

- **Dig these playlists**: load the selected playlists' existing tracks into the swipe queue, deduplicated.
- **Find related tracks**: generate new candidates from the chosen playlists and track seeds, excluding all source tracks by default.

The selector has tabs for My playlists, Find tracks, and Paste Spotify link. Playlist rows have artwork, title, track count and multi-select checkboxes. Track search results have artist and album context. A persistent selection tray shows removable source chips, source counts, and the primary Generate digging queue button. Track previews must not start while merely browsing source selections.

After generation, show the seed summary, result count, and Change sources action above the deck. Keep the prior session intact until the replacement queue is ready. Each candidate should show an honest reason such as From an artist in Late Night, or Recommended from [seed track].

## Provider capability checkpoint

Before promising true similarity, verify this application's access to Spotify recommendations, playlist contents, audio features and audio analysis. Handle denial as a supported capability state, not a transient retry loop.

Spotify's published restrictions remove Recommendations, Related Artists, Audio Features and Audio Analysis access for new use cases. Do not assume that a successful sign-in enables those APIs. See https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api.

Use current playlist-item routes (`GET /v1/playlists/{id}/items`) and pagination. Request playlist-read-private and, where needed, playlist-read-collaborative. Users reconnect to approve those additional scopes. Confirm which selected playlists are readable; inaccessible playlists remain visibly unavailable rather than being silently skipped. See https://developer.spotify.com/documentation/web-api/reference/get-playlists-items.

## Recommendation strategy

Define a RecommendationProvider independently of catalog retrieval and playback.

1. Resolve source playlists into unique track seeds and retain artist IDs, album IDs, available ISRCs, source playlist IDs and playlist snapshots. These fields extend the current normalized Track model.
2. Balance seed sampling across playlists, with equal influence per playlist by default. Explicitly selected songs get priority. Sample a range of playlist positions and cap repeated artists so a large playlist does not overwhelm a small one.
3. If Spotify Recommendations is permitted, make bounded batches of no more than five combined seeds per request, merge and deduplicate results, and retain seed provenance. No assumption of recommendations pagination: generate a bounded pool and paginate our own session. See https://developer.spotify.com/documentation/web-api/reference/get-recommendations.
4. If unavailable, offer a clearly named artist-based discovery mode using supported artist-album/catalog search requests. This finds other releases by seed artists and collaborators; it must not be presented as acoustic similarity or Spotify radio. Broader musical similarity needs a separately authorized recommendation provider and verified version matching.
5. Remove original source tracks, already-reviewed tracks and unavailable items. Deduplicate using provider IDs, supplementing with ISRC where present. Different remixes must remain distinct.
6. Diversify by source playlist and artist with explicit deterministic ranking. Do not feed Spotify catalog/user data into an LLM or train a model on it. Do not claim key, tempo or energy similarity without verified metadata.
7. Store an immutable ordered session queue with an opaque cursor and source configuration. Existing cards remain stable as users swipe. Cancellation and a generation ID prevent stale results from an older seed selection entering the new session.

Initial bounded session target: 50 unique candidates, accepting fewer if access or filtering limits the pool. Generation progress should report source resolution, candidate collection and filtering, with cancellation, partial failures and a useful empty-result state.

## Seek bar and playback

Use the Spotify Web Playback SDK rather than an iframe. Provide a true playback timeline with elapsed/total time, mouse/touch scrubbing, keyboard arrows, and accessible time labels. Seek within a song using Player.seek(milliseconds). Provide separate previous/next track controls so timeline movement is not confused with changing tracks.

Interpolate the progress display between SDK state events while playing. Resynchronize after seek/pause. While dragging, freeze the thumb to the chosen position and issue one seek on release rather than a request per pixel. Clamp seeks before the end of the track. Ignore events and seeks belonging to previous cards.

Every newly displayed song starts automatically at the saved percentage, initially 50%. Resuming a manually paused song should preserve its current position; an explicit restart action uses the configured percentage. Previous track revisits the prior card without silently changing a save/skip decision. Browser audio activation, Premium eligibility and account authorization remain visible recovery states.

Reference: https://developer.spotify.com/documentation/web-playback-sdk/reference.

## Waveform, key and BPM

Extend metadata with nullable values and provenance:

- bpm: number | null
- musicalKey: string | null (optionally Camelot notation)
- waveform: amplitude peaks, associated duration, source, and matching recording/version ID, or null

Resolve this metadata through a separate licensed provider or user-supplied, lawfully analyzable files. Confirm that any waveform source permits display alongside Spotify playback and that the recording/mix and timing match. An analysis summary or beat timings alone is not an amplitude waveform. Do not record or decode Spotify playback to derive peaks or audio features.

Display real peaks only when supplied by an authorized source. Otherwise keep a standard progress bar and show Waveform unavailable. Missing key/BPM display unavailable, never guessed values or synthetic waveform bars. Metadata lookup failure must not block playback or swiping.

If precise BPM/key/waveforms are essential for every track, selecting a provider with adequate coverage and rights is a prerequisite to that milestone.

## Implementation boundaries

- Source UI: components/SourcePicker.tsx, PlaylistPicker.tsx, TrackSeedSearch.tsx.
- Source adapters: lib/spotify-playlists.ts; recommendation orchestration: lib/recommendations/.
- Data model: extend lib/catalog.ts with identifiers and optional DJ metadata.
- Routes: /api/playlists, /api/playlists/[id]/items, /api/track-search, /api/discovery-sessions, /api/discovery-sessions/[id]/tracks.
- Player: extend hooks/useSpotifyPlayback.ts for seeking, state interpolation and history controls.
- Preferences: extend /settings without resetting the current 50% default or overwriting existing local settings.
- Session persistence: owner-scoped storage, expiration, no cross-user cache mixing. Keep expiring playback URLs and access tokens out of persistent metadata.

## Delivery order and acceptance

1. **Source selection and exact playlist digging**: multi-select, paste links, individual seeds, paginated playlist reads, explicit permission failures; no writes to Spotify playlists.
2. **Recommendation generation**: capability check, balanced source sampling, provider strategy, exclusions, diversity and cancellation. Label the active recommendation method honestly.
3. **Player timeline**: scrub/keyboard seek, elapsed/total time, previous/next, and automatic configured starting position.
4. **DJ metadata**: provider selection and rights/coverage verification, version matching, real waveforms and nullable key/BPM.

Test overlapping playlists, very large/empty/private playlists, deleted/local/episode items, wrong-link types, expired permissions, rate limits, denied recommendations, remixes, all candidates filtered out, stale generation results, rapid next/previous/seek interactions and settings persistence. Validate actual SDK playback on desktop and mobile with an authorized Premium account.

## Implementation status

Implemented: multi-playlist/track selection, paste-link resolution, exact source digging, balanced related generation with a verified Spotify-denied artist fallback, persisted owner-scoped queues, prior/next card browsing without decisions, SDK seeking, nullable DJ fields, optional permitted Spotify Audio Features, and per-user verified metadata JSON import. Real supplied waveform peaks render as a waveform seek display only when recording durations match.

Live checks confirmed Spotify track search, multi-seed generation, artist fallback and SDK playback. The account also generated a playlist-seeded queue while the app was being tested. No paid external similarity or metadata provider is configured. Database storage is required to replace the local filesystem store for multi-host/serverless deployment. Auto playback still depends on browser audio activation and Spotify Premium/permissions.
