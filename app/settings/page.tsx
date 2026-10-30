'use client';
import AppHeader from '@/components/AppHeader';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, AudioLines, Check, RotateCcw } from 'lucide-react';
import { DEFAULT_START_PERCENT, normalizeStartPercent, readStartPercent, SETTINGS_KEY } from '@/lib/playback-settings';
export default function Settings() {
  const [percent, setPercent] = useState(DEFAULT_START_PERCENT);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [importStatus,setImportStatus]=useState('');
  const [importing,setImporting]=useState(false);
  useEffect(() => { try { setPercent(readStartPercent(localStorage.getItem(SETTINGS_KEY))); } catch { setError('Browser storage is unavailable. Changes cannot be saved.'); } setReady(true); }, []);
  function update(value: number) {
    const next = normalizeStartPercent(value); setPercent(next);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ startPercent: next })); setError(''); }
    catch { setError('Could not save your settings. Check browser storage and try again.'); }
  }
  async function importMetadata(file:File|undefined){if(!file)return;if(file.size>2000000){setImportStatus('Choose a JSON file smaller than 2 MB.');return}setImporting(true);setImportStatus('Importing metadata…');try{const response=await fetch('/api/dj-metadata',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});const data=await response.json();if(!response.ok)throw new Error(data.error);setImportStatus(`Imported metadata for ${data.imported} tracks.`)}catch(e){setImportStatus(e instanceof Error?e.message:'Import failed.')}finally{setImporting(false)}}
  return <div className="crate-app theme-basement"><AppHeader active="settings"/><main className="settings-page"><div className="intro"><div><div className="eyebrow"><span/>Make the listening room yours.</div><h1>Playback settings</h1><p>Get straight to the part you want to hear.</p></div></div><section className="settings-panel"><div className="settings-heading"><div><h2>Start songs at</h2><p>Each new track starts automatically at this point in the song.</p></div><output htmlFor="start-percent">{percent}%</output></div><label htmlFor="start-percent">Song start position</label><input id="start-percent" type="range" min="0" max="95" step="1" value={percent} disabled={!ready} onChange={e=>update(Number(e.target.value))}/><div className="range-labels"><span>Beginning · 0%</span><span>Near the end · 95%</span></div><div className="settings-example"><AudioLines size={22}/><p>For a 4-minute track, playback starts at <strong>{Math.floor(240*percent/100/60)}:{String(Math.floor(240*percent/100)%60).padStart(2,'0')}</strong>.</p></div><div className="settings-bottom"><button onClick={()=>update(DEFAULT_START_PERCENT)} disabled={!ready||percent===DEFAULT_START_PERCENT}><RotateCcw size={15}/>Reset to 50%</button><span role="status">{error?<span className="settings-error">{error}</span>:ready?<><Check size={14}/>Saved in this browser</>:'Loading settings…'}</span></div></section><section className="settings-panel metadata-import"><h2>DJ metadata</h2><p>Import BPM, musical keys, and waveform peaks from a source you have permission to use. Spotify track IDs must match the exact recording or mix.</p><label htmlFor="metadata-file">Import verified metadata (JSON, up to 2 MB)</label><input id="metadata-file" type="file" accept=".json,application/json" disabled={importing} onChange={e=>{void importMetadata(e.target.files?.[0]);e.target.value=''}}/><p role="status">{importStatus}</p><details><summary>JSON format</summary><p>Use spotify: followed by the track’s 22-character ID as each key. BPM, key and waveform may be null. A waveform needs its exact duration in milliseconds and 2–2048 amplitude peaks between 0 and 1. Include a source for every entry.</p><pre>{`{
  "spotify:YOUR_22_CHARACTER_TRACK_ID": {
    "bpm": null,
    "musicalKey": null,
    "source": "Your licensed provider or original audio file",
    "waveform": null
  }
}`}</pre><p>A waveform value has this shape: <code>{'{ "durationMs": integer, "peaks": [amplitude, ...] }'}</code>. The duration must match Spotify exactly; mismatched waveforms are hidden.</p></details></section><section className="settings-info"><h2>Ready when the track is.</h2><p>Every new card starts a new song at your chosen position. Changes apply when you return to discovery.</p><p>Spotify Premium and playback permission are required. If your browser blocks sound, tap Enable sound once in the player.</p></section></main></div>;
}
