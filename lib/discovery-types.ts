import type {SourceIdentity} from './source-identity';
import type { Track } from './catalog';
export type Playlist = { id: string; name: string; count: number | null; image: string | null; url: string; snapshotId: string };
export type SourceSelection = { playlistIds: string[]; trackIds: string[]; mode: 'playlist' | 'related'; relatedMethod: 'cosine' | 'auto' | 'artists'; genre: string; reviewedIds: string[] };
export type MatchingProgress={status:'running'|'paused'|'complete';target:number;resolved:number;retryAt?:number};
export type DiscoveryResult = { items: Track[]; method: 'playlist' | 'cosine' | 'spotify' | 'artists'; warnings: string[]; sources: string[]; seedCount: number; sourceSelection?:SourceIdentity; generation?:MatchingProgress; snapshots?:Record<string,string> };
export type DiggingSession = DiscoveryResult & { id: string; ownerId: string; createdAt: number; expiresAt: number };
export type SessionPage = Omit<DiggingSession, 'ownerId'> & { nextCursor: string | null; total: number };
