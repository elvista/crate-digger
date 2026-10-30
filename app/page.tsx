'use client';
import AppHeader from '@/components/AppHeader';
import styles from './discover.module.css';
import {publishPlaylistCount} from '@/lib/playlist-counts';
import QuickPlaylistPicker from '@/components/QuickPlaylistPicker';
import SourcePicker from '@/components/SourcePicker';
import TrackTimeline from '@/components/TrackTimeline';
import type {Playlist,SessionPage} from '@/lib/discovery-types';
import { useSpotifyPlayback } from '@/hooks/useSpotifyPlayback';
import { DEFAULT_START_PERCENT, readStartPercent, SETTINGS_KEY } from '@/lib/playback-settings';
import {useState,useEffect,useRef,useCallback} from 'react';
import {motion,AnimatePresence} from 'motion/react';
import {AudioLines, Heart, ArrowUpRight, X, RotateCcw, Check, Headphones, ListMusic, ChevronDown, ArrowUp} from 'lucide-react';
import {CatalogError,type Track} from '@/lib/catalog';
import {discoveryGesture} from '@/lib/discovery-gesture';
type Decision={eventId:string;trackId:string;track:Track;decision:'skip'|'save';occurredAt:string;archived?:boolean};
type User={id:string;name:string;playbackAuthorized:boolean;playlistAuthorized:boolean;playlistWriteAuthorized:boolean};
export default function Home(){
 const [upNextOpen,setUpNextOpen]=useState(false);
 const [shortcutsOpen,setShortcutsOpen]=useState(false);
 useEffect(()=>{setUpNextOpen(!window.matchMedia('(max-width:800px)').matches)},[]);

 const [sourceOpen,setSourceOpen]=useState(false);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const saveGate=useRef(false),saveOperations=useRef(new Map<string,string>());
 const [playlistTrack,setPlaylistTrack]=useState<Track|null>(null);

 const [selection,setSelection]=useState<{playlists:Playlist[];tracks:Track[];mode:'playlist'|'related'}>({playlists:[],tracks:[],mode:'related'});
 const [activeSession,setActiveSession]=useState<SessionPage|null>(null);
 const [history,setHistory]=useState<Track[]>([]);
 const [revisit,setRevisit]=useState<number|null>(null);
 const [browsed,setBrowsed]=useState<Set<string>>(new Set());
 const [user,setUser]=useState<User|null>(null);
 const [checking,setChecking]=useState(true);
 const [configured,setConfigured]=useState(false);
 const [authError,setAuthError]=useState('');
 const [events,setEvents]=useState<Decision[]>([]);
 const [tracks,setTracks]=useState<Track[]>([]);
 const [loading,setLoading]=useState(true);
 const [catalogError,setCatalogError]=useState('');
 const [cursor,setCursor]=useState<string|null>(null);
 const [retry,setRetry]=useState(0);
 const [ready,setReady]=useState(false);
 const [error,setError]=useState('');
 const [toast,setToast]=useState('');
 const [direction,setDirection]=useState(1);
 const [startPercent,setStartPercent]=useState(DEFAULT_START_PERCENT);
 const [settingsReady,setSettingsReady]=useState(false);
 const [backgrounded,setBackgrounded]=useState(false);
 const lock=useRef(false);
 const request=useRef(0);
 const fetching=useRef(false);
 const pageController=useRef<AbortController|null>(null);
 const storageKey=user?`crate-spotify-decisions-v1:${user.id}`:'';
 useEffect(()=>{
  const controller=new AbortController();
  const messages:Record<string,string>={denied:'Spotify sign-in was cancelled. You can try again.',invalid_state:'Your sign-in session expired. Please try again.',profile:'Spotify could not load your account. Check the app’s allowed users, then sign in again.',failed:'Could not complete Spotify sign-in. Please try again.'};
  const reason=new URLSearchParams(window.location.search).get('auth_error');if(reason){setAuthError(messages[reason]||'Spotify sign-in needs another try.');window.history.replaceState(null,'',window.location.pathname);}
  fetch('/api/auth/spotify/session',{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);setConfigured(data.configured);setUser(data.authenticated?data.user:null)}).catch(e=>{if(!controller.signal.aborted)setAuthError(e.message||'Could not check Spotify sign-in.')}).finally(()=>{if(!controller.signal.aborted)setChecking(false)});
  return()=>controller.abort();
 },[]);
 useEffect(()=>{setReady(false);setEvents([]);setSaveError('');setActiveSession(null);setHistory([]);setBrowsed(new Set());setRevisit(null);if(!storageKey)return;const abort=new AbortController();
  async function restore(){let restored=false;try{const data=JSON.parse(localStorage.getItem(storageKey)||'[]');if(!Array.isArray(data))throw new Error();setEvents(data.filter((e:Decision)=>/^spotify:[A-Za-z0-9]{22}$/.test(e?.track?.id||'')&&(e.decision==='save'||e.decision==='skip')));const savedSelection=localStorage.getItem(`crate-digging-sources:${user!.id}`);if(savedSelection){const value=JSON.parse(savedSelection);if(Array.isArray(value.playlists)&&Array.isArray(value.tracks)&&['playlist','related'].includes(value.mode))setSelection(value)}const id=localStorage.getItem(`crate-digging-session:${user!.id}`);if(id&&/^[a-f0-9-]{36}$/.test(id)){const r=await fetch(`/api/discovery-sessions/${id}/tracks`,{signal:abort.signal,cache:'no-store'});const page=await r.json();if(abort.signal.aborted)return;if(r.ok){restored=true;setActiveSession(page);setTracks(page.items);setCursor(page.nextCursor);setCatalogError('');setLoading(false)}else{localStorage.removeItem(`crate-digging-session:${user!.id}`);setError('Your previous digging session expired. Choose sources to generate another.')}}}catch{if(!abort.signal.aborted)setError('Some saved session data could not be restored. Your browser storage may be unavailable.')}finally{if(!abort.signal.aborted){setReady(true);setLoading(false);if(!restored)setSourceOpen(true)}}}
  void restore();return()=>abort.abort();
 },[storageKey]);
 useEffect(()=>{if(!user||!ready)return;try{if(activeSession)localStorage.setItem(`crate-digging-session:${user.id}`,activeSession.id);else localStorage.removeItem(`crate-digging-session:${user.id}`);localStorage.setItem(`crate-digging-sources:${user.id}`,JSON.stringify(selection))}catch{setError('Could not save session preferences in this browser.')}},[user?.id,ready,activeSession?.id,selection]);
 const reviewed=new Set(events.map(e=>e.trackId));
 const queue=user?tracks.filter(t=>!reviewed.has(t.id)&&!browsed.has(t.id)):[];
 const current=revisit!==null?history[revisit]:queue[0];
 const upcoming=queue.filter(track=>track.id!==current?.id);
 const last=events[events.length-1];
 const playback=useSpotifyPlayback(!sourceOpen&&!playlistTrack&&!backgrounded&&settingsReady?current:undefined,!!user?.playbackAuthorized,startPercent);
 useEffect(()=>{try{setStartPercent(readStartPercent(localStorage.getItem(SETTINGS_KEY)))}catch{}setSettingsReady(true)},[]);
 const loadMore=useCallback(()=>{
  if(!cursor||fetching.current||!activeSession||!user)return;
  fetching.current=true;setLoading(true);setCatalogError('');const id=request.current;const controller=new AbortController();pageController.current=controller;
  fetch(`/api/discovery-sessions/${activeSession.id}/tracks?${new URLSearchParams({cursor})}`,{signal:controller.signal,cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok)throw new CatalogError(data.error,r.status);return data}).then(page=>{if(id!==request.current)return;setTracks(old=>[...new Map([...old,...page.items].map(t=>[t.id,t])).values()]);setCursor(page.nextCursor)}).catch(e=>{if(!controller.signal.aborted&&id===request.current){if(e instanceof CatalogError&&e.status===401){setUser(null);setAuthError('Your Spotify session expired. Sign in again.')}else setCatalogError(e instanceof Error?e.message:'Could not load more tracks.')}}).finally(()=>{if(id===request.current){fetching.current=false;setLoading(false)}});
 },[cursor,user,activeSession?.id]);
 useEffect(()=>{if(ready&&queue.length<5&&cursor&&!loading&&!catalogError&&!sourceOpen)loadMore()},[ready,queue.length,cursor,loading,catalogError,loadMore,sourceOpen]);
 useEffect(()=>{const hide=()=>{if(document.hidden)setBackgrounded(true)};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide)},[]);
 useEffect(()=>{setBackgrounded(false)},[current?.id]);
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),2200);return()=>clearTimeout(timer)},[toast]);
 const recordDecision=useCallback((decision:'save'|'skip')=>{
  if(!current||lock.current||!ready||!storageKey)return;lock.current=true;setSaveError('');
  const next=[...events,{eventId:crypto.randomUUID(),trackId:current.id,track:current,decision,occurredAt:new Date().toISOString()}];
  try{localStorage.setItem(storageKey,JSON.stringify(next));playback.stop();setDirection(decision==='save'?1:-1);setEvents(next);if(revisit===null){setHistory(old=>[...old,current]);setBrowsed(old=>new Set([...old,current.id]))}else setRevisit(revisit+1<history.length?revisit+1:null);setToast(decision==='save'?`${current.title} saved to Spotify`:'Track skipped')}
  catch{lock.current=false;setError('Could not save your decision. Check your browser storage and try again.')}
 },[current,events,ready,storageKey,playback.stop,revisit,history.length]);
 const saveCurrent=useCallback(async()=>{
  if(!current||!user||saveGate.current||lock.current||!ready)return;
  if(!user.playlistWriteAuthorized){setSaveError('Enable Spotify playlist saving to save songs to Crate Finds.');return}
  saveGate.current=true;setSaving(true);setSaveError('');
  if(!saveOperations.current.has(current.id))saveOperations.current.set(current.id,crypto.randomUUID());
  try{const response=await fetch('/api/playlist-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:saveOperations.current.get(current.id),mode:'finds',uris:[`spotify:track:${current.id.slice(8)}`]})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Spotify could not save this song.');publishPlaylistCount(result.playlistId,result.count,result.playlist);recordDecision('save');setToast(result.added?'Saved to Crate Finds':'Already in Crate Finds');}
  catch(e){setSaveError((e as Error).message)}finally{saveGate.current=false;setSaving(false)}
 },[current,user,ready,recordDecision]);
 const commit=useCallback((decision:'save'|'skip')=>{if(saveGate.current)return;if(decision==='save')void saveCurrent();else recordDecision('skip')},[saveCurrent,recordDecision]);
 function undo(){if(!last||saveGate.current)return;try{const next=events.slice(0,-1);localStorage.setItem(storageKey,JSON.stringify(next));setEvents(next);const index=history.findIndex(t=>t.id===last.trackId);if(index>=0)setRevisit(index);else{setHistory(old=>[...old,last.track]);setRevisit(history.length)}setToast(last.decision==='save'?'Track restored for review. It remains in Spotify.':'Last decision undone')}catch{setError('Could not undo. Please try again.')}}
 const closeSources=useCallback(()=>setSourceOpen(false),[]);
 const acceptSession=useCallback((page:SessionPage)=>{request.current++;pageController.current?.abort();fetching.current=false;setActiveSession(page);setTracks(page.items);setCursor(page.nextCursor);setCatalogError('');setLoading(false);setHistory([]);setBrowsed(new Set());setRevisit(null);setSourceOpen(false);setSaveError('')},[]);
 async function signOut(){playback.stop();try{const r=await fetch('/api/auth/spotify/logout',{method:'POST'});if(!r.ok)throw new Error();pageController.current?.abort();request.current++;setUser(null);setEvents([]);setTracks([]);setCursor(null);setActiveSession(null);setHistory([]);setBrowsed(new Set());setRevisit(null);setSelection({playlists:[],tracks:[],mode:'related'});setSourceOpen(false);setSaveError('');setAuthError('');}catch{setError('Could not sign out. Please retry.')}}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{
  if(e.defaultPrevented||e.repeat||e.ctrlKey||e.metaKey||e.altKey||saving||sourceOpen||playlistTrack||(e.target as HTMLElement).closest('input,select,textarea,[contenteditable=true],.discovery-sources'))return;
  if(e.key==='ArrowRight'){e.preventDefault();commit('save')}
  else if(e.key==='ArrowLeft'){e.preventDefault();commit('skip')}
  else if(e.key==='ArrowUp'&&current){e.preventDefault();playback.stop();setPlaylistTrack(current)}
  else if(e.key===' '&&!(e.target as HTMLElement).closest('button,a,summary')){e.preventDefault();if(playback.status==='playing')playback.pause();else{setBackgrounded(false);playback.enable()}}
  else if(e.key.toLowerCase()==='j'){e.preventDefault();playback.seek(Math.max(0,playback.position-10000))}
  else if(e.key.toLowerCase()==='l'){e.preventDefault();playback.seek(playback.position+10000)}
  else if(e.key.toLowerCase()==='z'){e.preventDefault();undo()}
  else if(e.key==='?'){e.preventDefault();setShortcutsOpen(v=>!v)}
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[commit,saving,sourceOpen,playlistTrack,current,playback.status,playback.position,playback.seek,playback.stop,playback.pause,playback.enable,last]);

 return <div className="crate-app theme-basement"><AppHeader active="discover" userName={user?.name??null} onSignOut={signOut}/>
      <main className={user?styles.workspace:undefined}>{!user&&<div className="intro"><h1>Good music. Gut feeling.</h1></div>}
      {!user?<section className="signin-panel"><div className="signin-mark"><AudioLines size={44}/></div><h2>Find your next obsession.</h2><p>Sign in with Spotify to explore electronic music.<br/>Listen to a track. Keep what moves you.</p><button className="spotify-signin" disabled={checking||!configured} onClick={()=>{window.location.href='/api/auth/spotify/login'}}><SpotifyLogo/>{checking?'Checking your session…':'Sign in with Spotify'}</button>{authError&&<p className="signin-error" role="alert">{authError}</p>}{!checking&&!configured&&<p className="setup-note">Spotify sign-in is being set up. The app owner needs to configure the Spotify client ID and session secret.</p>}<p className="signin-footnote">Save songs straight to your Crate Finds playlist on Spotify.</p></section>:<><aside className={`discovery-sources ${sourceOpen?'sources-expanded':''}`} aria-label="Discovery sources">{ready&&<SourcePicker embedded onClose={closeSources} onGenerated={acceptSession} onSelection={setSelection} initial={selection} reviewedIds={[...reviewed]} playlistAuthorized={user.playlistAuthorized}/>}</aside><section className="discovery-content"><div className="discovery-page-heading"><h1>Discover</h1><button className="mobile-sources-toggle" disabled={saving} onClick={()=>{playback.stop();setSourceOpen(v=>!v)}} aria-expanded={sourceOpen}><ListMusic size={17}/>Change sources</button><div className="queue-count"><span className="live-dot"/>{loading?'Loading tracks…':`${queue.length}${cursor?'+':''} tracks ahead`}</div></div>{activeSession&&<p className="discovery-source-summary">{activeSession.method==='cosine'?'Similar sound · cosine.club':activeSession.method==='spotify'?'Spotify recommendations':activeSession.method==='artists'?'Artist-based discovery':'Selected tracks'} · {activeSession.sources.slice(0,3).join(', ')}{activeSession.sources.length>3?` +${activeSession.sources.length-3} more`:''}</p>}{activeSession?.warnings.length?<details className="session-warnings"><summary>About these recommendations</summary>{activeSession.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>:null}<details className="keyboard-shortcuts" open={shortcutsOpen} onToggle={e=>setShortcutsOpen(e.currentTarget.open)}><summary>Keyboard shortcuts <kbd>?</kbd></summary><dl><div><dt><kbd>←</kbd> / <kbd>→</kbd></dt><dd>Pass / save to Crate Finds</dd></div><div><dt><kbd>↑</kbd></dt><dd>Open playlist picker</dd></div><div><dt><kbd>Space</kbd></dt><dd>Play / pause</dd></div><div><dt><kbd>J</kbd> / <kbd>L</kbd></dt><dd>Back / forward 10 seconds</dd></div><div><dt><kbd>Z</kbd></dt><dd>Undo last decision</dd></div><div><dt><kbd>↑</kbd> / <kbd>↓</kbd></dt><dd>Choose a playlist in the picker</dd></div><div><dt><kbd>Enter</kbd></dt><dd>Add to playlist and next song</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Close the picker</dd></div><div><dt><kbd>Tab</kbd></dt><dd>Move between controls</dd></div></dl></details><div className="discovery">
      <section className="deck" aria-label="Track discovery" aria-busy={saving} tabIndex={-1}><AnimatePresence mode="wait" initial={false} custom={direction}>{current?<motion.article key={current.id} className="track-card" custom={direction} variants={{enter:{opacity:0,y:12},center:{opacity:1,y:0},exit:(exitDirection:number)=>({opacity:0,x:exitDirection*520,rotate:exitDirection*10})}} initial="enter" animate="center" exit="exit" transition={{duration:.18}} onAnimationComplete={state=>{if(state!=='exit')lock.current=false}} drag={!saving} dragSnapToOrigin onDragEnd={(_,info)=>{const gesture=discoveryGesture(info.offset,info.velocity);if(gesture==='playlist'){playback.stop();setPlaylistTrack(current)}else if(gesture&&!saving)commit(gesture)}} style={{touchAction:'none'}}><Artwork track={current}/><div className="track-info" onPointerDown={e=>{if((e.target as HTMLElement).closest('button,a,input,select,textarea,[role=slider]'))e.stopPropagation()}}><div className="track-heading"><div><h2>{current.title}</h2><p>{current.artist}</p></div><button className="quick-playlist-button" aria-label="Add current song to Spotify playlist" title="Add to playlist · swipe up" disabled={saving} onClick={()=>{playback.stop();setPlaylistTrack(current)}}><ArrowUp size={20}/></button><a className="track-link" href={current.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="View track on Spotify"><ArrowUpRight size={20}/></a></div><TrackTimeline key={current.id} track={current} position={playback.position} status={playback.status} error={playback.error} startPercent={startPercent} toggle={()=>{if(playback.status==='playing')playback.pause();else{setBackgrounded(false);playback.enable()}}} seek={playback.seek} enabled={user.playbackAuthorized}/></div></motion.article>:<div className="empty-card" role="status">{loading?<Headphones size={40}/>:catalogError?<X size={40}/>:<Check size={40}/>}<h2>{loading?'Finding your next track…':catalogError?'Spotify is unavailable':activeSession?'You dug through it all.':'Choose your starting points.'}</h2><p>{loading?'Loading tracks from Spotify.':catalogError||'Change your sources to find more tracks.'}</p>{!loading&&<button className="change-empty" onClick={()=>setSourceOpen(true)}>Choose sources</button>}{catalogError?<button onClick={()=>cursor?loadMore():setSourceOpen(true)}>Retry connection <RotateCcw size={17}/></button>:null}</div>}</AnimatePresence><div className="actions"><button className="undo" onClick={undo} disabled={!last||saving} aria-label="Undo last decision"><RotateCcw size={20}/></button><div className="decision-control"><button className="skip" disabled={!current||saving} onClick={()=>commit('skip')} aria-label="Pass on track" title="Pass · swipe left"><X size={28}/></button><span>Pass</span></div><div className="decision-control"><button className="playlist-up" disabled={!current||saving} onClick={()=>{if(current){playback.stop();setPlaylistTrack(current)}}} aria-label="Add to Spotify playlist" title="Add to playlist · swipe up or press Up"><ArrowUp size={26}/></button><span>Playlist</span></div><div className="decision-control"><button className="save" disabled={!current||saving} onClick={()=>commit('save')} aria-label="Save to Crate Finds" title="Save to Crate Finds · swipe right"><Heart size={27}/></button><span>{saving?'Saving…':'Save'}</span></div></div><div className="keyboard-hint"><kbd>↑</kbd> Playlist <span/><kbd>←</kbd> Pass <span/><kbd>→</kbd> Save <span className="desktop-only">Swipe up to add to a playlist</span></div></section>
      </div>{activeSession&&<section className="up-next" aria-labelledby="up-next-title"><div className="up-next-heading"><h2 id="up-next-title"><button className="up-next-toggle" aria-expanded={upNextOpen} aria-controls="up-next-tracks" onClick={()=>setUpNextOpen(v=>!v)}>Up next<ChevronDown size={17}/></button></h2><span>{upcoming.length}{cursor?'+':''} tracks ahead</span></div><div id="up-next-tracks" hidden={!upNextOpen}>{upcoming.length?<ol aria-label="Generated tracks ahead">{upcoming.map((track,index)=><li key={track.id}><span className="up-next-number">{index+1}</span><Artwork track={track} small/><div className="up-next-copy"><strong title={track.title}>{track.title}</strong><span title={track.artist}>{track.artist}</span></div><span className="up-next-duration">{Math.floor(track.durationMs/60000)}:{String(Math.floor(track.durationMs/1000)%60).padStart(2,'0')}</span></li>)}</ol>:<p className="up-next-empty" role="status">{loading?'Loading more tracks…':'No more tracks in this queue.'}</p>}</div></section>}</section></>}
      {catalogError&&current&&<div className="error" role="alert">{catalogError} <button onClick={loadMore}>Retry loading tracks</button></div>}{saveError&&<div className="error" role="alert">{saveError}{user?.playlistWriteAuthorized?<button disabled={saving} onClick={()=>void saveCurrent()}>Retry saving to Crate Finds</button>:<a href="/api/auth/spotify/login">Enable playlist saving</a>}</div>}{error&&<div className="error" role="alert">{error}</div>}</main>{playlistTrack&&user&&<QuickPlaylistPicker track={playlistTrack} owner={user.id} authorized={user.playlistWriteAuthorized} onClose={()=>setPlaylistTrack(null)} onSaved={message=>{recordDecision('save');setPlaylistTrack(null);setToast(message);requestAnimationFrame(()=>document.querySelector<HTMLElement>('.deck')?.focus({preventScroll:true}))}}/>}{toast&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}</div>
}
function Artwork({track,small=false}:{track:Track;small?:boolean}){const [failed,setFailed]=useState(false);return <div className={`artwork spotify-artwork ${small?'artwork-small':''}`} aria-label={`${track.title} cover artwork`}>{track.artworkUrl&&!failed?<img src={track.artworkUrl} alt={`${track.title} by ${track.artist}`} draggable={false} onError={()=>setFailed(true)}/>:<div className="artwork-placeholder"><AudioLines size={small?20:70}/>{!small&&<span>Artwork unavailable</span>}</div>}</div>}

function SpotifyLogo(){return <svg role="img" aria-label="Spotify" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="12"/><path d="M5.3 8.7c4.8-1.4 9.1-1.1 13.5 1.1M6 12c4.2-1.2 8.1-.8 12 1.1M6.8 15.2c3.6-.9 6.7-.5 10 1" fill="none" stroke="#191b1d" strokeWidth="1.6" strokeLinecap="round"/></svg>}
