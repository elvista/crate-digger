import type {Playlist} from './discovery-types';
export type PlaylistCountUpdate={playlistId:string;count:number;at:number;playlist?:Playlist};
const eventName='crate:playlist-count-updated';
const storageKey='crate-playlist-count-update';
const freshness=60_000;
const recent=new Map<string,PlaylistCountUpdate>();
export function rememberPlaylistCount(value:unknown):PlaylistCountUpdate|null{
 const update=value as PlaylistCountUpdate;
 if(!update||!/^[A-Za-z0-9]{22}$/.test(update.playlistId)||!Number.isSafeInteger(update.count)||update.count<0||!Number.isFinite(update.at))return null;
 if((recent.get(update.playlistId)?.at??-Infinity)>update.at)return null;
 recent.set(update.playlistId,update);return update;
}
/** Short-lived confirmed writes bridge Spotify's list-cache delay. */
export function withPlaylistCounts<T extends Pick<Playlist,'id'|'count'>>(items:T[],now=Date.now()):T[]{
 return items.map(item=>{const update=recent.get(item.id);return update&&now-update.at>=-5000&&now-update.at<freshness?{...item,count:update.count}:item});
}
export function publishPlaylistCount(playlistId:string,count:unknown,playlist?:Playlist){
 const update=rememberPlaylistCount({playlistId,count,at:Date.now(),...(playlist?{playlist}:{})});
 if(!update||typeof window==='undefined')return;
 window.dispatchEvent(new CustomEvent(eventName,{detail:update}));
 try{localStorage.setItem(storageKey,JSON.stringify(update))}catch{}
}
export function subscribePlaylistCounts(onUpdate:(update:PlaylistCountUpdate)=>void){
 const receive=(value:unknown)=>{const update=rememberPlaylistCount(value);if(update&&Date.now()-update.at>=-5000&&Date.now()-update.at<freshness)onUpdate(update)};
 const local=(event:Event)=>receive((event as CustomEvent).detail);
 const remote=(event:StorageEvent)=>{if(event.key===storageKey&&event.newValue)try{receive(JSON.parse(event.newValue))}catch{}};
 window.addEventListener(eventName,local);window.addEventListener('storage',remote);
 try{const saved=localStorage.getItem(storageKey);if(saved)receive(JSON.parse(saved))}catch{}
 return()=>{window.removeEventListener(eventName,local);window.removeEventListener('storage',remote)};
}
