'use client';
import {Search} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import type {DestinationResolution,LibraryPlaylists,SourcePlaylist} from '@/lib/rekordbox-destinations';
import styles from './RekordboxDestination.module.css';
type Result={library:LibraryPlaylists;resolution:DestinationResolution};
export default function RekordboxDestination({source,onBlocked,disabled=false}:{source:SourcePlaylist;onBlocked:(value:boolean)=>void;disabled?:boolean}){
 const generation=useRef(0);
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false),[choice,setChoice]=useState(''),[name,setName]=useState(source.name),[query,setQuery]=useState('');
 useEffect(()=>{
  const token=++generation.current;const abort=new AbortController();setBusy(true);setResult(null);setError('');setEditing(false);setChoice('');setQuery('');setName(source.name);onBlocked(true);
  fetch('/api/rekordbox/destination',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'resolve',source}),signal:abort.signal}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(abort.signal.aborted)return;setResult(d);onBlocked(d.resolution.status==='choose');if(d.resolution.suggestedName)setName(d.resolution.suggestedName)}).catch(e=>{if(!abort.signal.aborted){setError(e.message);onBlocked(false)}}).finally(()=>{if(!abort.signal.aborted)setBusy(false)});
  return()=>{abort.abort();if(generation.current===token)generation.current++};
 },[source.id,source.name,onBlocked]);
 async function save(){
  const token=generation.current;
  setBusy(true);setError('');onBlocked(true);
  try{const destination=choice==='new'?{mode:'create',name}:{mode:'existing',id:choice};
   const r=await fetch('/api/rekordbox/destination',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'choose',source,destination})});const d=await r.json();if(!r.ok)throw new Error(d.error);if(token!==generation.current)return;setResult(d);setEditing(false);onBlocked(false);
  }catch(e){if(token===generation.current){setError((e as Error).message);onBlocked(result?.resolution.status==='choose')}}
  finally{if(token===generation.current)setBusy(false)}
 }
 const resolution=result?.resolution,needsChoice=resolution?.status==='choose';
 const options=result?.library.playlists.filter(p=>p.attribute===0&&p.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()))||[];
 return <section className={styles.panel} aria-label="Rekordbox playlist destination">
 <div className={styles.summary}><span>Rekordbox playlist</span>{!editing&&<strong>{busy?'Checking…':resolution?.status==='ready'?resolution.destination.mode==='existing'?resolution.destination.path:resolution.destination.name:needsChoice?'Choose a destination':'Not connected'}</strong>}{resolution?.status==='ready'&&!editing&&<><small>{resolution.destination.mode==='create'?'Will be created on import':'Saved destination'}</small><button onClick={()=>{setEditing(!editing);setChoice(resolution.destination.mode==='existing'?resolution.destination.id:'new');setName(resolution.destination.name)}} disabled={busy||disabled} aria-expanded={editing}>Change</button></>}</div>
 {(needsChoice||editing)&&<div className={styles.chooser}>
  {needsChoice&&<p>{resolution.reason==='ambiguous'?'Several playlists share this name. Choose the correct folder.':resolution.reason==='intelligent'?'This name belongs to an intelligent playlist. Choose an ordinary playlist or create one.':'Your saved destination is no longer available. Choose another playlist.'}</p>}
  <label className={styles.search} htmlFor="rekordbox-playlist-filter"><Search size={16} aria-hidden="true"/><span className="sr-only">Find a Rekordbox playlist</span><input id="rekordbox-playlist-filter" type="search" value={query} onChange={e=>{setQuery(e.target.value);setChoice('')}} placeholder="Search playlists or folders" disabled={busy||disabled}/></label>
  <div className={styles.field}><label htmlFor="rekordbox-playlist-choice">Destination</label><select id="rekordbox-playlist-choice" value={choice} onChange={e=>setChoice(e.target.value)} disabled={busy||disabled}><option value="">Choose a playlist…</option><option value="new">Create a new playlist on import</option>{options.map(p=><option key={p.id} value={p.id}>{p.path}</option>)}</select></div>
  {choice==='new'&&<div className={styles.field}><label htmlFor="rekordbox-new-playlist">New playlist name</label><input id="rekordbox-new-playlist" value={name} onChange={e=>setName(e.target.value)} maxLength={299} disabled={busy||disabled}/></div>}
  <div className={styles.actions}><button className={styles.save} disabled={busy||disabled||!choice||(choice==='new'&&!name.trim())} onClick={save}>{busy?'Saving…':'Use this playlist'}</button>{editing&&!needsChoice&&<button onClick={()=>setEditing(false)} disabled={busy||disabled}>Cancel</button>}</div>
 </div>}
 {error&&<p role="status" className={styles.error}>{error} MP3s can still download; connect Rekordbox before importing.</p>}
 <p className={styles.note}>Downloaded tracks will be added here when Rekordbox and its background agent are closed.</p>
 </section>;
}
