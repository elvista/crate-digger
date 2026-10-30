export type DJMetadata = { bpm: number | null; musicalKey: string | null; source: string; waveform: { peaks: number[]; durationMs: number; source: string } | null };
export function validateMetadataImport(value: unknown): Record<string, DJMetadata> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Import a JSON object keyed by Spotify track IDs.');
  const entries = Object.entries(value); if (!entries.length || entries.length > 100) throw new Error('Import between 1 and 100 tracks at a time.');
  const result: Record<string, DJMetadata> = {};
  for (const [id, raw] of entries) {
    if (!/^spotify:[A-Za-z0-9]{22}$/.test(id) || !raw || typeof raw !== 'object') throw new Error('Every entry needs a valid spotify: track ID.');
    const data = raw as Record<string, unknown>;
    if (typeof data.source !== 'string' || !data.source.trim() || data.source.length > 200) throw new Error('Every track needs a source identifying your metadata provider or audio file.');
    const bpm = data.bpm ?? null, key = data.musicalKey ?? null;
    if (bpm !== null && (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 20 || bpm > 400)) throw new Error('BPM must be a number from 20 to 400, or null.');
    if (key !== null && (typeof key !== 'string' || !key.trim() || key.length > 24)) throw new Error('Musical key must be a short key name, or null.');
    let waveform: DJMetadata['waveform'] = null;
    if (data.waveform != null) {
      const w = data.waveform as Record<string, unknown>;
      if (!Array.isArray(w.peaks) || w.peaks.length < 2 || w.peaks.length > 2048 || !w.peaks.every(p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1) || typeof w.durationMs !== 'number' || !Number.isFinite(w.durationMs) || w.durationMs < 1 || w.durationMs > 86400000) throw new Error('Waveforms need 2–2048 amplitude peaks from 0 to 1 and the exact recording duration in milliseconds.');
      waveform = { peaks: w.peaks, durationMs: w.durationMs, source: data.source.trim() };
    }
    result[id] = { bpm: bpm as number | null, musicalKey: key as string | null, source: data.source.trim(), waveform };
  }
  return result;
}
export function matchedMetadata(metadata: DJMetadata | undefined, durationMs: number): DJMetadata | null {
  if (!metadata) return null;
  return { ...metadata, waveform: metadata.waveform?.durationMs === durationMs ? metadata.waveform : null };
}
export function featuresToMetadata(value: unknown): DJMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const bpm = typeof data.tempo === 'number' && Number.isFinite(data.tempo) && data.tempo >= 20 && data.tempo <= 400 ? Math.round(data.tempo * 10) / 10 : null;
  const notes = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const musicalKey = typeof data.key === 'number' && Number.isInteger(data.key) && data.key >= 0 && data.key < 12 && (data.mode === 0 || data.mode === 1) ? `${notes[data.key]} ${data.mode === 1 ? 'major' : 'minor'}` : null;
  return bpm !== null || musicalKey !== null ? { bpm, musicalKey, source: 'Spotify audio features', waveform: null } : null;
}
