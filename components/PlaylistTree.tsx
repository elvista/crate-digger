'use client';
import styles from './PlaylistTree.module.css';
import type {Playlist} from '@/lib/discovery-types';
export default function PlaylistTree({items,selected,disabled,onSelect,query=''}:{items:Playlist[];selected:string[];disabled:boolean;onSelect:(p:Playlist)=>void;query?:string}){
 const sorted=[...items].sort((a,b)=>Number(b.attribute===1)-Number(a.attribute===1)||a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true}));
 function node(p:Playlist,seen=new Set<string>()):React.ReactNode{if(seen.has(p.id))return null;const next=new Set([...seen,p.id]);if(p.attribute===1)return <details key={p.id}><summary>{p.name}</summary><div style={{paddingLeft:14,borderLeft:'1px solid var(--rule)'}}>{sorted.filter(c=>c.parentId===p.id).map(c=>node(c,next))}</div></details>;return <button key={p.id} data-playlist-destination aria-pressed={selected.includes(p.id)} disabled={disabled||p.attribute===4} onClick={()=>onSelect(p)} title={p.path||p.name}><span><strong>{query?p.path||p.name:p.name}</strong>{(p.attribute===4||selected.includes(p.id))&&<small>{p.attribute===4?'Smart playlist · read only':'Selected'}</small>}</span></button>}
 const roots=query?sorted.filter(p=>p.attribute!==1&&(p.path||p.name).toLowerCase().includes(query.toLowerCase())):sorted.filter(p=>!items.some(a=>a.id===p.parentId));return <div className={`source-results ${styles.tree}`}>{roots.map(p=>node(p))}</div>
}
