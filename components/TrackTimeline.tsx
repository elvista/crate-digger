'use client';
import { useEffect, useState } from 'react';
import { RotateCcw, RotateCw, Play, Pause } from 'lucide-react';
import type { Track } from '@/lib/catalog';
import type { DJMetadata } from '@/lib/dj-metadata';
export function formatTime(ms: number) { return `${Math.floor(Math.max(0, ms) / 60000)}:${String(Math.floor(Math.max(0, ms) / 1000) % 60).padStart(2, '0')}`; }
export default function TrackTimeline({ track, position, status, seek, enabled, toggle, error, startPercent, layout='card' }: { track: Track; position: number; status: string; seek: (value: number) => void; enabled: boolean; toggle: () => void; error: string; startPercent: number; layout?: 'card'|'inline' }) {
  const [draft, setDraft] = useState<number | null>(null), [metadata, setMetadata] = useState<DJMetadata | null>(null), [loading, setLoading] = useState(true);
  useEffect(() => { if(layout==='inline'){setLoading(false);return;} const abort = new AbortController(); setMetadata(null); setLoading(true); setDraft(null); fetch(`/api/dj-metadata?${new URLSearchParams({ trackId: track.id, durationMs: String(track.durationMs) })}`, { signal: abort.signal, cache: 'no-store' }).then(async r => { if (r.ok) { const data = await r.json(); if (!abort.signal.aborted) setMetadata(data.metadata); } }).catch(() => {}).finally(() => { if (!abort.signal.aborted) setLoading(false); }); return () => abort.abort(); }, [track.id, track.durationMs,layout]);
  const needsActivation = status === 'needs-interaction' || /tap enable sound/i.test(error);
  const playLabel = needsActivation ? 'Enable sound' : status === 'error' ? 'Retry playback' : status === 'playing' ? 'Pause song' : 'Play song';
  const statusLabel = !enabled ? 'Connect playback' : needsActivation ? 'Enable sound' : status === 'connecting' ? 'Connecting…' : status === 'starting' ? 'Starting…' : status === 'playing' ? 'Playing' : status === 'error' ? 'Retry playback' : 'Paused';
  const canSeek = enabled && ['playing', 'paused'].includes(status) && track.durationMs > 0;
  const value = Math.min(Math.max(0, track.durationMs - 1), draft ?? position);
  const peaks = metadata?.waveform?.peaks;
  const bars = peaks ? Array.from({ length: Math.min(peaks.length, 150) }, (_, i) => { const n = Math.min(peaks.length, 150); return Math.max(...peaks.slice(Math.floor(i * peaks.length / n), Math.max(Math.floor((i + 1) * peaks.length / n), Math.floor(i * peaks.length / n) + 1))); }) : [];
  function jump(seconds: number) { if (!canSeek) return; setDraft(null); seek(Math.min(Math.max(0, track.durationMs - 1), Math.max(0, position + seconds * 1000))); }
  function commit() { if (draft !== null && canSeek) seek(draft); setDraft(null); }
  return <section className="track-timeline compact-player" aria-label="Music player" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    {layout==='card'&&<div className="player-transport"><button className="seek-jump" onClick={()=>jump(-10)} disabled={!canSeek} aria-label="Back 10 seconds" title="Back 10 seconds"><RotateCcw size={26}/><span>10</span></button><button className="transport-play" disabled={!enabled} onClick={toggle} aria-label={playLabel} title={playLabel}>{status === 'playing' ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button><button className="seek-jump" onClick={()=>jump(10)} disabled={!canSeek} aria-label="Forward 10 seconds" title="Forward 10 seconds"><RotateCw size={26}/><span>10</span></button><span className="transport-status">{statusLabel}</span><span className="transport-start">Start {startPercent}%</span></div>}
    {layout==='inline'&&<span className="inline-status">{statusLabel}</span>}
    <div className={`seek-waveform ${bars.length ? 'has-waveform' : ''}`}>
      {bars.length > 0 && <svg viewBox={`0 0 ${bars.length * 3} 52`} preserveAspectRatio="none" aria-label="Recording waveform" role="img">{bars.map((peak, i) => <rect key={i} x={i * 3} y={26 - peak * 25} width="1.8" height={Math.max(.5, peak * 50)} fill={i / bars.length <= value / track.durationMs ? 'var(--blue)' : 'var(--wave-muted, #a5b7d6)'}/>)}</svg>}
      <input aria-label="Seek within song" aria-valuetext={`${formatTime(value)} of ${formatTime(track.durationMs)}`} style={{background:`linear-gradient(to right, var(--blue) ${track.durationMs > 0 ? value / track.durationMs * 100 : 0}%, var(--line) 0)`}} type="range" min="0" max={Math.max(0, track.durationMs - 1)} step="1000" value={value} disabled={!canSeek} onChange={e => setDraft(Number(e.target.value))} onPointerUp={commit} onPointerCancel={() => setDraft(null)} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commit(); }} onBlur={commit}/>
    </div>
    <div className="timeline-times"><span>{formatTime(value)}</span><span>{formatTime(track.durationMs)}</span></div>
    {layout==='card'&&<div className="compact-metadata"><span title={metadata?.source}>BPM <strong>{metadata?.bpm ?? '—'}</strong></span><span title={metadata?.source}>Key <strong>{metadata?.musicalKey || '—'}</strong></span><span className="waveform-caption">{bars.length ? 'Verified waveform' : loading ? 'Loading metadata…' : 'Waveform unavailable'}</span></div>}
    {!enabled && <a className="connect-playback" href="/api/auth/spotify/login">Enable Spotify playback</a>}{error && <p className="player-error" role="alert">{error}</p>}
  </section>;
}
