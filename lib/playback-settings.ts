export const SETTINGS_KEY = 'crate-playback-settings-v1';
export const DEFAULT_START_PERCENT = 50;
export function normalizeStartPercent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(95, Math.max(0, value))) : DEFAULT_START_PERCENT;
}
export function readStartPercent(raw: string | null): number {
  try { return normalizeStartPercent(raw ? JSON.parse(raw).startPercent : undefined); } catch { return DEFAULT_START_PERCENT; }
}
export function startPosition(durationMs: number, percent: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(durationMs) - 1), Math.floor(durationMs * normalizeStartPercent(percent) / 100));
}
// Coalesce pending cards and serialize commands: an older play can never finish after a newer play.
export class PlaybackQueue {
  private pending: (() => Promise<void>) | null = null;
  private running = false;
  enqueue(task: () => Promise<void>) { this.pending = task; void this.drain(); }
  clear() { this.pending = null; }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try { while (this.pending) { const task = this.pending; this.pending = null; try { await task(); } catch { /* Tasks report their own errors. */ } } }
    finally { this.running = false; }
  }
}
export const PLAYBACK_SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-modify-playback-state'];
export function hasPlaybackScope(scope: string | undefined) { const granted = new Set(scope?.split(' ') || []); return PLAYBACK_SCOPES.every(s => granted.has(s)); }

export const PLAYLIST_SCOPES = ['playlist-read-private', 'playlist-read-collaborative'];
export function hasPlaylistScope(scope:string|undefined){return PLAYLIST_SCOPES.every(s=>(scope?.split(' ')||[]).includes(s));}

export function clampSeek(position:number,duration:number):number{if(!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0)return 0;return Math.max(0,Math.min(Math.floor(duration)-1,Math.round(position)));}

export const PLAYLIST_WRITE_SCOPES=['playlist-modify-private','playlist-modify-public'];
export function hasPlaylistWriteScope(scope:string|undefined){return PLAYLIST_WRITE_SCOPES.every(s=>(scope?.split(' ')||[]).includes(s));}
