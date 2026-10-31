# Download reuse and complete Rekordbox playlist updates

Status: implemented in the local download workflow.

The folder index and cached MP3 scan, Spotify aliases and legacy receipt migration,
authenticated preflight and file confirmation, durable reuse acquisitions, serialized
folder acquisition, snapshot-based additive reconciliation, and existing-file UI
are connected. Initial inspection uses eight bounded scan workers; subsequent scans
reuse unchanged file metadata. Ambiguous candidates require confirmation.

Validation: targeted real-MP3 fixtures cover cross-upload reuse, adoption without
file modification, distinct versions, changed audio refusal, publication recovery,
worker exclusion and Stop/Resume. TypeScript and Python syntax checks pass. No live
Rekordbox playlist mutation is performed as part of automated validation.

Scope: reconciliation includes available tracks in the saved source snapshot and
selected missing tracks in the loaded batch. Larger/truncated source snapshots retain
the source reader warnings; the UI explicitly identifies loaded-batch coverage.
The rules and phases below describe the implemented architecture and acceptance goals.

## Expected behavior

When a Spotify playlist is opened in Downloads, check its tracks against the configured target folder. Reuse verified existing recordings, download only missing selected recordings, and add both groups to the chosen Rekordbox playlist exactly once.

Example: a playlist contains 28 tracks; 10 already exist in the target folder. With all tracks selected, reuse those 10 files, download the other 18, and ensure all 28 are members of the destination Rekordbox playlist. Repeating the operation downloads zero files and creates zero duplicate memberships.

“Update playlist” means additive reconciliation: preserve existing destination tracks, cues, metadata and folder hierarchy. Do not delete tracks or memberships to mirror Spotify exactly. Keep existing ordering; append missing memberships in source order. Unchecked missing songs are not downloaded. Previously downloaded songs belonging to this source playlist remain included in the playlist reconciliation, even if they do not need a download selection.

## Current implementation and gaps

- `scripts/download-files.mjs` already locks and reuses verified receipts under `<target>/.crate-digger/recordings/<videoId>.json`. It checks MP3 validity and audio identity and uses atomic publication without overwriting existing files.
- Receipt identity and locking are currently based on YouTube video ID. A different upload for the same Spotify recording can produce another MP3.
- Receipts currently record title, artist, album, video ID and file hashes, but do not retain the Spotify recording ID. Jobs already capture that ID.
- Unknown existing files are refused on filename collision, but matching files with different names are not discovered.
- `scripts/download-worker.mjs` and `scripts/rekordbox-import.mjs` already import reused saved tracks. The Python importer reuses existing collection entries and avoids repeated playlist membership.
- The UI submits only checked rows with a chosen YouTube video. Reused files need to become valid job inputs without requiring YouTube matching. Sources are paged, so reconciliation must also account for previously downloaded playlist members outside the currently displayed batch.

## Phase 1 — Persistent recording index

Add a versioned index inside the target folder's existing `.crate-digger` directory. Bind it to the captured folder identity; a different drive at the same path must not qualify.

For each recording retain:

- Canonical recording ID and associated Spotify IDs; ISRC when already available, without an extra Spotify request solely for deduplication.
- Chosen YouTube video ID and any previously verified identity aliases.
- Relative file path, filesystem identity, size, modification time, duration, title, artist and version information.
- Existing full-file and audio-payload hashes, verification state and provenance.

Migrate existing receipts lazily. Recover Spotify IDs from validated durable job manifests whose video/file identity matches the receipt. Receipts without that evidence remain usable by video ID; never invent a Spotify association from a filename.

Keep one canonical file reference per verified recording. Multiple existing copies produce one reusable choice and a visible duplicate notice; do not delete or merge the user's files.

## Phase 2 — Resolve existing files before matching

Add an authenticated local preflight endpoint for the current source playlist and configured folder. The server resolves the folder from saved settings; the browser cannot submit arbitrary filesystem paths or trusted reuse claims.

Resolution priority:

1. Verified index entry for the exact Spotify recording ID.
2. Verified known video receipt or previously confirmed recording alias.
3. Existing folder MP3 with trustworthy recording tags or a unique exact artist/title/version/duration match.
4. Ambiguous or incomplete evidence: show the candidates and require a choice before download or reuse.

Metadata matching must retain remix, edit, live, instrumental and extended-version qualifiers. Do not use the deliberately loose recommendation matcher for file identity. Duration supports identity but does not prove it. ISRC alone is insufficient when versions conflict.

Inspect pre-existing MP3 tags and properties locally, caching scan results and rescanning changed/new files. Use the configured folder itself as the initial scan boundary; do not silently traverse unrelated folders or symlink targets. A user-confirmed file gets an identity receipt without retagging, renaming or modifying its audio.

Return per-track outcomes: `available`, `missing`, `needs-review`, `unavailable-drive`, or `invalid-file`. A missing known file is eligible for download after verification that the original target drive is present. A corrupt or changed file requires review and must not be overwritten or silently bypassed with another copy.

The same Spotify ID defaults to the already verified file even if a fresh YouTube search finds a different upload. Explicit alternate recordings, if supported later, must be a deliberate separate action.

## Phase 3 — Separate acquisition from playlist reconciliation

Extend the durable job format with stable track operation IDs and explicit acquisition modes: `reuse` or `download`. A reuse item references a server-resolved recording entry and does not require a YouTube selection.

Build the job from a captured source-playlist snapshot:

- All verified previously downloaded members of that source playlist in the current folder.
- Missing tracks the user checked and matched for download.
- Deduplicate both groups by verified recording identity.

Resolve playlist pagination using saved complete snapshots when possible. If the complete source cannot be read, clearly label the operation as covering loaded tracks only; never report a whole-playlist reconciliation from one page. Any rate-limit retry keeps the prepared plan and cached data.

Before acquisition, lock by canonical recording identity plus destination folder, then recheck the file index. This closes the race where two jobs see a missing file at once, including jobs using different YouTube video IDs. Persist publication intents and index updates atomically using the existing recovery/locking infrastructure. Maintain compatibility with pending legacy jobs.

The worker skips yt-dlp, conversion and tagging for reuse items. It still verifies that the file exists and matches its identity immediately before import. Cached preflight results are advisory, not authorization to skip worker verification.

## Phase 4 — Reconcile both groups in Rekordbox

Pass every valid reused or newly saved recording to the existing guarded importer, including jobs with zero new downloads. Match collection entries by verified file identity and resolved local path; account for existing cloud-placeholder records whose local path points to the same file, avoiding a duplicate collection entry.

For each recording:

- Reuse the existing content entry when present; leave tags, cues, grids and original files untouched.
- If the file exists but is not yet in the collection, register it once using its actual metadata.
- Add missing destination membership once; preserve existing memberships and nested destination identity.

Use stable job-track IDs for import results rather than assuming every reused item has a video ID. Keep library backups, the writer lock, process guards, durable journal, auxiliary XML reconciliation and fresh read-back. Retry after any interruption must reuse the existing file/content/membership.

When Rekordbox or its background agent is open, download/reuse preparation can complete and the playlist update waits. Report this as queued, not already added. If a download fails, still import valid reused/new files and report partial completion with the failed tracks available to retry.

Automatic-import preference remains respected: when disabled, reuse/download files normally and offer an explicit Add to Rekordbox action for the same prepared set.

## Phase 5 — Compact UI

- Show `Already downloaded` beside known existing tracks, with no YouTube matching requirement.
- Run Find YouTube matches only for selected missing tracks.
- Surface uncertain matches inline with a choice of existing file or an explicit decision that it is a different recording.
- Show one concise preparation summary, for example `10 existing · 18 to download · 28 to add/check`.
- For an all-existing playlist, use `Update Rekordbox playlist` as the primary action.
- Report files and playlist outcomes separately: `18 downloaded · 10 reused · 28 ready in Rekordbox`, or the corresponding waiting/partial status.
- Recheck on folder changes and refresh; disable proceeding while the destination changes. Track existence and UI badges refresh after job completion.

## Focused validation

Keep checks limited to the changed behavior; no Impeccable checks or full suite by default.

1. **Reuse and identity:** same Spotify recording with a different video reuses one file; legitimate remix remains distinct; legacy receipt migration and untracked-file confirmation work; missing/corrupt files and ambiguous candidates cannot silently duplicate or overwrite.
2. **Mixed and all-existing jobs:** 10 reused + 18 new yields 28 unique destination members; repeat creates no files/content/memberships; an all-existing second destination gets all memberships without downloading. Run against isolated library copies only.
3. **Recovery and scope:** concurrent jobs and restart after publication create one canonical file; partial download failure still imports valid tracks; source pagination, saved snapshots, folder/drive changes and Rekordbox-open waiting remain explicit and recoverable.

Acceptance: zero download subprocess calls for verified existing tracks; one canonical file selected per recording; exactly one destination membership per successfully resolved track; no changes to existing audio or content metadata; no claim of full completion while any required track or import remains unresolved.

## Implementation order

1. Index, receipt migration and resolver.
2. Preflight API and existing-file UI states.
3. Durable reuse jobs and identity locking.
4. Complete additive playlist reconciliation, including all-existing jobs.
5. Focused fixture verification and a small local browser walkthrough.

The old plan's rule that distinct YouTube uploads always produce distinct files is superseded for the same verified Spotify recording. Different uploads are acquisition candidates; they are not automatically distinct songs.
