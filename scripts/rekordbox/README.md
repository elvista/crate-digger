# Rekordbox connector — Phase 1

The local connector reads the configured Rekordbox library and provides isolated
compatibility checks. Automatic download imports are not enabled yet.

## Setup

From the repository root (Python 3.12 and uv):

```sh
uv venv --python 3.12 .data/rekordbox/venv
uv pip sync --python .data/rekordbox/venv/bin/python scripts/rekordbox/requirements.lock
npm run rekordbox:check
```

The environment, snapshots and receipts live under ignored `.data/rekordbox/`.
Do not commit them: library snapshots contain private collection data.

The helper accepts a JSON object on stdin and emits one JSON envelope on stdout.
Driver exception details are withheld because they can contain SQLCipher keys.

- `health`: reads configured library/schema/counts, installed versions and blockers.
- `snapshot`: makes a verified encrypted copy; requires the app and agent closed.
- `import-copy`: imports an existing MP3 into a generated copy, identified by UUID.
- `acceptance-import`: CLI-only controlled acceptance, requiring the isolated
  verification receipt. Creates a fresh backup, copies the proof MP3 into
  `~/Music/Crate Digger`, and imports it into `Crate Digger compatibility check`.
  This is a real installed-library mutation, not a routine test command.

`POST /api/rekordbox/status` exposes only health, with a local-host gate, origin
validation and the app's authenticated session. No HTTP write endpoint exists.

## Evidence from this installation

- Rekordbox 7.2.19.0342; SQLCipher schema 6000.
- Initially read 7,415 live database content rows and 98 live playlist/folder rows.
  These database counts need not equal Rekordbox's filtered UI counters.
- Verified an encrypted snapshot with `quick_check` and a read-back comparison.
- Created content and playlist records, confirmed auxiliary XML membership,
  repeated without duplication and reused the content in a second playlist.
- Verified the installed database checksum stayed unchanged during isolated work.
- Performed one controlled real import, after a separate verified backup.
- Rekordbox visibly showed `Crate Digger compatibility check (1 Track)` and the
  Space Racer file, with a waveform, BPM 118 and key 10A after opening it.
- The initial entry failed playback because of incorrect source flags; after
  the backed-up registration repair, the user confirmed it plays.

The real import receipt and backup reference are in
`.data/rekordbox/acceptance-import.json`. The backup folder includes encrypted
`master.db`, `masterPlaylists6.xml` and a manifest. Keep it until the real
playback acceptance is complete. Do not automatically restore it over later
Rekordbox edits.

## Remaining before automatic imports

- Implement Settings destination selection and final MP3 metadata writing.
- Add durable per-job playlist mapping, receipts and interrupted-write reconciliation.
- Audit all required write columns and side effects for supported versions; the
  current health probe is a preliminary compatibility check, not blanket write certification.
- Production worker must use a cross-process writer lock and process checks per
  transaction; the controlled acceptance command already takes a lock.
- Validate auxiliary XML recovery when DB commit succeeds but XML publication fails.

The proof helper preserves an unanalysed state on insertion, and overrides
pyrekordbox's first-device default using `djmdProperty`'s actual library/device IDs.
It does not implement waveforms, beat-grid generation or cloud synchronization.

Focused filesystem-only checks:

```sh
.data/rekordbox/venv/bin/python scripts/rekordbox/test_bridge.py
```

These checks do not open or modify an installed Rekordbox library. No Impeccable
checks are part of this phase.

## Playback repair checkpoint

The user reported the real acceptance entry would not load and showed a red
circled 19. The installed Rekordbox asset `Age Rating Tag (light).svg` matches
that badge: it is an age-rating indicator. The MP3 fully decoded with ffmpeg.

Found a registration bug in pyrekordbox 0.5.0: `add_content` copies a menu-item
local update counter into `ContentLink`, which contains source/status flags.
New connector imports now clear that inappropriate value and use the file's
actual inode for `rb_file_id`, following rbxport's file-identity observations.
The single acceptance entry was backed up and repaired to the local-file
registration value observed in rbxport (0x2c0600), preserving its analysis and
playlist. Receipt: `.data/rekordbox/acceptance-import.json`, `repair` field.

Rekordbox was reopened. Native input remained unreliable, so loading/playback
and visual disappearance of the badge still require confirmation; do not mark
Phase 1 playback acceptance complete from the database repair alone.

## Phase 2 and metadata completion

Playback was confirmed by the user after the source-flag repair. A subsequent
backed-up metadata update wrote `Space Racer` / `Shubostar` / `Space Racer` to
both ID3 tags and Rekordbox's Title/Artist/Album relationships. Audio was copied
without re-encoding; the filesystem identifier was updated after tagging.

The Settings page now manages account-scoped local folder preferences under
`.data/local-settings/`, a native macOS folder picker, writable-directory
validation, Finder reveal, library override and status. The browser saved
`~/Music/Crate Digger` and confirmed the library connection. Folder preferences
will be consumed by the permanent-MP3 job workflow in Phase 3. The current ZIP
worker now writes title, artist and available album tags as well.

## Phase 3 completion

New downloads save standalone tagged MP3s into the saved folder. A live Space
Racer download succeeded, and its repeat used the verified existing file without
another YouTube download. New jobs create no ZIP; old archives remain legacy jobs.
Per-track states, file verification, collision protection and Finder reveal are
available. Automatic Rekordbox playlist mapping/import is still pending.

Atomic no-overwrite publication is currently verified on APFS. Filesystems
without hard-link support return an actionable error; do not claim exFAT/FAT
support until a safe publication fallback is implemented. Interrupted receipt
publication preserves the music file, with reconciliation planned in Phase 6.

## Phase 4 completion

The read-only `playlists` action returns the selected library identity and all
live playlists/folders with full hierarchy paths. `/api/rekordbox/destination`
resolves and saves destination preferences; it does not modify Rekordbox.
Mappings under `.data/rekordbox-mappings/` are scoped to account, library ID,
canonical database path and source playlist ID. Existing ordinary playlists
retain ID mappings across renames. Duplicate names, intelligent-only matches
and removed targets require a destination choice. New names retain an explicit
create intent for Phase 5, rather than creating empty playlists now.

Version 2 download jobs now retain source playlist metadata, Spotify recording
IDs and Rekordbox mapping snapshots. Live verification captured DJ Nifty Oct's
create intent on a successful repeat/reused download. Automatic library imports
are still pending Phase 5.


## Phase 5 completion

The download worker now calls the guarded `import-job` action after MP3s are
saved. Settings can disable automatic import. `Add to Rekordbox` and retry use
existing saved files; they never redownload audio. While `rekordbox` or
`rekordboxAgent` runs, the worker reports waiting and checks again every 15 seconds.
It does not close either process automatically.

Imports validate the captured folder identity, receipt hashes, actual MP3 audio,
library identity and schema. The shared `writer.lock` serializes connector writes.
Every attempt creates a verified encrypted snapshot plus the auxiliary playlist
XML before a short immediate transaction. Only absent collection entries and
playlist memberships are created; existing content metadata/cues/grids are kept.
New local records use ContentLink `0x002c0600` and the actual filesystem inode.

Journals under `.data/rekordbox/imports/` record prepared and committed operations.
The committed destination node is merged into the latest auxiliary XML and
membership/path read-back must succeed before the job reports completion. Retries
reconcile real IDs and memberships after a commit-before-XML interruption.
Successful create intents are promoted to playlist ID mappings without replacing
a newer explicit user choice. Generated import backups retain the newest five
per library plus those needed by unfinished journals; proof snapshots are excluded.

Isolated evidence: copy `d29a9765-8bd7-44ad-ab6b-262c23e859c4` and its
`phase5-verification.json` cover repeat deduplication, second-playlist reuse,
interrupted XML recovery and local registration flags, with no installed-library
changes during that check. The live Space Racer job then waited for Rekordbox
to close and imported into DJ Nifty Oct with correct title/artist/album fields.
A full repeat reused the MP3 and kept one content row, playlist and membership.
Rekordbox displayed the imported playlist, loaded its track on deck 1 and
advanced playback before being paused. The displayed analysis was performed by
Rekordbox, not fabricated by the importer.

These initial Phase 5 limits are superseded by Phase 6 below.


## Phase 6 completion

`instrumentation.ts` starts a local-only supervisor on Node startup. It scans
unfinished account jobs immediately and every 30 seconds. `download-runner.py`
holds an OS `flock` for each worker; account admissions/control actions also use
OS locks. Recovery skips held leases, adopts old unfinished manifests, and pauses
after three recovery launches within five minutes. Terminal failed/cancelled
jobs are not restarted automatically. Detached workers can outlive the browser
and short server restarts; periodic recovery requires the local server running.

Stop writes `cancel.json` without racing worker manifest writes. Active downloads
finish the current file; import cancellation is checked before commit. After a
commit the helper completes XML/read-back before reporting a stop. Resume clears
the marker, retains the original destination identities and reuses verified
MP3s. Waiting checks back off from 15 to 120 seconds and are cancellable within
one second. Missing music/library drives wait instead of silently switching.

Before MP3 publication, a durable `.pending.json` stores the staged file's inode,
device, full hash, name and receipt. Restart may safely complete publication or
a missing receipt only when these ownership checks match. Unknown collisions
remain untouched. Recording receipts now also hash MPEG data independently of
ID3 metadata, allowing Rekordbox analysis tag updates. A legacy receipt with
changed metadata needs proof of the historical whole-file checksum, optionally
using a reconstruction of the original ID3 prefix; it is never simply trusted.

Submission request keys are stored with the job; replay returns the same job
before checking admission, while mismatched payloads are rejected. The signed-in
Downloads page also restores the latest account job from the server, so browser
storage loss does not orphan work.

Focused checks: `tests/download-files.test.ts` and
`tests/download-recovery.test.ts`; fixtures use generated audio and temporary
folders with automatic Rekordbox import disabled. They never mutate an installed
library. Browser verification exercised verified Space Racer reuse and
Stop/Resume while the real Rekordbox processes remained open.

Destination mapping locks also use OS flock in both Node and Python, so a
server exit cannot leave a permanent “being updated” file lock. A temporary
isolated-library check verified Stop after commit repairs XML without new
content, while Stop before commit leaves it untouched. A live local-server
timer recovered a generated-audio fixture without any browser request.


## Phase 7 completion

Downloads now has a compact, non-sticky summary with collapsible track details
and grouped Open Rekordbox / Show in Finder actions. Track errors and active
work expand details. Mobile controls wrap at 44px touch targets. The launch
action requires an authenticated local macOS request and a saved job; it uses
the fixed registered Rekordbox app, checks automatic jobs across accounts and
pending import journals under the writer lock, and rejects active updates.
Browser launch feedback and the 390px layout were verified. One focused launch
guard test and TypeScript checks passed; no Impeccable checks were run.
