# Crate Digger

### Find the tracks that make your next set.

[Open Crate Digger](https://crate-tinder.vercel.app)

Turn the playlists you already love into a new digging session. Listen, swipe, and send your discoveries straight to Spotify—without losing the flow.

Crate Digger is a focused listening room for DJs and curious music heads. Bring your taste. Follow the sound. Build your next set one track at a time.

---

## Your taste is the starting point

That playlist you keep coming back to? Start there.

Choose one Spotify or Rekordbox playlist, one seed track, or paste a Spotify link. Crate Digger uses **cosine.club audio similarity** to find related tracks and matches them back to Spotify. It filters out your seed, duplicates, and tracks you have already reviewed.

You can also dig through the original tracks in your selected playlists.

## Stay in the listening zone

- **One track. One decision.** A swipeable card keeps your attention on the music. Left to pass. Right to save.
- **Drop into the good part.** Playback starts halfway through each song by default. Change the starting position in Settings, scrub the timeline, or jump ten seconds in either direction.
- **Save straight to Spotify.** A right swipe or Save adds the song to **Crate Finds**. The app creates the playlist privately if it does not exist, and reuses it when it does.
- **Put a track in the right place.** Swipe up to choose another Spotify playlist. Recently used destinations appear first.
- **Explore the versions.** Dig through originals, edits, and remixes. Alternate Spotify versions are labeled separately from the recording analyzed by cosine.club.
- **See what is coming.** A compact, collapsible Up next list shows the generated queue beneath the deck.
- **Keep your hands on the keyboard.** Navigate, audition, and save with shortcuts. The playlist picker supports arrow-key navigation and Enter to add and continue.

The interface pairs a Spotify-style library sidebar with a Tinder-style discovery deck, wrapped in a dark, bold listening-room aesthetic.

## From a favorite playlist to a fresh find

1. **Connect Spotify.** Your playlists load automatically.
2. **Choose your source.** Select one playlist or track, then generate a digging queue.
3. **Listen and decide.** Pass, save to Crate Finds, or send a song to another playlist.
4. **Keep digging.** Successful saves advance to the next song. Playlist counts update as you go.

Songs already in a destination playlist are skipped, so retrying a save does not add another copy.

## A workflow that moves at your pace

| Shortcut | Action |
| --- | --- |
| **←** | Pass on the current track |
| **→** | Save to Crate Finds |
| **↑** | Open the playlist picker |
| **↑ / ↓** in the picker | Choose a playlist |
| **Enter** in the picker | Add the song and move to the next track |
| **Esc** | Close the picker |
| **Space** | Play or pause |
| **J / L** | Jump backward or forward ten seconds |
| **Z** | Undo the last local decision |
| **?** | Show the keyboard-shortcuts reference |

Undo brings a track back for review; it does not remove a song already saved to Spotify.

## Built with the music in mind

Crate Digger uses live Spotify catalog data and Spotify playback. Audio-similarity discovery comes from [cosine.club](https://cosine.club). Exact Spotify matches are distinguished from related originals, edits, and remixes found in Spotify. Related versions do not inherit the audio-similarity score of a different recording.

In-browser playback requires **Spotify Premium**. Similarity coverage depends on the seed tracks available in cosine.club. BPM, key, and waveform information appear when verified data is available; the app does not invent missing analysis.

The local Downloads workspace lets you select a Spotify playlist, review suggested YouTube versions, save verified MP3s to your chosen folder, and add them to a matching Rekordbox playlist. Already downloaded recordings are reused. This feature uses local tools and is separate from the hosted listening experience.

## Run the local app with Rekordbox

Rekordbox integration runs through the **local Next.js server on your Mac**. The browser talks to its local API; that API starts a pinned Python connector to inspect or update the Rekordbox library. The hosted Vercel app cannot access files or Rekordbox on your laptop.

Install Node.js 22, Python 3.12, [uv](https://docs.astral.sh/uv/), [yt-dlp](https://github.com/yt-dlp/yt-dlp), and [FFmpeg](https://ffmpeg.org/) (`ffmpeg` and `ffprobe`). On a Mac with Homebrew, the command-line tools can be installed with `brew install uv yt-dlp ffmpeg`.

```bash
git clone https://github.com/elvista/crate-digger.git
cd crate-digger
npm ci
cp .env.example .env.local
uv venv --python 3.12 .data/rekordbox/venv
uv pip sync --python .data/rekordbox/venv/bin/python scripts/rekordbox/requirements.lock
```

In `.env.local`, set `SPOTIFY_CLIENT_ID`, `SESSION_SECRET` (generate one with `openssl rand -hex 32`), and `COSINE_API_KEY`. For the port below, set `SPOTIFY_REDIRECT_URI=http://127.0.0.1:8000/api/auth/spotify/callback` and register that **exact** URI in your Spotify developer app. Adjust the `YTDLP_PATH`, `FFMPEG_PATH`, and optional `FFPROBE_PATH` if your tools are installed elsewhere. Keep `.env.local` private.

```bash
npm run rekordbox:check
npm run dev -- --port 8000
```

Open [127.0.0.1:8000](http://127.0.0.1:8000) and sign in to Spotify. Use `127.0.0.1` consistently; switching to `localhost` creates a different browser cookie scope.

1. In **Settings → Downloads & Rekordbox**, select an existing writable MP3 folder (default `~/Music/Crate Digger`), check the library connection, and confirm the detected `master.db` or set an explicit library path. Leave **Automatic import** on if you want downloads added to Rekordbox without a second action.
2. In **Discover**, choose **Rekordbox** under Sources to browse local playlists and play local tracks. In **Play from selected playlist only**, saves update Rekordbox playlist membership without changing or downloading the original audio. In **Recommend new songs**, recommendations play through Spotify and saves go to Spotify playlists, even when the seed came from Rekordbox.
3. In **Downloads**, select a Spotify playlist, choose the tracks to acquire, find and review YouTube matches, then start the MP3 job. The app reuses verified MP3s already in the target folder and adds both reused and new tracks to the chosen Rekordbox playlist.
4. For an import, close **Rekordbox and its background agent**. The job waits while either process is active; it will continue when they stop and the local server is running. Wait for **Added to Rekordbox** before opening Rekordbox to play the tracks. Use **Open Rekordbox** from the completed job if desired.

Keep the local server running while jobs are active. Its recovery supervisor resumes unfinished work after a restart. Library backups, job journals, receipts, cached account data, and the Python environment live under ignored `.data/`; downloaded MP3s live in the folder you chose in Settings. Neither `.data/` nor `.env.local` belongs in Git or the Vercel deployment. The connector supports the guarded local workflow documented in [Rekordbox connector notes](scripts/rekordbox/README.md); its file publication path is verified on APFS.

For hosting on Vercel, connect a **private Vercel Blob store** for discovery sessions, metadata, and safe Spotify-save receipts. Set production Spotify and cosine.club environment variables, and register the deployed callback URL in Spotify. The Downloads worker remains local.

See the [technical reference](docs/technical-reference.md) for provider details and storage, and the [Rekordbox integration plan](docs/rekordbox-integration-plan.md) for import safeguards and recovery behavior.

---

**Your next great find starts with a track you already love.**
