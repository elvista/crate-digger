'use client';
import {subscribePlaylistCounts,withPlaylistCounts} from '@/lib/playlist-counts';
import AppHeader from '@/components/AppHeader';
import RekordboxDestination from '@/components/RekordboxDestination';
import Link from 'next/link';
import styles from './downloads.module.css';
import {useEffect,useRef,useState} from 'react';
import {Download,ExternalLink,LoaderCircle,ListMusic,Check,RotateCcw} from 'lucide-react';
import type {Track} from '@/lib/catalog';
import type {Playlist} from '@/lib/discovery-types';
import {readDownloadWorkspace} from '@/lib/download-workspace';
import type {VideoMatch} from '@/lib/youtube-match';
type Row={track:Track;matches:VideoMatch[];chosen:string;selected:boolean;error:string};
const activeJobStates=['queued','running','importing','waiting','waiting-drive','recovering','stopping'];
type Job={message?:string;nextRetryAt?:number|null;autoImport?:boolean;imported?:number;sourcePlaylist?:{id:string;name:string};rekordbox?:{status:string;destination?:{mode:string;name:string;path?:string};error?:string};id:string;status:string;delivery?:'folder'|'legacy-zip';outputFolder?:string|null;total:number;completed:number;current:string;failures:string[];tracks?:{videoId:string;title:string;artist:string;state:string;filename:string|null;reused:boolean;error:string;importState?:string|null;importError?:string}[]};
async function json(path:string,init?:RequestInit){const r=await fetch(path,{...init,cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed.');return data}
function Cover({src,className=''}:{src?:string|null;className?:string}){
 const [failed,setFailed]=useState(false);
 return <span className={`playlist-cover ${className}`}>{src&&!failed?<img src={src} alt="" loading="lazy" onError={()=>setFailed(true)}/>:<ListMusic size={24}/>}</span>
}
function duration(seconds:number){return seconds>0?`${Math.floor(seconds/60)}:${String(Math.floor(seconds)%60).padStart(2,'0')}`:'Duration unknown'}
export default function Downloads(){
 const [library,setLibrary]=useState<Playlist[]>([]),[cursor,setCursor]=useState<string|null>(null),[selected,setSelected]=useState<string[]>([]),[rows,setRows]=useState<Row[]>([]),[warnings,setWarnings]=useState<string[]>([]),[busy,setBusy]=useState(false),[matching,setMatching]=useState(false),[phase,setPhase]=useState(''),[error,setError]=useState(''),[job,setJob]=useState<Job|null>(null),[jobId,setJobId]=useState(''),[owner,setOwner]=useState(''),[signedIn,setSignedIn]=useState<boolean|null>(null);
 const [errorKind,setErrorKind]=useState<'playlists'|'sources'|'download'|'job'|'session'>('playlists');
 const [jobRetry,setJobRetry]=useState(0),[query,setQuery]=useState(''),[hydrated,setHydrated]=useState(false),[storageError,setStorageError]=useState('');
 const [showSources,setShowSources]=useState(true);
 const [localDownloads,setLocalDownloads]=useState(true);
 const [autoImport,setAutoImport]=useState(true);
 const [destinationBlocked,setDestinationBlocked]=useState(false);
 const [launchNotice,setLaunchNotice]=useState('');
 const [destination,setDestination]=useState('');
 const [nextOffset,setNextOffset]=useState<number|null>(null);
 const controller=useRef<AbortController|null>(null),gate=useRef(false);
 const submission=useRef<{fingerprint:string;key:string}|null>(null);
 const sourceRequest=useRef({offset:0,playlistIds:[] as string[]});
 useEffect(()=>subscribePlaylistCounts(()=>setLibrary(old=>withPlaylistCounts(old))),[]);
 async function playlists(append=false){if(gate.current)return;gate.current=true;setBusy(true);setError('');setErrorKind('playlists');try{const d=await json(`/api/playlists${append&&cursor?`?cursor=${cursor}`:''}`);setLibrary(old=>[...new Map([...(append?old:[]),...withPlaylistCounts<Playlist>(d.items)].map((p:Playlist)=>[p.id,p])).values()]);setCursor(d.nextCursor)}catch(e){setError((e as Error).message)}finally{gate.current=false;setBusy(false)}}
 useEffect(()=>{let live=true;json('/api/auth/spotify/session').then(d=>{if(!live)return;setSignedIn(d.authenticated);setLocalDownloads(d.localDownloads!==false);if(d.authenticated){setOwner(d.user.id);if(d.localDownloads!==false)void json('/api/local-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'read'})}).then(v=>{if(live){setDestination(v.settings?.downloadFolder||'');setAutoImport(v.settings?.autoImport!==false)}}).catch(()=>{});try{const workspace=readDownloadWorkspace(localStorage.getItem(`crate-download-workspace:${d.user.id}`));if(workspace){setSelected(workspace.selected.slice(0,1));setRows(workspace.selected.length>1?[]:workspace.rows);setWarnings(workspace.selected.length>1?[]:workspace.warnings);setLibrary(withPlaylistCounts(workspace.library));setShowSources(workspace.selected.length>1?true:workspace.showSources);setNextOffset(workspace.selected.length>1?null:workspace.nextOffset);setQuery(workspace.query)}setJobId(localStorage.getItem(`crate-download-job:${d.user.id}`)||'')}catch{}setHydrated(true);if(d.localDownloads!==false)void json('/api/downloads/jobs').then(latest=>{if(!live||!latest.id)return;setJob(latest);setJobId(latest.id);try{localStorage.setItem(`crate-download-job:${d.user.id}`,latest.id)}catch{}}).catch(()=>{});void playlists(true)}}).catch(e=>{if(live){setErrorKind('session');setError(e.message)}});return()=>{live=false;controller.current?.abort()}},[]);
 useEffect(()=>{if(!jobId||!owner)return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;async function poll(){try{const d=await json(`/api/downloads/jobs?id=${jobId}`,{signal:abort.signal});if(abort.signal.aborted)return;setJob(d);if(activeJobStates.includes(d.status))timer=setTimeout(poll,['waiting','waiting-drive'].includes(d.status)?5000:2000)}catch(e){if(!abort.signal.aborted){setErrorKind('job');setError((e as Error).message)}}}void poll();return()=>{abort.abort();clearTimeout(timer)}},[jobId,owner,jobRetry]);
 async function loadSources(offset=0,playlistIds=selected){if(gate.current||!playlistIds.length)return;gate.current=true;setBusy(true);setError('');setErrorKind('sources');sourceRequest.current={offset,playlistIds};const abort=new AbortController();controller.current=abort;try{const d=await json('/api/downloads/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playlistIds,offset}),signal:abort.signal});setSelected(playlistIds);setRows(d.items.map((track:Track)=>({track,matches:[],chosen:'',selected:false,error:''})));setShowSources(!d.items.length);setWarnings(d.warnings);setNextOffset(d.nextOffset)}catch(e){if(!abort.signal.aborted)setError((e as Error).message)}finally{gate.current=false;setBusy(false)}}
 async function findMatches(only?:string){if(gate.current)return;gate.current=true;setMatching(true);setError('');const abort=new AbortController();controller.current=abort;const targets=only?rows.filter(r=>r.track.id===only):rows.filter(r=>r.selected&&!r.matches.length);try{for(let i=0;i<targets.length;i++){if(abort.signal.aborted)break;const track=targets[i].track;setPhase(`Matching ${i+1} of ${targets.length}: ${track.title}`);try{const d=await json('/api/downloads/match',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({trackId:track.id}),signal:abort.signal});if(abort.signal.aborted)break;setRows(old=>old.map(r=>r.track.id===track.id?{...r,matches:d.matches,chosen:d.matches[0]?.id||'',error:d.matches.length?'':'No matching videos found.'}:r))}catch(e){if(abort.signal.aborted)break;setRows(old=>old.map(r=>r.track.id===track.id?{...r,error:(e as Error).message}:r))}}}finally{gate.current=false;setMatching(false);setPhase('')}}
 async function retryImport(){if(!job||gate.current)return;gate.current=true;setBusy(true);setError('');setErrorKind('job');try{const d=await json('/api/downloads/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'retry-import',id:job.id})});setJob(d);setJobRetry(v=>v+1)}catch(e){setError((e as Error).message)}finally{gate.current=false;setBusy(false)}}
 async function controlJob(action:'cancel'|'resume'){
  if(!job||gate.current)return;gate.current=true;setBusy(true);setError('');setErrorKind('job');
  try{const d=await json('/api/downloads/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,id:job.id})});setJob(d);setJobRetry(v=>v+1)}catch(e){setError((e as Error).message)}finally{gate.current=false;setBusy(false)}
 }
 async function openRekordbox(){
  if(!job||gate.current)return;gate.current=true;setBusy(true);setError('');setErrorKind('job');
  try{await json('/api/downloads/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'open-rekordbox',id:job.id})});setLaunchNotice('Rekordbox opened.')}catch(e){setError((e as Error).message)}finally{gate.current=false;setBusy(false)}
 }
 async function showFolder(){if(!job)return;try{await json('/api/downloads/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reveal',id:job.id})})}catch(e){setErrorKind('job');setError((e as Error).message)}}
 async function download(){if(gate.current)return;gate.current=true;setBusy(true);setError('');setErrorKind('download');try{const tracks=rows.filter(r=>r.selected&&r.chosen).map(r=>({videoId:r.chosen,spotifyTrackId:r.track.id,title:r.track.title,artist:r.track.artist,album:r.track.album}));const sourcePlaylist=activePlaylist?{id:activePlaylist.id,name:activePlaylist.name}:null;const fingerprint=JSON.stringify({tracks,sourcePlaylist});if(submission.current?.fingerprint!==fingerprint){try{submission.current=JSON.parse(sessionStorage.getItem(`crate-download-request:${owner}`)||'null')}catch{}if(submission.current?.fingerprint!==fingerprint)submission.current={fingerprint,key:crypto.randomUUID()}}try{sessionStorage.setItem(`crate-download-request:${owner}`,JSON.stringify(submission.current))}catch{}const d=await json('/api/downloads/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tracks,sourcePlaylist,requestKey:submission.current.key})});submission.current=null;try{sessionStorage.removeItem(`crate-download-request:${owner}`)}catch{}setJob(d);setDestination(d.outputFolder||'');setJobId(d.id);try{localStorage.setItem(`crate-download-job:${owner}`,d.id)}catch{}}catch(e){setError((e as Error).message)}finally{gate.current=false;setBusy(false)}}
 useEffect(()=>{if(!owner||!hydrated)return;const persist=()=>{try{localStorage.setItem(`crate-download-workspace:${owner}`,JSON.stringify({version:1,selected,rows,warnings,library,showSources,nextOffset,query}));}catch{setStorageError('Browser storage is full or unavailable. This review cannot be restored after leaving the page.')}};const timer=setTimeout(persist,250);window.addEventListener('pagehide',persist);return()=>{clearTimeout(timer);window.removeEventListener('pagehide',persist);persist()}},[owner,hydrated,selected,rows,warnings,library,showSources,nextOffset,query]);
 function retryError(){if(errorKind==='job'){setError('');setJobRetry(v=>v+1)}else if(errorKind==='download')void download();else if(errorKind==='sources')void loadSources(sourceRequest.current.offset,sourceRequest.current.playlistIds);else if(errorKind==='session')window.location.reload();else void playlists()}
 const retryLabel={job:'Refresh job status',download:'Retry conversion',sources:'Retry loading songs',session:'Retry sign-in check',playlists:'Retry loading playlists'}[errorKind];
 const count=rows.filter(r=>r.selected&&r.chosen).length,working=!!job&&activeJobStates.includes(job.status);
 const selectedCount=rows.filter(r=>r.selected).length;
 const pendingCount=rows.filter(r=>r.selected&&!r.matches.length).length;
 const activePlaylist=library.find(p=>selected.includes(p.id));
 const visiblePlaylists=library.filter(p=>p.name.toLowerCase().includes(query.toLowerCase()));
 const locked=busy||matching||!!working;
 return <div className="crate-app theme-basement"><AppHeader active="downloads"/>
 <main className={`${styles.workspace} downloads-page`}>
 {signedIn===false?<section className="download-content"><h1>Downloads</h1><p>Sign in to choose a playlist from your Spotify library.</p><a className="export-primary" href="/api/auth/spotify/login">Sign in with Spotify</a></section>:<>
 <aside className={`download-sources ${showSources?'sources-open':''}`} aria-label="Playlist library">
  <div className="download-source-heading"><ListMusic size={21}/><h2>Your library</h2><button className="mobile-library-close" onClick={()=>setShowSources(false)}>Done</button></div>
  <div className="playlist-filter"><label className="sr-only" htmlFor="playlist-filter">Search playlists</label><input id="playlist-filter" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search playlists"/></div>
  <div className="download-playlists" aria-busy={busy}>
   {visiblePlaylists.map(p=><button key={p.id} className="playlist-choice" aria-pressed={selected.includes(p.id)} disabled={locked} onClick={()=>loadSources(0,[p.id])}><Cover key={p.image} src={p.image}/><span className="playlist-choice-copy"><strong>{p.name}</strong><small>{p.count===null?'Spotify playlist':`${p.count} tracks`}</small></span><span className="playlist-choice-check">{selected.includes(p.id)&&<Check size={17}/>}</span></button>)}
   {!visiblePlaylists.length&&<p className="library-empty" role="status">{signedIn===null||busy?'Loading your library…':query?'No playlists match your search.':'No playlists found in your library.'}</p>}
  </div>
  {cursor&&<button className="library-more" disabled={locked} onClick={()=>playlists(true)}>Load more playlists</button>}
  <p className="library-help">Choose a playlist to load its songs.</p>
 </aside>
 <section className={`download-content ${job?'has-job':''}`} aria-label="Playlist downloads" aria-busy={busy}>
  <div className="download-content-top"><span><Download size={16}/>Downloads</span><button className="mobile-library-toggle" onClick={()=>setShowSources(v=>!v)} disabled={locked} aria-expanded={showSources}>{showSources?'Hide library':'Change playlist'}</button></div>
  <div className="download-playlist-header"><Cover key={activePlaylist?.image} src={activePlaylist?.image} className="selected-playlist-cover"/><div><h1>{activePlaylist?.name||'Your next set.'}</h1><p>{activePlaylist?`${rows.length} loaded tracks · Spotify playlist`:'Choose a playlist from your library to get started.'}</p><p className="downloads-description">Review YouTube versions. Download your selection as MP3s.</p></div></div>
  {localDownloads&&destination&&<p className="download-destination">Save to <span>{destination}</span> <Link href="/settings">Change folder</Link></p>}
  {localDownloads&&autoImport&&activePlaylist&&<RekordboxDestination source={{id:activePlaylist.id,name:activePlaylist.name}} onBlocked={setDestinationBlocked} disabled={working}/>}
  {job&&<section className="download-job" aria-label="Download progress">
   <h2>{job.status==='cancelled'?'Stopped · saved files kept':job.status==='stopping'?'Stopping safely':job.status==='paused'?'Download paused':job.status==='partial'?'Some tracks need attention':job.status==='waiting-drive'?'Waiting for your drive':job.status==='recovering'?'Resuming your download':job.status==='waiting'?'Waiting to add to Rekordbox':job.status==='importing'?'Adding to Rekordbox':job.rekordbox?.status==='imported'?'Added to Rekordbox':job.status==='needs-destination'?'Choose a Rekordbox playlist':job.status==='import-failed'?'MP3s saved · import needs attention':working?'Downloading MP3s':job.delivery==='legacy-zip'?'Previous download':job.status==='done'?'MP3s saved':job.status==='partial'?'Some MP3s saved':'Download failed'}</h2>
   {job.sourcePlaylist&&<p className="job-source">Source: {job.sourcePlaylist.name}</p>}
   {job.rekordbox?.destination&&<p className="job-destination">Rekordbox: {job.rekordbox.destination.path||job.rekordbox.destination.name} · {job.rekordbox.destination.mode==='create'?'Create on import':'Mapped'}</p>}
   <p className="job-count" role="status">{job.completed} of {job.total} {job.delivery==='legacy-zip'?'tracks converted':'MP3s saved'}</p>
   {job.autoImport&&<p className="job-count">{job.imported||0} / {job.completed} added to Rekordbox</p>}
   {job.message&&<p role="status">{job.message}</p>}
   {job.rekordbox?.error&&job.rekordbox.error!==job.message&&!['cancelled','stopping'].includes(job.status)&&<p role="status">{job.rekordbox.error}</p>}
   {working&&job.nextRetryAt&&<p>Checks again automatically within 2 minutes.</p>}
   {working&&<button onClick={()=>controlJob('cancel')} disabled={busy||job.status==='stopping'}>{job.status==='stopping'?'Stopping…':'Stop download & import'}</button>}
   {!working&&job.delivery==='folder'&&(['cancelled','paused'].includes(job.status)||(['partial','failed','import-failed'].includes(job.status)&&job.tracks?.some(t=>t.state!=='saved')))&&<button className="export-primary" onClick={()=>controlJob('resume')} disabled={busy}>Resume{job.tracks?.some(t=>t.state!=='saved')?' remaining tracks':' saved tracks'}</button>}
   {working&&!['waiting','waiting-drive','stopping'].includes(job.status)&&<progress max={job.total||1} value={job.completed} aria-label="MP3s saved"/>}
   {job.current&&<p role="status"><LoaderCircle size={14} className="spin"/>{job.current}</p>}
   {job.delivery==='folder'&&job.completed>0&&<div className="job-file-actions">{!working&&<button className={job.rekordbox?.status==='imported'?'export-primary':undefined} onClick={openRekordbox} disabled={busy}>Open Rekordbox</button>}<button onClick={showFolder} disabled={busy}>Show in Finder</button></div>}
   {launchNotice&&<p role="status">{launchNotice}</p>}
   {job.rekordbox?.status==='imported'&&<p className="job-analysis-note">Ready in your Rekordbox playlist. Waveforms, BPM and key appear after Rekordbox analyzes the tracks.</p>}
   {!working&&!['cancelled','paused'].includes(job.status)&&job.completed>0&&job.sourcePlaylist&&job.rekordbox?.status!=='imported'&&<button onClick={retryImport} disabled={busy}>{job.autoImport?'Retry Rekordbox import':'Add to Rekordbox'}</button>}
   {job.delivery==='legacy-zip'&&<p>Your previous ZIP job is unchanged. New downloads save MP3s directly to your folder.</p>}
   {!!job.tracks?.length&&<details className="job-track-details" open={working||job.tracks.some(t=>t.error||t.importError)||undefined}><summary>Track details <span>{job.total}</span></summary><ul className="download-job-tracks">{job.tracks.map((t,i)=><li key={`${t.videoId}-${i}`}><span><strong>{t.title}</strong><small>{t.artist}</small></span><span>{t.importState==='imported'?'Added to Rekordbox':t.importState==='waiting'?(job.status==='cancelled'?'Saved':'Saved · waiting'):t.importState==='importing'?(job.status==='cancelled'?'Saved':'Adding to Rekordbox…'):t.state==='saved'?(t.reused?'Already downloaded':'Saved'):t.state==='failed'?'Failed':t.state==='cancelled'?'Stopped':t.state==='queued'?'Queued':t.state==='tagging'?'Writing tags…':t.state==='verifying'?'Verifying…':'Downloading…'}</span>{(t.error||t.importError)&&<p className="download-error">{t.error||t.importError}</p>}</li>)}</ul></details>}
   {job.failures.filter(f=>!job.tracks?.some(t=>t.error&&f.endsWith(t.error))).map((f,i)=><p className="download-error" key={i}>{f}</p>)}
  </section>}
  {!localDownloads&&<p className="download-note" role="status">MP3 conversion and YouTube matching run in the local app on your computer. Open your local Crate Digger app to use Downloads; Spotify discovery and playlist saving are available here.</p>}{busy&&<p className="download-loading" role="status"><LoaderCircle size={16} className="spin"/>Loading…</p>}
  {warnings.map((w,i)=><p className="download-note" key={i}>{w}</p>)}
  {rows.length>0?<section className="download-matches" aria-label="Track matches">
   <div className="download-batch-bar" aria-label="Track selection and actions">
    <label className="select-all-tracks"><input type="checkbox" checked={selectedCount===rows.length} ref={input=>{if(input)input.indeterminate=selectedCount>0&&selectedCount<rows.length}} disabled={locked} onChange={e=>{const checked=e.target.checked;setRows(old=>old.map(r=>({...r,selected:checked})))}}/>Select all<span role="status">{selectedCount} / {rows.length}</span></label>
    <div className="download-selection-actions">
     <button className={pendingCount||!count?'export-primary':'match-all'} disabled={!localDownloads||busy||!!working||(!matching&&!pendingCount)} onClick={()=>matching?controller.current?.abort():findMatches()}>{matching?'Stop matching':pendingCount?`Find YouTube matches (${pendingCount})`:'Find YouTube matches'}</button>
     {count>0&&<button className={pendingCount?'match-all':'export-primary'} disabled={locked||!localDownloads||(autoImport&&destinationBlocked)} onClick={download}><Download size={17}/>{working?'Download in progress…':autoImport?`Download & add to Rekordbox (${count})`:`Download ${count} ${count===1?'MP3':'MP3s'}`} </button>}
    </div>
   </div>
   {phase&&<p className="download-loading" role="status"><LoaderCircle size={16} className="spin"/>{phase}</p>}
   <div className="download-column-head" aria-hidden="true"><span>Title</span><span>YouTube version</span></div>
   <ul>{rows.map(r=>{const video=r.matches.find(v=>v.id===r.chosen);return <li key={r.track.id} className={r.selected?'track-selected':''}>
    <div className="download-track-heading"><label className="track-select-target"><input type="checkbox" aria-label={`Select ${r.track.title}`} disabled={locked} checked={r.selected} onChange={e=>setRows(old=>old.map(row=>row.track.id===r.track.id?{...row,selected:e.target.checked}:row))}/></label><Cover key={r.track.artworkUrl} src={r.track.artworkUrl} className="track-artwork"/><div><strong>{r.track.title}</strong><p>{r.track.artist} · <span>{duration(r.track.durationMs/1000)}</span></p></div><button className={r.matches.length?'retry-match-icon':undefined} disabled={locked||!localDownloads} aria-label={r.matches.length?`Retry matching ${r.track.title}`:undefined} title={r.matches.length?'Retry match':undefined} onClick={()=>findMatches(r.track.id)}>{r.matches.length?<RotateCcw size={17}/>:'Find match'}</button></div>
    {r.matches.length>0&&<div className="download-video"><select aria-label={`YouTube version for ${r.track.title}`} value={r.chosen} disabled={locked} onChange={e=>setRows(old=>old.map(row=>row.track.id===r.track.id?{...row,chosen:e.target.value,selected:false}:row))}>{r.matches.map(v=><option key={v.id} value={v.id}>{v.title} · {duration(v.duration)} · {v.channel}</option>)}</select>{video&&<div className="match-review-row"><span className={`match-confidence ${video.score>=.8?'likely':''}`}>{video.score>=.8?'Likely match':'Needs review'}</span><a href={video.url} target="_blank" rel="noopener noreferrer">Review on YouTube <ExternalLink size={13}/></a></div>}</div>}
    {r.error&&<p className="download-error" role="status">{r.error}</p>}
   </li>})}</ul>
   {nextOffset!==null&&<button className="library-more" disabled={locked} onClick={()=>loadSources(nextOffset)}>Load next 50 songs</button>}
  </section>:!busy&&signedIn!==null&&<div className="download-empty"><ListMusic size={36}/><h2>{activePlaylist?'No songs to review':'Start with your library'}</h2><p>{activePlaylist?'Choose another playlist to find songs.':'Select a Spotify playlist. Your songs will appear here, ready to match.'}</p>{activePlaylist&&<button onClick={()=>loadSources()}>Reload playlist songs</button>}</div>}

 </section></>}
 {storageError&&<p className="download-error workspace-error" role="status">{storageError}</p>}{error&&<div className="error workspace-error" role="alert">{error}<button onClick={retryError}>{retryLabel}</button></div>}
 </main></div>
}
