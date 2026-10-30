'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {AudioLines,Compass,Download,Settings,LogOut} from 'lucide-react';
type View='discover'|'downloads'|'settings';
export default function AppHeader({active,userName,onSignOut}:{active:View;userName?:string|null;onSignOut?:()=>void}){
 const [remoteName,setRemoteName]=useState<string|null>(null);
 useEffect(()=>{if(userName!==undefined)return;const abort=new AbortController();fetch('/api/auth/spotify/session',{signal:abort.signal,cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.authenticated&&!abort.signal.aborted)setRemoteName(d.user.name)}).catch(()=>{});return()=>abort.abort()},[userName]);
 const name=userName===undefined?remoteName:userName;
 const item=(view:View,label:string,icon:React.ReactNode,href:string)=><Link className={`nav-item ${active===view?'nav-active':''}`} aria-current={active===view?'page':undefined} href={href}>{icon}<span>{label}</span></Link>;
 async function logout(){if(onSignOut){onSignOut();return}const r=await fetch('/api/auth/spotify/logout',{method:'POST'});if(r.ok)window.location.href='/'}
 return <header className="app-header"><Link className="brand" href="/" aria-label="Crate home"><span className="brand-icon"><AudioLines size={22}/></span>crate<span className="brand-period">.</span></Link><nav aria-label="Main navigation">{item('discover','Discover',<Compass size={17}/>,'/')}{item('downloads','Downloads',<Download size={17}/>,'/downloads')}{item('settings','Settings',<Settings size={17}/>,'/settings')}</nav><div className="spotify-account">{name?<><span>{name}</span><button onClick={logout} aria-label="Sign out of Spotify"><LogOut size={16}/><span>Sign out</span></button></>:<span>Discovery with Spotify</span>}</div></header>
}
