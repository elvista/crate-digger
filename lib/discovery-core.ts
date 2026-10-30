import { normalizeTrack } from './spotify-data.ts';
import type { Track } from './catalog.ts';
import type { Playlist, SourceSelection, DiscoveryResult } from './discovery-types.ts';
export const spotifyId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{22}$/.test(value);
export function object(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const text = (value: unknown) => typeof value === 'string' ? value : '';
export class DiscoveryError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export function parseSpotifyLink(value: string): { type: 'playlist' | 'track'; id: string } {
  let type: string | undefined, id: string | undefined;
  const uri = /^spotify:(playlist|track):([A-Za-z0-9]{22})$/.exec(value.trim());
  if (uri) [, type, id] = uri;
  else { try { const url = new URL(value.trim()); if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password) throw new Error(); const match = /^\/(?:intl-[a-z]{2}\/)?(playlist|track)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname); if (!match) throw new Error(); [, type, id] = match; } catch { throw new DiscoveryError('Paste a Spotify playlist or track link.'); } }
  return { type: type as 'playlist' | 'track', id: id! };
}
export function parseSelection(value: unknown): SourceSelection {
  const data = object(value);
  const ids = (value: unknown, max: number) => { if (!Array.isArray(value) || value.length > max || !value.every(spotifyId)) throw new DiscoveryError(`Select no more than ${max} valid sources.`); return [...new Set(value)] as string[]; };
  const playlistIds = ids(data.playlistIds, 10), trackIds = ids(data.trackIds, 25);
  if (!playlistIds.length && !trackIds.length) throw new DiscoveryError('Choose a playlist or a seed track first.');
  if (data.mode !== 'playlist' && data.mode !== 'related') throw new DiscoveryError('Choose a discovery mode.');
  if (!['', 'Deep house', 'Melodic techno', 'Tech house'].includes(String(data.genre ?? ''))) throw new DiscoveryError('Choose a supported genre filter.');
  if (data.relatedMethod !== 'cosine' && data.relatedMethod !== 'auto' && data.relatedMethod !== 'artists') throw new DiscoveryError('Choose a recommendation method.');
  if (!Array.isArray(data.reviewedIds) || data.reviewedIds.length > 5000 || !data.reviewedIds.every(id => typeof id === 'string' && /^spotify:[A-Za-z0-9]{22}$/.test(id))) throw new DiscoveryError('Invalid reviewed-track list.');
  return { playlistIds, trackIds, mode: data.mode, genre: String(data.genre || ''), relatedMethod: data.relatedMethod, reviewedIds: data.reviewedIds };
}
export function normalizePlaylist(value: unknown): Playlist | null {
  const p = object(value); if (!spotifyId(p.id)) return null;
  const images = Array.isArray(p.images) ? p.images : [];
  let image: string | null = null;
  for (const item of images) { try { const u = new URL(text(object(item).url)); if (u.protocol === 'https:' && ['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'mosaic.scdn.co'].includes(u.hostname)) { image = u.href; break; } } catch {} }
  const count = object(p.items || p.tracks).total;
  return { id: p.id, name: text(p.name) || 'Untitled playlist', count: typeof count === 'number' ? count : null, image, url: `https://open.spotify.com/playlist/${p.id}`, snapshotId: text(p.snapshot_id) };
}
export function uniqueTracks(tracks: Track[], excluded = new Set<string>()) {
  const ids = new Set<string>(), recordings = new Set<string>();
  return tracks.filter(track => { if (excluded.has(track.id) || ids.has(track.id) || track.isrc && recordings.has(track.isrc)) return false; ids.add(track.id); if (track.isrc) recordings.add(track.isrc); return true; });
}
export function balancedSeeds(groups: Track[][], limit = 25): Track[] {
  // Spread selections across playlist positions rather than taking only their first songs.
  const spread = groups.map(group => { const unique = uniqueTracks(group); const count = Math.min(unique.length, limit); return Array.from({ length: count }, (_, i) => unique[Math.floor(i * unique.length / count)]); });
  const result: Track[] = [], used = new Set<string>(), artists = new Map<string, number>();
  for (let i = 0; i < limit; i++) for (const group of spread) { const track = group[i]; if (!track || used.has(track.id)) continue; const artist = track.artistIds?.[0] || track.artist; if ((artists.get(artist) || 0) >= 3) continue; used.add(track.id); artists.set(artist, (artists.get(artist) || 0) + 1); result.push(track); if (result.length === limit) return result; }
  return result;
}
export function diversify(tracks: Track[], excluded: Set<string>, limit = 50): Track[] {
  const groups = new Map<string, Track[]>();
  for (const track of uniqueTracks(tracks, excluded)) { const key = track.artistIds?.[0] || track.artist; groups.set(key, [...(groups.get(key) || []), track]); }
  const result: Track[] = [];
  for (let i = 0; i < 3; i++) for (const group of groups.values()) { if (group[i]) result.push(group[i]); if (result.length >= limit) return result; }
  return result;
}
export type SpotifyRead = (path: string) => Promise<unknown>;
export async function generateDiscovery(selection: SourceSelection, api: SpotifyRead, signal?: AbortSignal, progress: (stage: string) => void = () => {}, audioSimilar?: (seeds:Track[])=>Promise<{items:Track[];warnings:string[]}>): Promise<DiscoveryResult> {
  const check = () => { if (signal?.aborted) throw new DiscoveryError('Generation cancelled.', 499); };
  const read = async (path: string) => { check(); const result = await api(path); check(); return result; };
  const groups: Track[][] = [], sources: string[] = [], warnings: string[] = [];
  const snapshots:Record<string,string>={};
  progress('Reading selected sources');
  for (const id of selection.playlistIds) {
    const playlist = normalizePlaylist(await read(`playlists/${id}`));
    if (!playlist) throw new DiscoveryError('Spotify returned an unreadable playlist.', 502);
    const group: Track[] = []; let offset = 0; let more = true;
    while (more && offset < 500) {
      const page = object(await read(`playlists/${id}/items?limit=50&offset=${offset}&additional_types=track`));
      if (!Array.isArray(page.items)) throw new DiscoveryError(`Could not read ${playlist.name}. Reconnect Spotify and check playlist access.`, 403);
      for (const entry of page.items) { const item = object(entry); const raw = object(item.item ?? item.track); if (item.is_local || raw.is_local || raw.type && raw.type !== 'track') continue; const track = normalizeTrack(raw, selection.genre || 'Playlist selection'); if (track) group.push({ ...track, reason: `From ${playlist.name}` }); }
      offset += 50; more = typeof page.next === 'string' && page.items.length > 0;
    }
    if(playlist.snapshotId){const latest=normalizePlaylist(await read(`playlists/${id}`));if(!latest||latest.snapshotId!==playlist.snapshotId)throw new DiscoveryError(`${playlist.name} changed while loading. Try generating again.`,409);snapshots[id]=playlist.snapshotId;}
    if (more) warnings.push(`${playlist.name}: using the first 500 items. Narrow the playlist to include later tracks.`);
    if (!group.length) warnings.push(`${playlist.name} has no playable music tracks.`);
    groups.push(group); sources.push(playlist.name);
  }
  const explicit: Track[] = [];
  for (const id of selection.trackIds) { const track = normalizeTrack(await read(`tracks/${id}`), selection.genre || 'Seed selection'); if (track) { explicit.push({ ...track, reason: 'Selected seed track' }); sources.push(`${track.title} — ${track.artist}`); } else warnings.push(`A selected seed track is unavailable (${id}).`); }
  const original = uniqueTracks([...explicit, ...groups.flat()]);
  const reviewed = new Set(selection.reviewedIds);
  if (selection.mode === 'playlist') return { items: uniqueTracks([...explicit, ...groups.flat()], reviewed), method: 'playlist', warnings, sources, snapshots, seedCount: original.length };
  const seeds = balancedSeeds([...explicit.map(t => [t]), ...groups], 25);
  if (!seeds.length) return { items: [], method: 'artists', warnings: [...warnings, 'No usable seeds were found. Choose another source.'], sources, seedCount: 0 };
  // Also exclude alternate Spotify IDs of seed recordings when an ISRC is available.
  const excluded = new Set([...selection.reviewedIds, ...original.map(t => t.id)]);
  const seedRecordings = new Set(original.flatMap(t => t.isrc ? [t.isrc] : []));
  if(selection.relatedMethod==='cosine') {
    if(!audioSimilar)throw new DiscoveryError('cosine.club audio similarity is not configured.',503);
    const result=await audioSimilar(original);check();
    const items=diversify(result.items.filter(t=>!t.isrc||!seedRecordings.has(t.isrc)),excluded);
    const removed=result.items.length-items.length;
    return {items,method:'cosine',warnings:[...warnings,...result.warnings,...(removed?[`${removed} matches were excluded as source songs, previously reviewed tracks, duplicate recordings, or repeated artists. ${items.length} tracks remain in this queue.`]:[])],sources,snapshots,seedCount:original.length};
  }
  let method: DiscoveryResult['method'] = 'artists'; const candidates: Track[] = [];
  progress('Finding related tracks');
  if (selection.relatedMethod === 'auto') {
    try {
      for (let i = 0; i < seeds.length; i += 5) {
        const batch = seeds.slice(i, i + 5); const params = new URLSearchParams({ seed_tracks: batch.map(t => t.id.slice(8)).join(','), limit: '50' });
        const result = object(await read(`recommendations?${params}`)); if (!Array.isArray(result.tracks)) throw new DiscoveryError('Spotify returned an unreadable recommendation response.', 502);
        for (const raw of result.tracks) { const track = normalizeTrack(raw, selection.genre || 'Related tracks'); if (track) candidates.push({ ...track, reason: `Spotify recommendation from ${batch.map(t => t.title).join(', ')}` }); }
      }
      method = 'spotify';
    } catch (error) {
      const status = object(error).status;
      if (status !== 403 && status !== 404) throw error;
      candidates.length = 0;
      warnings.push('Spotify recommendations are unavailable for this app. Using artist-based discovery: other releases by your seed artists, not audio-similarity recommendations.');
    }
  }
  if (method === 'artists') {
    const artists = new Map<string, Track>();
    for (const seed of seeds) for (const artist of seed.artistIds || []) if (artists.size < 12 && !artists.has(artist)) artists.set(artist, seed);
    if (!artists.size) warnings.push('No artist identifiers were available in the selected sources.');
    for (const [artistId, seed] of artists) {
      const albums = object(await read(`artists/${artistId}/albums?include_groups=album,single&limit=10`));
      if (!Array.isArray(albums.items)) throw new DiscoveryError('Spotify returned an unreadable artist catalog.', 502);
      for (const album of albums.items.slice(0, 3)) {
        const a = object(album); if (!spotifyId(a.id)) continue;
        const page = object(await read(`albums/${a.id}/tracks?limit=50`)); if (!Array.isArray(page.items)) continue;
        for (const raw of page.items) { const track = normalizeTrack({ ...object(raw), album: a }, selection.genre || 'Artist discovery'); if (track) candidates.push({ ...track, reason: `Other release by an artist from ${seed.title}` }); }
      }
    }
  }
  if (selection.genre) warnings.push(`The ${selection.genre} filter guided seed context; Spotify does not return a reliable per-track genre for filtering recommendations. No genre match is claimed.`);
  progress('Removing duplicates and reviewed tracks');
  return { items: diversify(candidates.filter(t => !t.isrc || !seedRecordings.has(t.isrc)), excluded), method, warnings, sources, snapshots, seedCount: original.length };
}
