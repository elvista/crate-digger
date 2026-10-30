import type { Track } from './catalog';
export type Playlist = { id: string; name: string; count: number | null; image: string | null; url: string; snapshotId: string };
export type SourceSelection = { playlistIds: string[]; trackIds: string[]; mode: 'playlist' | 'related'; relatedMethod: 'cosine' | 'auto' | 'artists'; genre: string; reviewedIds: string[] };
export type DiscoveryResult = { items: Track[]; method: 'playlist' | 'cosine' | 'spotify' | 'artists'; warnings: string[]; sources: string[]; seedCount: number; snapshots?:Record<string,string> };
export type DiggingSession = DiscoveryResult & { id: string; ownerId: string; createdAt: number; expiresAt: number };
export type SessionPage = Omit<DiggingSession, 'ownerId'> & { nextCursor: string | null; total: number };
