# Whole-site critique fixes

Source: `.impeccable/critique/2026-10-30T04-06-01Z__app.md`, the archived full website critique. Preserve the Basement visual identity and Spotify library / Tinder discovery interaction.

## Implemented

- **Listening hierarchy:** secondary help and recommendation details move below the listening loop. Artwork flexes to keep Pass, Playlist and Save visible. Recovery content takes space from artwork instead of clipping its button. Duplicate title-level playlist action and persistent shortcut strip are removed.
- **Playback recovery:** pause failures on an SDK device with no loaded list no longer prevent starting a recording. SDK/API errors become actionable playback messages. Retry-After produces a disabled retry and an actual availability time; generation and playback copy remain distinct. Reconnect recreates the browser SDK device. A confirmed NO_ACTIVE_DEVICE response triggers one transfer to the requested device and one retry, never a rate-limit retry loop. Returning from the playlist picker preserves the previous recording position.
- **Download completion:** progress and the ready ZIP appear directly below the playlist heading, above the track rows, and remain sticky. Prepare MP3s, Download ZIP and Prepare another ZIP are distinct actions.
- **Source selection:** current queue sources remain distinct from draft selections. Changed selections show Changes not applied with an explicit apply action. New sessions store the applied source IDs, mode and matching method. Source and destination libraries can be filtered by name without new Spotify search calls. The source track search is a 44px icon button beside its input. Mobile sources open in a focus-contained sheet with reachable bottom action, Escape dismissal and focus restoration.
- **Analysis settings:** missing BPM/key/waveform placeholders no longer repeat on each card. One analysis disclosure links to honest setup information. JSON import is collapsed under Advanced. Saved in this browser remains explicit.
- **Consistency details:** account/sign-out controls are available through a mobile account menu. Up next rows have explicit keyboard-accessible Play actions and return focus to the listening area. The existing rounded controls and flat seekbar remain.

## Validation

- Live desktop checks at 1280×720 and 1280×800; mobile at 390×844 and 390×667. No horizontal overflow in the reviewed routes.
- Desktop decisions fit inside the first viewport (bottom about 659px at 720px height). Mobile decisions fit at about 782px on an 844px viewport; recovery and decisions remain visible on the 667px viewport (bottom about 605px).
- Verified compact search geometry, mobile source dismissal, destination filtering and ArrowDown focus, ready ZIP placement above the rows, and collapsed advanced analysis.
- Unit regressions cover unloaded-list pause, playback error classification, retry time, bounded inactive-device recovery, no retries on rate limits, and applied-source identity. Existing save/duplicate/count tests remain in the suite.
- Manual Impeccable scan ran once. Its only finding is the pre-existing overridden 4px border declaration at `app/globals.css:112`; the live card uses a neutral 1px border. This remains a documented false positive, not a reason to alter the approved card identity.

## Completed sequential verification

1. **Listening layout:** decisions fit on desktop and on both 390×844 and 390×667 phones, including recovery states. At 390×667 their bottom was about 605px; the source sheet Apply action was at 631px. No horizontal overflow.
2. **Playback:** inactive tabs disconnect their SDK device. Supported browsers coordinate one connected player using Web Locks; an explicit Play request transfers ownership between tabs through BroadcastChannel. Ownership waiting is not overwritten by a misleading Paused state. A pending SDK connection cannot prevent releasing ownership. Startup allows one 750ms registration delay before the bounded inactive-device transfer. The player uses SDK recording state to confirm playback, not only the Web API response. Live Spotify playback was confirmed, its time advanced, seeking worked, and Pause held the position. The earlier NO_ACTIVE_DEVICE failure was resolved in this live check.
3. **Downloads:** ready ZIP and progress appear before the song list; a ready result bottom was 382px while the list began around 577px on mobile. Starting a new conversion remains a distinct action. No new conversion job was created during verification.
4. **Sources:** draft status, client-side filtering and keyboard dismissal pass. Recommendation method now persists with the draft across reloads, including a method differing from the active queue. Concurrent playlist reads wait for the shared provider slot and identical library reads share one in-flight request; the final live library check loaded 50 playlists without the startup contention error. Escape restores focus to Change sources. Search remains an adjacent 44px icon button.
5. **Settings and consistency:** advanced import starts collapsed and opens correctly; Saved in this browser remains visible; mobile account access works. Global discovery shortcuts ignore account and dialog controls. Up next has explicit playable rows.

108 tests and typecheck pass. The final Impeccable scan reports zero findings after removing the obsolete overridden accent-border declaration. Production build validation completed; the dev server was restored on port 8000 after clearing generated caches when the disk filled. Production configuration was restored unchanged. No user playlist writes or app-data cleanup were performed.
