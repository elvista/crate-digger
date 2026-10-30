'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {playbackOwnership} from '@/lib/playback-ownership';
import {playbackIssue,pauseBeforeStarting,type PlaybackRecovery} from '@/lib/playback-errors';
import type { Track } from '@/lib/catalog';
import { PlaybackQueue, startPosition, clampSeek } from '@/lib/playback-settings';
type SDKEvent = { device_id?: string; message?: string; paused?: boolean; position?: number; track_window?: { current_track?: { uri?: string } } };
type Player = { getCurrentState():Promise<SDKEvent|null>; connect(): Promise<boolean>; disconnect(): void; pause(): Promise<void>; resume(): Promise<void>; seek(positionMs:number):Promise<void>; activateElement(): Promise<void>; addListener(event: string, callback: (event: SDKEvent | null) => void): void };
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
export function useSpotifyPlayback(track: Track | undefined, authorized: boolean, startPercent: number,ownerId='spotify') {
  const player = useRef<Player | null>(null);
  const queue = useRef(new PlaybackQueue());
  const generation = useRef(0);
  const wanted = useRef<Track | undefined>(undefined);
  const [deviceId, setDeviceId] = useState('');
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState('');
  const [position, setPosition] = useState(0);
  const [recovery,setRecovery]=useState<PlaybackRecovery>('retry');
  const [retryAt,setRetryAt]=useState<number|undefined>();
  const lastStarted=useRef<string|undefined>(undefined);
  const fail=useCallback((message:string,kind='',code?:number,retryAfter?:string|null)=>{const issue=playbackIssue(message,kind,code,retryAfter);setError(issue.message);setRecovery(issue.recovery);setRetryAt(issue.retryAt);setStatus(issue.recovery==='wait'?'waiting':issue.recovery==='activate'?'needs-interaction':'error')},[]);
  const currentStatus=useRef(status);currentStatus.current=status;
  const anchor=useRef({position:0,time:0});
  const duration=useRef(0);duration.current=track?.durationMs||duration.current;
  const [retrySDK, setRetrySDK] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(false);
  const requestOwnership=useRef<(()=>void)|null>(null);
  const [visible,setVisible]=useState(false);
  useEffect(()=>{const change=()=>setVisible(!document.hidden);change();document.addEventListener('visibilitychange',change);return()=>document.removeEventListener('visibilitychange',change)},[]);
  const stop = useCallback(() => {
    if(currentStatus.current==='playing')anchor.current={position:Math.min(Math.max(0,duration.current-1),anchor.current.position+performance.now()-anchor.current.time),time:performance.now()};
    generation.current++; wanted.current = undefined;
    const p = player.current;
    if (p) { void p.pause().catch(() => {}); queue.current.enqueue(async () => { await p.pause().catch(() => {}); }); }
    if (mounted.current) setStatus(value=>['connecting','other-tab','waiting','error','needs-interaction'].includes(value)?value:'paused');
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!authorized||!visible) return;
    let cancelled=false,instance:Player|null=null,owns=false;
    const abort=new AbortController();let release:()=>void=()=>{};
    const held=new Promise<void>(resolve=>{release=resolve});
    const disconnect=()=>{generation.current++;wanted.current=undefined;queue.current.clear();if(player.current===instance)player.current=null;setDeviceId('');void instance?.pause().catch(()=>{});instance?.disconnect();instance=null;owns=false};
    const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(`crate-playback:${ownerId}`);
    const ownership=channel?playbackOwnership(channel,crypto.randomUUID(),()=>{
      if(!owns)return;disconnect();release();setStatus('other-tab');setError('Playback moved to another Crate tab. Press Play to listen here.');setRecovery('retry');
    }):null;
    requestOwnership.current=()=>ownership?.request();
    async function connect(){
      if(cancelled)return;owns=true;setStatus('connecting');setError('');setDeviceId('');
      try{
        const sdk=await loadSDK();if(cancelled||!owns)return;
        instance=new sdk.Player({name:'Crate listening room',volume:.65,getOAuthToken:callback=>{
          fetch('/api/auth/spotify/token',{cache:'no-store',signal:abort.signal}).then(async r=>{const data=await r.json();if(cancelled||!owns)return;if(!r.ok){fail(data.error||'','',r.status,r.headers.get('Retry-After'));return}callback(data.accessToken)}).catch(e=>{if(!cancelled&&owns)fail(e.message)});
        }});
        player.current=instance;
        instance.addListener('ready',event=>{if(!cancelled&&owns&&event?.device_id){setDeviceId(event.device_id);setStatus('ready')}});
        instance.addListener('not_ready',()=>{if(!cancelled&&owns){setDeviceId('');fail('disconnected')}});
        instance.addListener('autoplay_failed',()=>{if(!cancelled&&owns)fail('autoplay','autoplay_failed')});
        for(const kind of ['initialization_error','authentication_error','account_error','playback_error'])instance.addListener(kind,event=>{if(!cancelled&&owns)fail(event?.message||'',kind)});
        instance.addListener('player_state_changed',event=>{
          if(cancelled||!owns||!event||event.track_window?.current_track?.uri!==`spotify:track:${wanted.current?.id.slice(8)}`)return;
          lastStarted.current=wanted.current?.id;
          if(!event.paused)setError('');
          setStatus(previous=>event.paused&&previous==='needs-interaction'?'needs-interaction':event.paused?'paused':'playing');
          if(typeof event.position==='number'){setPosition(event.position);anchor.current={position:event.position,time:performance.now()}}
        });
        const connected=await instance.connect();if(!cancelled&&owns&&!connected)fail('disconnected');
      }catch(e){if(!cancelled&&owns)fail(e instanceof Error?e.message:'')}
    }
    if(navigator.locks){
      setStatus('other-tab');setRecovery('retry');setError('Another Crate tab may be using Spotify. Press Play to listen here.');
      void navigator.locks.request(`crate-playback:${ownerId}`,{signal:abort.signal},async()=>{if(cancelled)return;void connect();await held}).catch(e=>{if(!cancelled&&e?.name!=='AbortError')fail('disconnected')});
    }else void connect();
    const activate=()=>{void player.current?.activateElement().catch(()=>{})};
    document.addEventListener('pointerdown',activate,{capture:true});document.addEventListener('keydown',activate,{capture:true});
    return()=>{cancelled=true;abort.abort();release();disconnect();ownership?.close();channel?.close();requestOwnership.current=null;document.removeEventListener('pointerdown',activate,{capture:true});document.removeEventListener('keydown',activate,{capture:true})};
  },[authorized,retrySDK,visible,ownerId,fail]);
  useEffect(() => {
    if (!authorized || !track) { stop(); return; }
    if(!deviceId||!visible)return;
    if(retryAt&&retryAt>Date.now()){wanted.current=track;setStatus('waiting');return;}
    const id = ++generation.current; wanted.current = track; setError(''); setStatus('starting'); const from=lastStarted.current===track.id?clampSeek(anchor.current.position,track.durationMs):startPosition(track.durationMs,startPercent);setPosition(from);anchor.current={position:from,time:performance.now()};
    const p = player.current;
    queue.current.enqueue(async () => {
      if (id !== generation.current) return;
      try {
        await pauseBeforeStarting(p); if (id !== generation.current) return;
        const response = await fetch('/api/playback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackId: track.id, deviceId, durationMs: track.durationMs, startPercent, positionMs:from }) });
        const result = await response.json(); if (!response.ok) {if(id===generation.current)fail(result.error||'',result.code||'',response.status,response.headers.get('Retry-After'));return;}
        if (id === generation.current) {lastStarted.current=track.id;setError('');const state=await p?.getCurrentState().catch(()=>null);if(id===generation.current&&state?.track_window?.current_track?.uri===`spotify:track:${track.id.slice(8)}`){setStatus(state.paused?'paused':'playing');if(typeof state.position==='number'){setPosition(state.position);anchor.current={position:state.position,time:performance.now()}}}}
      } catch (e) { if (id === generation.current) { fail(e instanceof Error?e.message:''); } }
    });
    return () => { generation.current++; };
  }, [track?.id, deviceId, authorized, startPercent, attempt, stop, retryAt,fail,visible]);
  useEffect(() => { const hide = () => { if (document.hidden) stop(); }; document.addEventListener('visibilitychange', hide); return () => document.removeEventListener('visibilitychange', hide); }, [stop]);
  useEffect(()=>{if(status!=='playing')return;const timer=setInterval(()=>{setPosition(Math.min(Math.max(0,duration.current-1),anchor.current.position+performance.now()-anchor.current.time))},250);return()=>clearInterval(timer)},[status]);
  const pause=useCallback(()=>{generation.current++;const p=player.current;if(p){void p.pause().catch(()=>{});queue.current.enqueue(async()=>{await p.pause().catch(()=>{})})}setStatus('paused')},[]);
  const seek=useCallback((value:number)=>{const p=player.current;const selected=wanted.current;const id=generation.current;if(!p||!selected||!Number.isFinite(value))return;const target=clampSeek(value,selected.durationMs);queue.current.enqueue(async()=>{if(id!==generation.current||wanted.current?.id!==selected.id)return;try{await p.seek(target);if(id===generation.current){setPosition(target);anchor.current={position:target,time:performance.now()}}}catch{if(id===generation.current)setError('Could not seek. Try again.')}})},[]);
  useEffect(()=>{if(!retryAt)return;const timer=setTimeout(()=>{setRetryAt(undefined);setError('');if(deviceId)setAttempt(v=>v+1);else setRetrySDK(v=>v+1)},Math.max(1,retryAt-Date.now()));return()=>clearTimeout(timer)},[retryAt,deviceId]);
  const enable = useCallback(() => {
    if(retryAt&&retryAt>Date.now())return;
    const p = player.current;
    if(status==='other-tab')requestOwnership.current?.();
    if (!p || !deviceId || status==='error'||status==='other-tab') { setRetrySDK(v => v + 1); return; }
    // activateElement must run directly inside the user gesture.
    const activation=p.activateElement();
    if(wanted.current&&(status==='paused'||status==='needs-interaction')){
      const id=generation.current;
      void activation.then(()=>{queue.current.enqueue(async()=>{if(id!==generation.current)return;try{await p.resume();if(id===generation.current){anchor.current={position,time:performance.now()};setError('');setStatus('playing')}}catch{if(id===generation.current)setAttempt(v=>v+1)}})}).catch(()=>{setStatus('needs-interaction');setError('Tap Enable sound to let your browser play music.')});
    }else void activation.then(()=>setAttempt(v=>v+1)).catch(()=>setError('Your browser blocked playback. Try again.'));
  }, [deviceId,status,position,retryAt]);
  return { status, error, recovery,retryAt,seekReady:!!track&&lastStarted.current===track.id&&!error,position, stop, pause, seek, enable };
}
