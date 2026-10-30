'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '@/lib/catalog';
import { PlaybackQueue, startPosition, clampSeek } from '@/lib/playback-settings';
type SDKEvent = { device_id?: string; message?: string; paused?: boolean; position?: number; track_window?: { current_track?: { uri?: string } } };
type Player = { connect(): Promise<boolean>; disconnect(): void; pause(): Promise<void>; resume(): Promise<void>; seek(positionMs:number):Promise<void>; activateElement(): Promise<void>; addListener(event: string, callback: (event: SDKEvent | null) => void): void };
type SDK = { Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume: number }) => Player };
declare global { interface Window { Spotify?: SDK; onSpotifyWebPlaybackSDKReady?: () => void } }
let sdkPromise: Promise<SDK> | null = null;
function loadSDK(): Promise<SDK> {
  if (window.Spotify) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { sdkPromise = null; reject(new Error('Spotify player took too long to load. Retry playback.')); }, 15000);
    window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timer); if (window.Spotify) resolve(window.Spotify); else { sdkPromise = null; reject(new Error('Spotify player could not load.')); } };
    document.getElementById('crate-spotify-sdk')?.remove();
    const script = document.createElement('script'); script.id = 'crate-spotify-sdk'; script.src = 'https://sdk.scdn.co/spotify-player.js'; script.async = true;
    script.onerror = () => { clearTimeout(timer); sdkPromise = null; reject(new Error('Spotify player could not load. Check your connection and retry.')); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}
export function useSpotifyPlayback(track: Track | undefined, authorized: boolean, startPercent: number) {
  const player = useRef<Player | null>(null);
  const queue = useRef(new PlaybackQueue());
  const generation = useRef(0);
  const wanted = useRef<Track | undefined>(undefined);
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [position, setPosition] = useState(0);
  const anchor=useRef({position:0,time:0});
  const duration=useRef(0);duration.current=track?.durationMs||0;
  const [retrySDK, setRetrySDK] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const stop = useCallback(() => {
    generation.current++; wanted.current = undefined;
    const p = player.current;
    if (p) { void p.pause().catch(() => {}); queue.current.enqueue(async () => { await p.pause().catch(() => {}); }); }
    if (mounted.current) setStatus('paused');
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false; let instance: Player | null = null;
    setStatus('connecting'); setError(''); setDeviceId('');
    loadSDK().then(sdk => {
      if (cancelled) return;
      instance = new sdk.Player({ name: 'Crate listening room', volume: 0.65, getOAuthToken: callback => {
        fetch('/api/auth/spotify/token', { cache: 'no-store' }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); if (!cancelled) callback(data.accessToken); }).catch(e => { if (!cancelled) { setError(e.message); setStatus('error'); } });
      } });
      player.current = instance;
      instance.addListener('ready', event => { if (!cancelled && event?.device_id) { setDeviceId(event.device_id); setStatus('ready'); } });
      instance.addListener('not_ready', () => { if (!cancelled) { setDeviceId(''); setStatus('error'); setError('Spotify player disconnected. Retry playback.'); } });
      instance.addListener('autoplay_failed', () => { if (!cancelled) { setStatus('needs-interaction'); setError('Tap Enable sound to let your browser play music.'); } });
      for (const kind of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) instance.addListener(kind, event => { if (!cancelled) { setStatus('error'); setError(kind === 'account_error' ? 'Spotify Premium is required for automatic playback.' : event?.message || 'Spotify playback could not start. Retry playback.'); } });
      instance.addListener('player_state_changed', event => {
        if (cancelled || !event || event.track_window?.current_track?.uri !== `spotify:track:${wanted.current?.id.slice(8)}`) return;
        if (!event.paused) setError('');
        setStatus(previous=>event.paused&&previous==='needs-interaction'?'needs-interaction':event.paused?'paused':'playing'); if (typeof event.position === 'number') {setPosition(event.position);anchor.current={position:event.position,time:performance.now()};}
      });
      return instance.connect().then(connected => { if (!cancelled && !connected) { setStatus('error'); setError('Spotify could not connect this browser. Retry playback.'); } });
    }).catch(e => { if (!cancelled) { setError(e.message); setStatus('error'); } });
    const activate = () => { void player.current?.activateElement().catch(() => {}); };
    document.addEventListener('pointerdown', activate, { capture: true }); document.addEventListener('keydown', activate, { capture: true });
    return () => { cancelled = true; generation.current++; wanted.current = undefined; queue.current.clear(); void instance?.pause().catch(() => {}); instance?.disconnect(); player.current = null; document.removeEventListener('pointerdown', activate, { capture: true }); document.removeEventListener('keydown', activate, { capture: true }); };
  }, [authorized, retrySDK]);
  useEffect(() => {
    if (!authorized || !track || !deviceId || document.hidden) { stop(); return; }
    const id = ++generation.current; wanted.current = track; setError(''); setStatus('starting'); setPosition(startPosition(track.durationMs, startPercent));anchor.current={position:startPosition(track.durationMs,startPercent),time:performance.now()};
    const p = player.current;
    queue.current.enqueue(async () => {
      if (id !== generation.current) return;
      try {
        await p?.pause(); if (id !== generation.current) return;
        const response = await fetch('/api/playback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: track.id, deviceId, durationMs: track.durationMs, startPercent }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Playback could not start.');
        if (id === generation.current) {anchor.current.time=performance.now();setStatus('playing');}
      } catch (e) { if (id === generation.current) { setStatus('error'); setError(e instanceof Error ? e.message : 'Playback could not start.'); } }
    });
    return () => { generation.current++; };
  }, [track?.id, deviceId, authorized, startPercent, attempt, stop]);
  useEffect(() => { const hide = () => { if (document.hidden) stop(); }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, [stop]);
  useEffect(()=>{if(status!=='playing')return;const timer=setInterval(()=>{setPosition(Math.min(Math.max(0,duration.current-1),anchor.current.position+performance.now()-anchor.current.time))},250);return()=>clearInterval(timer)},[status]);
  const pause=useCallback(()=>{generation.current++;const p=player.current;if(p){void p.pause().catch(()=>{});queue.current.enqueue(async()=>{await p.pause().catch(()=>{})})}setStatus('paused')},[]);
  const seek=useCallback((value:number)=>{const p=player.current;const selected=wanted.current;const id=generation.current;if(!p||!selected||!Number.isFinite(value))return;const target=clampSeek(value,selected.durationMs);queue.current.enqueue(async()=>{if(id!==generation.current||wanted.current?.id!==selected.id)return;try{await p.seek(target);if(id===generation.current){setPosition(target);anchor.current={position:target,time:performance.now()}}}catch{if(id===generation.current)setError('Could not seek. Try again.')}})},[]);
  const enable = useCallback(() => {
    const p = player.current;
    if (!p || !deviceId) { setRetrySDK(v => v + 1); return; }
    // activateElement must run directly inside the user gesture.
    const activation=p.activateElement();
    if(wanted.current&&(status==='paused'||status==='needs-interaction')){
      const id=generation.current;
      void activation.then(()=>{queue.current.enqueue(async()=>{if(id!==generation.current)return;try{await p.resume();if(id===generation.current){anchor.current={position,time:performance.now()};setError('');setStatus('playing')}}catch{if(id===generation.current){setStatus('needs-interaction');setError('Tap Enable sound to let your browser play music.')}}})}).catch(()=>{setStatus('needs-interaction');setError('Tap Enable sound to let your browser play music.')});
    }else void activation.then(()=>setAttempt(v=>v+1)).catch(()=>setError('Your browser blocked playback. Try again.'));
  }, [deviceId,status,position]);
  return { status, error, position, stop, pause, seek, enable };
}
