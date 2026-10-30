'use client';
import {publishPlaylistCount,subscribePlaylistCounts,withPlaylistCounts} from '@/lib/playlist-counts';
import {useEffect,useRef,useState} from 'react';
import {X,ListMusic,Plus,LoaderCircle} from 'lucide-react';
import type {Track} from '@/lib/catalog';
import type {Playlist} from '@/lib/discovery-types';
import styles from './QuickPlaylistPicker.module.css';
import {playlistFocusIndex} from '@/lib/playlist-keyboard';

export default function QuickPlaylistPicker({track,owner,authorized,onClose,onSaved}:{track:Track;owner:string;authorized:boolean;onClose:()=>void;onSaved:(message:string)=>void}){
 const [items,setItems]=useState<Playlist[]>([]),[recent,setRecent]=useState<string[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(''),[error,setError]=useState('');
 const close=useRef<HTMLButtonElement>(null),mounted=useRef(true),gate=useRef(false),operations=useRef(new Map<string,string>());
 const storageKey=`crate-recent-playlist-destinations:${owner}`;
 useEffect(()=>{mounted.current=true;const previous=document.activeElement as HTMLElement;close.current?.focus();try{const stored=JSON.parse(localStorage.getItem(storageKey)||'[]');if(Array.isArray(stored))setRecent(stored.filter((id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9]{22}$/.test(id)).slice(0,12))}catch{}return()=>{mounted.current=false;previous?.focus()}},[storageKey]);
 useEffect(()=>subscribePlaylistCounts(()=>setItems(old=>withPlaylistCounts(old))),[]);
 async function load(append=false){if(gate.current)return;gate.current=true;setLoading(true);setError('');try{const r=await fetch(`/api/playlist-export${append&&cursor?`?cursor=${cursor}`:''}`,{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not load playlists.');if(mounted.current){setItems(old=>[...new Map([...(append?old:[]),...withPlaylistCounts<Playlist>(data.items)].map((p:Playlist)=>[p.id,p])).values()]);setCursor(data.nextCursor)}}catch(e){if(mounted.current)setError((e as Error).message)}finally{gate.current=false;if(mounted.current)setLoading(false)}}
 useEffect(()=>{if(authorized)void load();else setLoading(false)},[authorized]);
 async function save(playlist:Playlist){if(gate.current)return;gate.current=true;setSaving(playlist.id);setError('');if(!operations.current.has(playlist.id))operations.current.set(playlist.id,crypto.randomUUID());try{const r=await fetch('/api/playlist-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:operations.current.get(playlist.id),mode:'existing',playlistId:playlist.id,uris:[`spotify:track:${track.id.slice(8)}`]})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not save this song.');publishPlaylistCount(data.playlistId,data.count,data.playlist);try{localStorage.setItem(storageKey,JSON.stringify([playlist.id,...recent.filter(id=>id!==playlist.id)].slice(0,12)))}catch{}if(mounted.current)onSaved(data.added?`Added to ${playlist.name}`:`Already in ${playlist.name}`)}catch(e){if(mounted.current)setError(`${(e as Error).message} You can retry; existing songs are skipped.`)}finally{gate.current=false;if(mounted.current)setSaving('')}}
 useEffect(()=>{if(!loading&&items.length)document.querySelector<HTMLButtonElement>('[data-playlist-destination]')?.focus()},[loading,items.length]);
 const ordered=[...items].sort((a,b)=>{const ai=recent.indexOf(a.id),bi=recent.indexOf(b.id);return (ai<0?1000:ai)-(bi<0?1000:bi)});
 return <div className={styles.overlay} onClick={e=>{if(e.target===e.currentTarget&&!saving)onClose()}}><section className={styles.picker} role="dialog" aria-modal="true" aria-labelledby="quick-playlist-title" onKeyDown={e=>{if(e.key==='Escape'&&!saving){e.preventDefault();e.stopPropagation();onClose();return}if(!saving&&!loading){const destinations=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-playlist-destination]:not(:disabled)')];const index=playlistFocusIndex(e.key,destinations.indexOf(document.activeElement as HTMLButtonElement),destinations.length);if(index!==null){e.preventDefault();e.stopPropagation();destinations[index]?.focus();return}}if(e.key!=='Tab')return;const nodes=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]')];if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1)?.focus()}else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0]?.focus()}}}>
 <div className={styles.heading}><div><h2 id="quick-playlist-title">Add to playlist</h2><p>{track.title} · {track.artist}</p></div><button ref={close} disabled={!!saving} onClick={onClose} aria-label="Close playlist picker"><X size={20}/></button></div>
 {!authorized?<div className={styles.message}><p>Connect playlist saving to add this song to Spotify.</p><a href="/api/auth/spotify/login">Enable playlist saving</a></div>:<>
 <p className={styles.caption}>{recent.some(id=>items.some(p=>p.id===id))?'Recently used playlists first':'Your Spotify playlists'}</p>
 <div className={styles.list} aria-busy={loading||!!saving}>{ordered.map(p=><button className={styles.row} data-playlist-destination key={p.id} disabled={loading||!!saving} onClick={()=>save(p)}><span className={styles.cover}><ListMusic size={23}/>{p.image&&<img src={p.image} alt="" loading="lazy" onError={e=>{e.currentTarget.style.display='none'}}/>}</span><span className={styles.copy}><strong>{p.name}</strong><small>{p.count===null?'Spotify playlist':`${p.count} tracks`}</small></span>{saving===p.id?<LoaderCircle className="spin" size={18}/>:<Plus size={18}/>}</button>)}</div>
 {loading&&<p className={styles.caption} role="status">Loading playlists…</p>}{!loading&&!error&&!items.length&&<p className={styles.caption}>No playlists owned by you on this page. Load more to find a destination.</p>}
 {cursor&&<button className={styles.more} disabled={loading||!!saving} onClick={()=>load(true)}>More playlists</button>}
 {error&&<div className={styles.message} role="alert"><p>{error}</p>{!items.length&&<button disabled={loading} onClick={()=>load()}>Retry loading playlists</button>}</div>}
 <p className={styles.footnote}>↑ ↓ Choose · Enter Add & next · Esc Close. Duplicates are skipped.</p>
 </>}
 </section></div>
}
