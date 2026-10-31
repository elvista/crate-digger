import type {Playlist} from './discovery-types';
export type PlaylistCountUpdate={playlistId:string;count:number;at:number;playlist?:Playlist;owner:string;tracks?:import('./catalog').Track[]};
const eventName='crate:playlist-count-updated';
const storagePrefix='crate-playlist-count-update:';
const freshness=60_000;
const recent=new Map<string,PlaylistCountUpdate>();
const libraryRefreshes=new Map<string,Promise<any>>();
const lastLibraryRefreshes=new Map<string,any>();
export function rememberPlaylistCount(value:unknown):PlaylistCountUpdate|null{
 const update=value as PlaylistCountUpdate;
 if(!update||typeof update.owner!=='string'||!update.owner||!/^[A-Za-z0-9]{22}$/.test(update.playlistId)||!Number.isSafeInteger(update.count)||update.count<0||!Number.isFinite(update.at)||Math.abs(Date.now()-update.at)>86_400_000)return null;
 const key=`${update.owner}:${update.playlistId}`;
 if((recent.get(key)?.at??-Infinity)>update.at)return null;
 recent.set(key,update);return update;
}
/** Short-lived confirmed writes bridge Spotify's list-cache delay. */
export function withPlaylistCounts<T extends Pick<Playlist,'id'|'count'>>(items:T[],owner:string,now=Date.now()):T[]{
 return items.map(item=>{const update=recent.get(`${owner}:${item.id}`);return update&&now-update.at>=-5000&&now-update.at<freshness?{...item,count:update.count}:item});
}
export function publishPlaylistCount(playlistId:string,count:unknown,playlist:Playlist|undefined,owner:string,tracks:import('./catalog').Track[]=[]){
 const update=rememberPlaylistCount({playlistId,count,at:Date.now(),...(playlist?{playlist}:{}),owner,tracks});
 if(!update||typeof window==='undefined')return;
 if(playlist)syncBrowserPlaylist(owner,playlist,tracks);
 window.dispatchEvent(new CustomEvent(eventName,{detail:update}));
 try{localStorage.setItem(storagePrefix+owner,JSON.stringify(update))}catch{}
}
export function subscribePlaylistCounts(owner:string,onUpdate:(update:PlaylistCountUpdate)=>void){
 const receive=(value:unknown)=>{if(!owner)return;const update=rememberPlaylistCount(value);if(update?.owner!==owner)return;if(update.playlist)syncBrowserPlaylist(owner,update.playlist,update.tracks);if(Date.now()-update.at>=-5000&&Date.now()-update.at<freshness)onUpdate(update)};
 const local=(event:Event)=>receive((event as CustomEvent).detail);
 const remote=(event:StorageEvent)=>{if(event.key===storagePrefix+owner&&event.newValue)try{receive(JSON.parse(event.newValue))}catch{}};
 window.addEventListener(eventName,local);window.addEventListener('storage',remote);
 try{const saved=localStorage.getItem(storagePrefix+owner);if(saved)receive(JSON.parse(saved))}catch{}
 return()=>{window.removeEventListener(eventName,local);window.removeEventListener('storage',remote)};
}

export function syncBrowserPlaylist(owner:string,playlist:Playlist,tracks:import('./catalog').Track[]=[]){
 if(typeof localStorage==='undefined'||typeof localStorage.key!=='function')return;
 const keys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter((key):key is string=>!!key&&(key===`crate-saved-library:${owner}`||key===`crate-download-workspace:${owner}`||key.startsWith(`crate-saved-songs:${owner}:${playlist.id}:`)));
 for(const key of keys)try{const value=JSON.parse(localStorage.getItem(key)||'null');if(!value)continue;value.library=(value.library||[]).map((p:Playlist)=>p.id===playlist.id?{...p,...playlist}:p);if(!value.library.some((p:Playlist)=>p.id===playlist.id))value.library.unshift(playlist);
 if((key===`crate-download-workspace:${owner}`&&value.selected?.[0]===playlist.id)||key===`crate-saved-songs:${owner}:${playlist.id}:0`){for(const track of tracks)if(!value.rows?.some((r:any)=>r.track.id===track.id)){value.rows??=[];value.rows.push({track,matches:[],chosen:'',selected:false,error:''})}}
 if(key.startsWith(`crate-saved-songs:${owner}:${playlist.id}:`)&&key!==`crate-saved-songs:${owner}:${playlist.id}:0`){localStorage.removeItem(key);continue}
 localStorage.setItem(key,JSON.stringify(value));}catch{}
}
/** Coalesce a complete library refresh across mounted views and navigation. */
export async function refreshBrowserLibrary(owner:string){
 if(!owner)return null;const key=`crate-library-synced:${owner}`,cooldownKey=`crate-library-next-refresh:${owner}`;const active=libraryRefreshes.get(owner);if(active)return active;
 try{if(Date.now()<Number(localStorage.getItem(cooldownKey)||0)||Date.now()-Number(localStorage.getItem(key)||0)<600000)return lastLibraryRefreshes.get(owner)||null}catch{}
 const flight=(async()=>{let cursor:string|null='0',items:Playlist[]=[],saved=false,notice='',retryAt=0;for(let page=0;cursor!==null&&page<21;page++){
  const response:Response=await fetch(`/api/playlists?cursor=${cursor}&refresh=1`,{cache:'no-store'});const data:{items?:Playlist[];saved?:boolean;notice?:string;nextCursor?:string|null;retryAt?:number;error?:string}=await response.json();if(!response.ok)throw new Error(data.error||'Could not refresh playlists.');items.push(...(Array.isArray(data.items)?data.items:[]));saved=saved||!!data.saved;notice ||= data.notice||'';retryAt=Math.max(retryAt,Number(data.retryAt)||0);cursor=typeof data.nextCursor==='string'?data.nextCursor:null;
  // A provider cooldown can return saved pages. Preserve any known later pages.
  if(data.saved)break;
 }
 const complete=cursor===null&&!saved;items=[...new Map(items.map(p=>[p.id,p])).values()];if(complete){try{localStorage.setItem(key,String(Date.now()));localStorage.setItem(`crate-saved-library:${owner}`,JSON.stringify({version:1,selected:[],rows:[],library:items,warnings:[],showSources:true,nextOffset:null,query:''}))}catch{}for(const playlist of items)syncBrowserPlaylist(owner,playlist)}if(saved)try{localStorage.setItem(cooldownKey,String(Math.max(Date.now()+600000,retryAt)))}catch{}const result={items,saved,notice,complete,nextCursor:cursor};lastLibraryRefreshes.set(owner,result);return result})();
 libraryRefreshes.set(owner,flight);try{return await flight}finally{if(libraryRefreshes.get(owner)===flight)libraryRefreshes.delete(owner)}
}
