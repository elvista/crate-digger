# Crate Digger

### Find the tracks that make your next set.

[Open Crate Digger](https://crate-tinder.vercel.app)

Turn the playlists you already love into a new digging session. Listen, swipe, and send your discoveries straight to Spotify—without losing the flow.

Crate Digger is a focused listening room for DJs and curious music heads. Bring your taste. Follow the sound. Build your next set one track at a time.

---

## Your taste is the starting point

That playlist you keep coming back to? Start there.

Choose multiple Spotify playlists, add individual seed tracks, or paste a Spotify link. Crate Digger uses **cosine.club audio similarity** to find related tracks, combines the results, and matches them back to Spotify. It filters out your seeds, duplicates, and tracks you have already reviewed.

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
2. **Choose your sources.** Mix playlists and individual songs, then generate a digging queue.
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

The local Downloads workspace lets you select a Spotify playlist, review suggested YouTube versions, and run MP3 conversion on your own computer. This feature uses local tools and is separate from the hosted listening experience.

## Run your own listening room

```bash
git clone https://github.com/elvista/crate-digger.git
cd crate-digger
npm install
cp .env.example .env.local
```

Add your Spotify client ID, Spotify callback URL, a session secret of at least 32 characters, and a cosine.club API key to `.env.local`. Register the same callback URL in your Spotify developer app.

```bash
npm run dev -- --port 8000
```

Open [127.0.0.1:8000](http://127.0.0.1:8000). For that local address, use `http://127.0.0.1:8000/api/auth/spotify/callback` as the Spotify redirect URI.

For hosting on Vercel, connect a **private Vercel Blob store** for discovery sessions, metadata, and safe Spotify-save receipts. Set production Spotify and cosine.club environment variables, and register the deployed callback URL in Spotify. The Downloads worker remains local.

See the [technical reference](docs/technical-reference.md) for configuration, provider details, storage, and local download-worker requirements.

---

**Your next great find starts with a track you already love.**
