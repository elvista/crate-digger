# Crate Digger stability and stale-state fix plan for Sol

Date: 2026-10-30
Workspace: `/Users/elvista/Documents/beat-tinder`

## Implementation update — 2026-10-30

This handoff was followed by a stability pass in the same working tree. Code changes now cover the functional paths in **S01–S25**: account-scoped playlist events and complete, coalesced library refresh; confirmed-save/cache-repair separation and a common Spotify mutation lock; recoverable local locks; resumable download and membership jobs; source-switch and async-response guards; explicit source revisions and recording identities; cancellable scans and preparation outside admission locks; local audio fallback; durable save observation; matching-state recovery; coalesced token refresh; typed provider errors; and persisted-job validation. Shared download primitives, preparation, source snapshots, token refresh, and playback were extracted, and state/CSS ownership is documented for **S26**. The original findings remain below for traceability.

Focused TypeScript, playlist, storage, download recovery, playback, discovery, decision-history, settings, and Python guard checks passed. The local Discover, Downloads and Settings routes responded with HTTP 200. A prior browser walkthrough observed **Crate Finds: 5 tracks** in both Discover and Downloads, with five song rows. No Impeccable checks were run.

The **S27 mixed native import** passed against a newly created isolated Rekordbox database copy: 10 recordings imported first, then a 28-track second playlist reused those 10 collection records and created 18 new ones; all 28 memberships appeared, and replay created zero duplicate content records. The fixture copies were removed afterward. The installed database was only read.

The intermittent worker-lease test was caused by a 700 ms fixture download finishing before a busy test runner could observe its OS lock. The fixture now waits for an explicit release marker after the downloader starts, checks the held lease and competing worker, then signals Stop. The targeted concurrent file/recovery run passed with that deterministic handshake.

For **S26**, the route/global styles were parsed and 221 declarations superseded by the exact same selector, property, and media context were removed. Shared state ownership and the active route style entrypoints are documented in `docs/technical-reference.md`. Discover, Downloads and Settings still compile and return HTTP 200 after the cleanup.

## Live acceptance update — 2026-10-31

The signed-in local Discover page played a Spotify track through the Web Playback SDK: its control changed from Play to Pause, status changed to Playing, and the timeline advanced from 2:06 to 2:18 before Pause returned it to Paused. macOS Sound showed **soundcore Boom 3i** selected as output, output volume about **43%**, and Mute off. This establishes a working SDK playback transition and an unmuted output route; software tools cannot establish whether sound was physically audible at the Bluetooth speaker.

The linked Vercel project has a production Blob credential. Using that credential with temporary fixture namespaces, two independent Node processes against the real Blob store proved cross-process read visibility, one winner under simultaneous lock contention, and successful lock reuse after release. A separate cross-process fixture ran the current `refreshSessionDurably` algorithm against the same store: two workers converged on **one** simulated token exchange and a stale third session reused the rotated result. Temporary Blob objects were removed. These tests used fixture tokens and did not rotate the user's Spotify refresh token. They validate the shared storage path from separate processes, not live requests routed to multiple deployed Vercel instances. At the time of this checkpoint, production still ran commit `ac347360` and the working-tree fixes had not been deployed.

**Acceptance limit at that checkpoint:** physical audibility required a listener at the Bluetooth output, and the working-tree fixes had not yet been deployed. No live Spotify save/download or installed Rekordbox database write was used as a test.

## Production release update — 2026-10-31

The stability and Rekordbox changes were committed as `67e5522d510e65c2802a7ad5bd446c2e0c182249`, pushed to GitHub `main`, and built successfully by Vercel as production deployment `dpl_HDaiGmXuD1b5ZtqbjG3jMeBSDCoz`. The `crate-tinder.vercel.app` alias points to that deployment. Discover, Downloads and Settings returned HTTP 200. Repeated production requests to the Downloads job API returned its expected local-only 503; Rekordbox status and audio routes returned their expected hosted 403. These checks confirm the new serverless build is serving requests, but do not prove that Vercel scheduled them on distinct function instances. The earlier real Blob cross-process fixture validates shared storage and token-refresh convergence from independent processes without using a real Spotify token exchange.

Git tracks zero files in `.data/`, and the release staged no `.data/`, `.env*`, or `.vercel/` paths. Next.js output tracing explicitly excludes `./.data/**/*` for all routes. The hosted source comes from the clean Git commit; local music, Rekordbox databases and private caches were not pushed. The README now documents local server and Rekordbox setup. Physical audibility and a real multi-instance authenticated Spotify refresh remain unverified; no live save, download or installed-library mutation was performed for deployment testing.

## Scope and how to use this handoff

This is a source review of the current working tree, including the recent **uncommitted** playlist-sync and download-deduplication changes. It covers Discover, source selection, playback, Spotify saves/caches, Downloads, Rekordbox integration, settings, authentication, and persistence. This is a prioritized list of issues found, not a guarantee that every possible bug has been discovered.

Sol: implement the phases below in order. Preserve the user's uncommitted work. Inspect the indicated functions before changing them; line numbers in these compressed files change frequently. Do not assume the recent implementation summaries establish end-to-end correctness.

Evidence labels:

- **Code-confirmed:** a concrete behavior or missing guard is visible in the current code. The described failure is a reproducible scenario to cover during implementation, not necessarily a live incident already reproduced.
- **Observed + code-confirmed:** supported by behavior seen during this chat as well as source inspection.
- **Needs verification:** credible failure mode requiring a targeted reproduction before changing behavior.

The playlist-count patch already has passing targeted tests, but the observed two-to-four-track navigation flow was **not conclusively verified live** before this audit began. Finish that validation in Phase 1.

## Required product behavior to preserve

- Basement warm charcoal, cream and orange palette; compact Spotify-style structure and swipe deck.
- One seed total: one playlist OR one track.
- Spotify recommendations, including those seeded from Rekordbox, play/save through Spotify.
- Browsing existing Rekordbox recordings plays local audio and saves only local playlist membership.
- Right saves to the appropriate service's Crate Finds; up opens that recording's service-specific playlist picker, without a service toggle.
- Discover membership operations must not download, retag, move or alter original audio files.
- Downloads reuse verified existing MP3s and add reused plus newly downloaded recordings to the mapped Rekordbox playlist. Preserve existing destination membership and nested folders.
- Never modify a Rekordbox library while Rekordbox or its background agent is running. Preserve backups, journals and read-back verification.
- Reuse saved Spotify data during provider cooldowns and show clear retry information.

## Priority overview

| ID | Priority | Area | Issue |
|---|---|---|---|
| S01 | P1 | Playlist sync | Cache patching still misses paginated rows, removals and some refresh paths |
| S02 | P1 | Account isolation | Count events and memory overlays are not scoped to the signed-in account |
| S03 | P1 | Playlist save | A successful Spotify write can be reported as failed when local cache synchronization fails |
| S04 | P1 | Playlist save | Default-save and explicit-save locks do not serialize writes to the same playlist |
| S05 | P1 | Storage | Local text-store directory locks survive crashes indefinitely |
| S06 | P1 | Download recovery | Resume does not reset import-only mode when download failures remain |
| S07 | P1 | Local save | Retrying a failed membership operation returns the same terminal job |
| S08 | P1 | Source selection | Switching services leaves the old seed selected but invisible |
| S09 | P1 | Downloads | Stale preflight/confirmation results can overwrite the current selection's state |
| S10 | P2 | Refresh | Periodic library reconciliation refreshes only the first page and suppresses failures |
| S11 | P2 | File inventory | Long scans and repeated verification are performed in interactive requests and per track |
| S12 | P2 | Cancellation | Scan cancellation can release the folder lock before all scan tasks have stopped |
| S13 | P2 | Deduplication | Recording identity still relies on video IDs and filenames in important paths |
| S14 | P2 | Completeness | Playlist reconciliation and UI counts can describe different sets of tracks |
| S15 | P2 | Settings | Folder/library/preflight state is not invalidated consistently after settings change |
| S16 | P2 | Discover saves | Save completion and local-job polling are coupled to a stale card/component lifetime |
| S17 | P2 | Playback | Pause/resume and polling have timing gaps; status is not proof of audible output |
| S18 | P2 | Local playback | Codec support, error messages and retry states need precise handling |
| S19 | P2 | Queue history | Local-storage decision history can become stale across tabs or block confirmed saves |
| S20 | P2 | Matching | Matching state and visible session snapshots are committed separately |
| S21 | P2 | Authentication | Concurrent expired-token requests can race refresh-token/cookie updates |
| S22 | P2 | Errors | Provider-specific and malformed-input errors become generic Spotify failures |
| S23 | P2 | Validation | Mutable persisted records and some request payloads lack consistent runtime validation |
| S24 | P2 | Keyboard | Playlist keyboard navigation includes hidden collapsed-folder destinations |
| S25 | P3 | Rekordbox performance | Import deduplication can rescan the whole collection for each file |
| S26 | P3 | Maintainability | UI and worker state are spread across large compressed files and duplicate caches |
| S27 | P3 | Validation coverage | Current fixtures do not establish the entire deduplication/sync contract |

P1 = user-visible correctness or recovery blocker; P2 = important reliability, isolation or performance work; P3 = follow-up improvements. These are not security vulnerability ratings.

## Phase 1 — Make playlist saves and navigation consistent

### S01 — Complete persistent cache reconciliation

**Observed + code-confirmed.** Files: `lib/playlist-counts.ts` (`syncBrowserPlaylist`, `withPlaylistCounts`), `lib/saved-spotify.ts` (`syncSavedPlaylist`), `app/downloads/page.tsx` (`loadSources`, restoration), `lib/download-workspace.ts`.

The recent patch updates browser page-zero song rows and the active workspace, but leaves other saved song pages intact. It appends tracks without updating pagination. Workspace restoration then slices rows to 50. Adding songs to a full first page can therefore lose the appended rows on restore while leaving `nextOffset` stale. Server snapshot patching is additive and cannot represent removals/reordering. A song list can remain stale even when its count is correct. `withPlaylistCounts` is only a 60-second overlay and some restoration paths bypass it.

**Fix:** establish one account/playlist snapshot with revision, ordered track IDs, completeness and freshness. Keep download choices in a separate map keyed by track ID. Confirmed writes update the authoritative snapshot; invalidate derived pages rather than independently patching every copy. Authoritative refresh must replace removals/order and reconcile choices safely.

**Accept:** like two songs into an existing two-track Crate Finds, navigate Downloads → Discover → Downloads, reload and wait past 60 seconds: all views show four and Downloads contains all four. Also cover a 50→52 boundary, duplicate save, and provider-side removal with an unchanged or lower count.

### S02 — Scope all playlist events and overlays by account

**Code-confirmed.** `lib/playlist-counts.ts`: `storageKey` is global; `recent` is keyed only by playlist ID; `rememberPlaylistCount` does not require an owner; subscribers apply updates without comparing the current account. Downloads can append event tracks whenever the selected playlist ID matches.

**Fix:** use owner + playlist ID for memory/events/storage; validate incoming event payloads; require subscribers to declare owner; clear or switch account-specific memory on sign-out. Backward-compatible migration must not import an unknown-owner event into a new account.

**Accept:** switching A→B in one browser cannot change B's count, song rows or caches in response to A's old/new events, including a playlist visible to both accounts.

### S03 — Separate confirmed remote success from cache-maintenance failure

**Code-confirmed.** `app/api/playlist-export/route.ts` calls `syncSavedPlaylist` after `exportPlaylist` commits a done receipt. A snapshot write failure falls into the route's error response after Spotify has already accepted the save. Browser storage patching and the swipe decision write introduce additional success/failure boundaries. A replayed done receipt also returns the original count even after later saves changed the total.

**Fix:** return the confirmed save result independently of best-effort derived-cache repair; persist a repair/reconciliation marker where possible. Use a revision to prevent an old receipt total from overwriting a newer total. The UI should distinguish “saved, refresh pending” from a failed save. Do not repeat the Spotify append to repair a cache.

**Accept:** inject server cache-write failure and browser quota failure after Spotify success: no false failed-save claim, no duplicate append, retry repairs the view, and replaying an older operation cannot roll four tracks back to three.

### S04 — Serialize all writes by actual destination playlist

**Code-confirmed.** `app/api/playlist-export/route.ts` locks `<owner>/crate-finds` for default saves and `<owner>/playlist-<id>` for explicit saves. These are different locks for the same underlying Crate Finds playlist. Both flows can read an old item set and append concurrently.

**Fix:** retain a creation/discovery lock for finding Crate Finds, then acquire a common owner/playlist mutation lock for every destination. Define lock order to avoid deadlocks. Re-read relevant contents inside the destination lock.

**Accept:** simultaneous default and explicit saves of the same song add one membership; two different songs yield the correct combined count.

### S10 — Centralize refresh policy, including later library pages

**Code-confirmed.** `refreshBrowserLibrary` refreshes only `/api/playlists?refresh=1` (page zero), has no shared in-flight promise, and uses a browser-only throttle. Its callers merge old entries, suppress errors with empty catches, and do not reliably invalidate saved song pages. Downloads' refresh effect depends only on owner and can use an older selected playlist/row count when the request finishes.

**Fix:** refresh the affected playlist directly after a mutation; reconcile paged library snapshots with explicit freshness and coalesced requests. Guard responses by account/playlist generation. Preserve rate-limit details and saved-data notices. Do not poll the entire library frequently.

**Accept:** a playlist outside the first 50 entries updates; a failed refresh visibly retains saved data with retry timing; simultaneous mounted consumers share one refresh request.

## Phase 2 — Fix recovery and stale async ownership

### S05 — Recover abandoned local storage locks

**Code-confirmed.** `lib/text-store.ts` local `lock` uses `mkdir` and removes the directory only on release. It has no owner, lease or crash recovery. This affects exports, matching, provider request budgets and metadata storage. The remote implementation has an expiry; the local one does not.

**Fix:** use a recoverable lease or OS lock on local storage; distinguish an active owner from an abandoned lock. Never delete a live lock based solely on age. Match remote lease expiry/renewal behavior to the longest protected operation.

**Accept:** kill a fixture process while holding the lock; a later operation recovers. A second live process cannot steal it. Keep fixtures outside real app storage.

### S06 — Resume acquisition after an import-only retry

**Code-confirmed.** `app/api/downloads/jobs/route.ts` sets `job.runMode='import'` for retry-import. Resume resets failed track states but never restores download mode. `scripts/download-worker.mjs` skips acquisition when `runMode==='import'`.

**Fix:** derive the next phase from remaining acquisition/import work, not a sticky mode flag. Membership-only jobs must always remain import-only. Reuse acquisitions whose file vanished need an explicit replan/repair path rather than a permanent failure loop.

**Accept:** a partial job → retry import → resume remaining downloads eventually completes, reuses saved files and downloads only the missing tracks. A membership-only job never reaches yt-dlp.

### S07 — Retry terminal Rekordbox saves without trapping the user

**Code-confirmed.** `app/api/rekordbox/save/route.ts` returns the existing job for the same operation ID even if it is terminal failed/paused/cancelled. `saveRekordboxTrack` immediately rejects that same terminal job. The Discover retry button reuses the operation ID.

**Fix:** make retry an explicit idempotent transition that resumes/repairs the existing job after checking guards, or link to a specific resumable job in Downloads with accurate state. Do not create another membership job blindly.

**Accept:** fail an isolated membership import, fix the cause and retry from Discover: it can complete once, advance once and retain one membership.

### S08 — Keep source-service choice and seed state aligned

**Code-confirmed.** `components/SourcePicker.tsx` changes `sourceKind`/library but keeps the previously selected playlist or seed track. Since the selection tray was removed, the old seed can be invisible. Find tracks/Paste a link still use Spotify endpoints in Rekordbox mode. Restored source selections are only partially normalized in component-local state.

**Fix:** maintain a service-aware single seed in one place. Clear or intentionally restore a seed on service switch, and make search/link availability match that service. Avoid generating from a hidden seed. Normalize persisted selections before mounting the picker.

**Accept:** select Spotify A, switch to Rekordbox, press Generate: A cannot be used accidentally. A Spotify pasted seed cannot silently appear to be a local Rekordbox source.

### S09 — Guard every Downloads response by selection generation

**Code-confirmed.** The automatic preflight has an abort guard, but `confirmExisting` and several other actions do not. `confirmExisting` also omits `playlistId`, does not update `additionalExisting`, and can replace availability for a different selection after navigation. `loadSources` has no request-generation check beyond the global gate.

**Fix:** use account + playlist + folder/library identity + request generation for responses. Abort old reads and ignore late results; preserve durable writes independently. Return/update the same complete preflight model from both scan and confirmation.

**Accept:** delay A's preflight/confirmation, select B or change destination, finish A: B's availability/counts/rows stay intact.

### S16 — Decouple durable saves from card lifetime

**Code-confirmed.** `lib/rekordbox-save-client.ts` polls every two seconds without a request timeout/AbortSignal. Discover's default save uses the default `live=()=>true`, so polling survives unmount. `QuickPlaylistPicker` can close while a local job continues, but it then loses a clear completion-to-card decision path. Long-running saves use callbacks capturing the earlier current card and event history.

**Fix:** model saves by stable operation ID and track ID. Track durable job progress independently of the mounted card; cancel only observation on unmount, not the job. Commit a decision by captured track identity, once, after confirmed success. Define behavior when the user navigates away while waiting.

**Accept:** navigate away/back during a queued local save and complete it: correct track saved, correct card reviewed once, no orphan polling or accidental advancement of another card.

### S19 — Make reviewed history robust across storage failures and tabs

**Code-confirmed.** `app/page.tsx` restores and rewrites a whole localStorage event array, with no storage-event reconciliation or retention bound. Concurrent tabs can overwrite each other's decisions. A successful remote save can then encounter localStorage failure before recording the decision. Undo also leaves the remote playlist membership intact by design.

**Fix:** use append/merge semantics with stable event IDs and bounded history; separate confirmed remote result from local history persistence. Keep Undo wording explicit about its scope.

**Accept:** concurrent decisions survive; browser quota exhaustion does not turn a confirmed playlist save into a retry loop; undo restores review state without claiming to remove remote membership.

## Phase 3 — Finish the download index contract

### S11 — Move expensive inventory work out of admission requests

**Observed + code-confirmed.** The target folder had 7,121 MP3s during this chat. `recordingInventory` scans the folder, and `resolveRecording` probes/hashes matches. The preflight route holds an acquisition lock across that work; job creation holds an account admission lock while scanning; `downloadTrack` builds another inventory per track. Workers do not persist their newly generated scan cache. Initial requests took minutes before bounded scan concurrency was added.

**Fix:** use a durable/coalesced scan job with progress and a validated folder revision. Reuse one inventory per download batch; revalidate the relevant file under the acquisition lock immediately before use. Keep locks around the required mutation boundary, not the full library scan. Cache verification safely using file identity/change detection; never omit verification just to speed it up.

**Accept:** a cold large-folder scan has visible progress and cancellation; warm playlist checks reuse scan metadata; a 28-track job does not perform 28 full-folder scans; Stop/control requests are responsive.

### S12 — Drain scan workers before releasing ownership

**Code-confirmed.** `recordingInventory` runs eight async workers with `Promise.all`. One rejected worker can reject the aggregate while siblings are still probing. The route's finally then releases the acquisition lock. Aborted scans do not terminate the ffprobe processes already launched by `inspectMp3`.

**Fix:** stop dispatching on cancellation, propagate cancellation to subprocesses where safe, and await all scan workers before releasing the scan lease. Persist useful partial scan metadata with a completeness marker; do not present it as a complete scan.

**Accept:** abort a scan mid-probe: no orphan subprocesses or late writes, and another operation acquires ownership only after cleanup.

### S13 — Separate recording identity from acquisition identity

**Code-confirmed.** `scripts/download-index.mjs` accepts Spotify ID OR video ID as an automatic match. The same video can be reused for a different Spotify recording even if title/version/duration conflict. Adopted files get a synthetic 11-character video ID derived from filename. Job creation drops `durationMs`, weakening worker metadata matching. Canonical selection uses filename rather than an explicit recording identity; multiple plausible files need more deliberate handling.

**Fix:** introduce recording IDs, distinct source-video IDs and verified aliases. Preserve duration/version metadata through the job. Require a verified compatible recording association for auto-reuse; conflicting associations require review. Adoption must recheck the actual file's metadata/identity immediately before persisting the alias. Keep separate original/remix/edit recordings distinct.

**Accept:** same recording/different upload reuses; same upload/incompatible version does not silently reuse; renamed or duplicate existing files do not create aliases to the wrong recording; adoption never overwrites another receipt.

### S14 — Use one explicit reconciliation manifest and scope

**Code-confirmed.** Job creation adds existing songs from `downloadSourceSnapshot` outside the submitted batch. The UI shows submitted-row counts separately from `additionalExisting`; the primary action can show fewer tracks than the job actually processes. The saved source reader can be stale/truncated, but completeness is not part of the snapshot contract. `confirmExisting` can also drop the extra-existing count. Existing songs are included regardless of row checkbox state, as intended for reconciliation, but the checkbox UI does not make that distinction clear.

**Fix:** server-prepared manifest should declare selected acquisitions, reused memberships, source snapshot revision/completeness, exclusions and exact totals. Confirm/use that manifest at job creation. Keep the user's intended additive behavior, but ensure summaries, button count and job totals describe the same set.

**Accept:** 10 existing + 18 selected missing produces the advertised 28; all-existing jobs update membership without downloading; partial source coverage is explicit; an unrelated playlist track is never included from a stale selection.

### S15 — Broadcast and capture settings revisions

**Code-confirmed.** Downloads reads settings on mount, while changes are saved in another page/component. There is no settings-change event/revision/focus reconciliation. Preflight effect keys include the displayed folder string but not the active library/settings revision. The job route re-reads settings and can consequently use a newer destination than the preflight the user just saw.

**Fix:** add a settings revision, invalidate dependent UI state on change/focus, and bind preflight/prepared jobs to it. Reject stale preparations instead of silently redirecting them. Existing jobs retain their original folder/library snapshot.

**Accept:** change folder or library in another tab, then download: refresh/reconfirm first. A running job continues targeting its captured destination only.

## Phase 4 — Playback, matching and boundary reliability

### S17 — Validate playback transitions, not just labels

**Code-confirmed / needs audible verification.** `hooks/useSpotifyPlayback.ts` has improved SDK polling, but UI time still extrapolates every 250 ms independently of media advancement. SDK state cannot prove that a user hears sound. `pause()` does not capture a fresh position like `stop()` does. PlaybackQueue coalesces all command types, so rapid seek/pause/start sequences need reproduction. Error normalization replaces several diagnostic messages with generic text. No visible volume/output diagnostic exists.

The confirmed live finding in this chat was Mac output routed to **soundcore Boom 3i Bluetooth**, not the laptop speakers. That is not evidence of an SDK defect, and the app must not claim to detect an OS output it cannot observe.

**Fix:** keep confirmed player state, estimated timeline position and audible-output troubleshooting separate. Verify/correct pause-resume position, activation, stalled timelines, multi-tab takeover, hidden-tab behavior and end-of-track behavior. Expose browser-player volume/mute and a compact useful recovery message without extra Web API polling.

**Accept:** targeted SDK fixture plus a manual audible check in a supported browser; no false “sound verified” claim; playback state recovers after reconnect without jumping or playing a stale card.

### S18 — Make local playback format and error handling accurate

**Code-confirmed.** `hooks/useLocalPlayback.ts` retries by load/play and handles media events, but arbitrary browser codec support is not established by a file extension. The audio route accepts AIFF/M4A/etc.; the browser can still reject a codec. A non-NotAllowed play error immediately becomes a generic retry message; detailed file diagnostics primarily run through `onerror`.

**Fix:** distinguish missing file, disconnected drive, unsupported codec, browser activation and server failure. Inspect real codec/container support before promising playback; provide an explicit supported fallback strategy, if added, without modifying originals. Ensure one seek to the configured start point per load and no stale media events after switching cards.

**Accept:** real MP3 plus unsupported-codec/missing-file/drive-reconnect fixtures; repeated retry does not loop indefinitely with an unhelpful label.

### S20 — Recover matching state and session projection atomically

**Code-confirmed.** Continue and match-correction routes write the matching job, mapping and visible discovery session in separate operations. A crash between them can leave an updated matching state but an older visible queue. Locks serialize the mutation routes but do not make the multi-record commit atomic.

**Fix:** use one authoritative matching revision and derive/rebuild the session projection, or persist a commit marker/recovery step. Preserve the currently playing card while replacing background results; do not reintroduce reviewed tracks when replaying a revision.

**Accept:** interrupt between job write and session replacement, then resume/reload: the visible queue and corrected recording match the authoritative revision.

### S21 — Serialize token refresh safely

**Code-confirmed / concurrency failure needs reproduction.** `lib/spotify.ts` refreshes independently from multiple requests when the cookie token nears expiry. There is no shared refresh flight or account/session revision guard. Parallel refreshes can race rotated refresh tokens and Set-Cookie responses. Local endpoints also require `playbackSession`, so purely local actions can depend on a Spotify token refresh.

**Fix:** coalesce refresh work at the proper session scope, protect rotated tokens, and distinguish local authenticated identity from provider-token availability. A transient provider problem should not unnecessarily block existing local playback/library reads.

**Accept:** concurrent expired-token requests converge on one valid refreshed session; local-only actions retain correct authentication without requiring an unnecessary Spotify network round trip.

### S22 — Preserve error origin and retry semantics

**Code-confirmed.** `apiError` funnels many errors through Spotify normalization. YouTube-search concurrency uses a SpotifyError 429, which can be described as a Spotify cooldown. JSON parsing errors in several routes become generic provider errors. Client helpers reduce responses to `Error(message)`, losing structured code/retryAt/recovery information. Some background refresh errors are swallowed completely.

**Fix:** use a shared typed API error envelope containing provider, code, message, retryAt and recoverability. Parse invalid JSON/shape as 400. Render cache fallback and retry information inline in the affected section. Preserve actual provider Retry-After rather than inventing an exact quota reset.

**Accept:** Spotify 429, YouTube busy, local folder busy, malformed JSON, expired auth and unavailable drive each produce the right message/action; retries respect cooldowns and avoid automatic loops.

### S23 — Validate persisted and incoming mutable state

**Code-confirmed.** Track/source/session records are often cast from JSON or typed `any`. The preflight validator does not consistently reject null elements, empty/control-character names or invalid durations. The recent save route accepts client track metadata with only partial validation before storing it in shared snapshots. `readDownloadWorkspace` validates only part of a complex persisted shape. One corrupt receipt can currently block a whole folder scan.

**Fix:** use shared bounded runtime schemas at browser-storage, API, manifest, receipt and worker boundaries. Separate corrupt-record quarantine/review from safe unrelated records. Maintain strict path/owner/library checks and do not trust client file-availability claims.

**Accept:** malformed fixtures produce useful bounded failures, never unhandled exceptions or poisoned snapshots; a corrupt receipt is visible and cannot authorize reuse or silently overwrite a file.

### S24 — Restrict keyboard navigation to visible destinations

**Code-confirmed.** `QuickPlaylistPicker` queries every `[data-playlist-destination]:not(:disabled)` and auto-focuses the first one. Rekordbox trees render children inside closed `<details>`, so the set can contain hidden buttons. The focus-trap query also does not filter visibility.

**Fix:** filter to rendered/visible focusable destinations, expand ancestors intentionally when searching, and keep focus stable after list updates. Avoid stealing focus from the search field when more results arrive.

**Accept:** up/down/Enter traverses only visible playlists; collapsed folders do not consume arrow steps; Tab stays within the modal and returns to the invoking control.

## Phase 5 — Reduce repeated work and make future fixes safer

### S25 — Resolve local Rekordbox file identities once per import

**Code-confirmed.** `scripts/rekordbox/imports.py` scans the entire collection and calls `local_audio_path` for each entry when a direct FolderPath match misses, inside the per-track loop. This can multiply database/path/stat work by the number of incoming recordings.

**Fix:** build one read-only local identity lookup for the captured library revision, then reuse it for all imported files. Preserve ambiguity refusal and existing content metadata. Detect actual DB changes before commit through existing guards.

**Accept:** a multi-track import performs one lookup-building pass, reuses placeholder/local entries correctly and does not create duplicate collection records.

### S26 — Consolidate state and remove contradictory style layers

**Code-confirmed.** Downloads/Discover/SourcePicker combine large compressed render functions with many independent async gates and storage writes. CSS files repeatedly override the same selectors, including responsive rules and prior theme colors. Download inventory and file-acquisition modules also import each other.

**Fix:** after correctness changes, extract cohesive hooks/services for source snapshots, download preparation, durable jobs and playback. Remove the circular module dependency by moving shared file/verification primitives. Consolidate active CSS rules without redesigning the approved Basement direction. Add exhaustive typed job/state unions at the TS/JS/Python boundary.

**Accept:** one documented owner for each state/cache; a contributor can identify allowed job transitions and active responsive rules without tracing multiple overrides. Preserve behavior and avoid a broad rewrite.

### S27 — Close the meaningful verification gaps

**Code-confirmed.** Existing fixtures prove important MP3 and recovery behavior, but not the whole recently implemented contract. The server cache test uses minimal metadata objects; browser cache tests do not exercise real navigation/pagination. Native import code has source checks and prior isolated proofs, but the current mixed 28-track deduplication flow has not been demonstrated end-to-end in an isolated library. One worker-lease test timed out on one run and passed when rerun; investigate synchronization rather than declaring it fixed by rerunning.

**Fix:** consolidate coverage into a small number of scenario tests listed below. Improve deterministic readiness hooks where necessary. Do not add tests that merely assert implementation text or reversible styling.

## Minimal verification matrix for Sol

Run only files relevant to the phase; extend existing scenario tests rather than multiplying suites.

| Scenario | Existing place to extend / check |
|---|---|
| Two-to-four save, navigation, reload, duplicate replay, account switch, 50→52 pagination | `tests/playlist-counts.test.ts`, `tests/saved-spotify.test.ts`, one browser walkthrough |
| Remote success/local cache failure; concurrent default + explicit destination save | `tests/playlist-export.test.ts`, targeted route fixture |
| Dead lock recovery with a live contender | `tests/text-store.test.ts`, `tests/provider-cache.test.ts` |
| Mixed existing/new files, all-existing second destination, version conflict, missing reused file | `tests/download-files.test.ts`, isolated Rekordbox-copy scenario |
| Interrupt publication/import; Resume after retry-import; queued membership retry | `tests/download-recovery.test.ts`, isolated import fixture |
| Selection/folder switch during delayed preflight; job totals versus preparation scope | targeted download preparation fixture + one browser walkthrough |
| Pause/resume/seek/activation/ownership; local format failures | existing playback tests plus small hook harness if needed |
| Matching projection recovery and token refresh races | targeted store/provider fixtures |

Examples of bounded commands:

```sh
npm run test:only -- tests/playlist-counts.test.ts tests/saved-spotify.test.ts tests/playlist-export.test.ts
npm run test:only -- tests/download-files.test.ts tests/download-recovery.test.ts
npm run typecheck
```

Do not run Impeccable tests, detectors or design checks unless the user explicitly requests them. Do not run the full test suite or production build by default. Use the pinned local Python environment for isolated Rekordbox checks. Never use the installed library as an automated write fixture, never close Rekordbox automatically, and never change/delete original songs or existing playlist memberships for cleanup.

## Completion contract

- [ ] Phase 1: authoritative, account-scoped playlist state; verified two-to-four navigation flow.
- [ ] Phase 2: crashed/failed jobs recover, async responses respect current ownership, source switches cannot use hidden old seeds.
- [ ] Phase 3: one explicit acquisition/reconciliation scope; responsive, cancellable scans; compatible recording identities.
- [ ] Phase 4: truthful playback/recovery states, matching projections recover, provider errors and token refresh remain consistent.
- [ ] Phase 5: bounded meaningful coverage and simpler state/style ownership.
- [ ] Report concrete changes, targeted checks, unresolved issues and any live behavior not verified. Do not claim audible output or live Rekordbox mutation based only on a passing typecheck.

Audit deliverable: this Markdown plan only. No additional application fixes were made as part of the audit. The earlier uncommitted sync patch remains in the working tree and must be reviewed, completed and validated with the rest of the work.
