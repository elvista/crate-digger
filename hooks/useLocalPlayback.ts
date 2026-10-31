'use client';
import {useEffect,useRef,useState,useCallback} from 'react';
import type {Track} from '@/lib/catalog';
export function useLocalPlayback(track:Track|undefined,startPercent:number){
 const audio=useRef<HTMLAudioElement|null>(null),initialSeek=useRef(true),[status,setStatus]=useState('paused'),[error,setError]=useState(''),[position,setPosition]=useState(0);
 const enable=useCallback(()=>{const a=audio.current;if(!a)return;if(a.error){initialSeek.current=true;setError('');setStatus('starting');a.load();return}void a.play().then(()=>{if(audio.current===a){setError('');setStatus('playing')}}).catch(e=>{if(audio.current!==a)return;if(e.name==='AbortError')return;setError(e.name==='NotAllowedError'?'Press Play to start local audio.':e.name==='NotSupportedError'?'Your browser cannot play this recording’s audio format. Try it in Rekordbox.':'Could not play local audio. Press Retry local audio to reload the file.');setStatus(e.name==='NotAllowedError'?'needs-interaction':'error')})},[]);
 const pause=useCallback(()=>{audio.current?.pause();setStatus('paused')},[]),stop=pause;
 const seek=useCallback((ms:number)=>{const a=audio.current;if(a&&Number.isFinite(a.duration)){a.currentTime=Math.min(a.duration,Math.max(0,ms/1000));setPosition(a.currentTime*1000)}},[]);
 useEffect(()=>{
  setPosition(0);setError('');if(!track){audio.current=null;setStatus('paused');return}
  const a=new Audio();audio.current=a;initialSeek.current=true;setStatus('starting');const abort=new AbortController();let fallbackAttempted=false;
  a.onloadedmetadata=()=>{if(audio.current!==a)return;if(initialSeek.current&&Number.isFinite(a.duration)){a.currentTime=a.duration*startPercent/100;initialSeek.current=false}enable()};
  a.onplaying=()=>{if(audio.current===a){setError('');setStatus('playing')}};
  a.onwaiting=()=>{if(audio.current===a)setStatus('starting')};
  a.onpause=()=>{if(audio.current===a)setStatus('paused')};
  a.ontimeupdate=()=>setPosition(a.currentTime*1000);a.onended=()=>setStatus('paused');
  a.onerror=()=>{if(audio.current!==a)return;if(a.error?.code===MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED&&!fallbackAttempted){fallbackAttempted=true;initialSeek.current=true;setStatus('starting');setError('Preparing a browser playback copy…');a.src=`${track.sourceUrl}${track.sourceUrl.includes('?')?'&':'?'}transcode=1`;a.load();return}setStatus('error');setError('Local audio could not load. Checking the file…');void fetch(a.src,{headers:{Range:'bytes=0-0'},cache:'no-store',signal:abort.signal}).then(async r=>{if(audio.current!==a||!a.error)return;const d=!r.ok?await r.json().catch(()=>null):null;setError(d?.error||'Your browser could not play this audio format. Retry local audio or check the file in Rekordbox.')}).catch(()=>{if(audio.current===a)setError('The local audio server could not be reached. Make sure the local app is running, then retry.')})};
  a.src=track.sourceUrl;a.load();
  return()=>{abort.abort();a.onplaying=null;a.onwaiting=null;a.onpause=null;a.pause();a.onloadedmetadata=null;a.ontimeupdate=null;a.onended=null;a.onerror=null;a.removeAttribute('src');a.load();if(audio.current===a)audio.current=null};
 },[track?.id,track?.sourceUrl,startPercent,enable]);
 return {status,error,position,enable,pause,stop,seek,recovery:'retry' as const,retryAt:undefined,seekReady:!!track&&['playing','paused'].includes(status)};
}
