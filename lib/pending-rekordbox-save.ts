import type {Track} from './catalog';
export type PendingRekordboxSave={operationId:string;track:Track;createdAt:number};
const prefix='crate-pending-rekordbox-save:';
const key=(owner:string,operationId:string)=>`${prefix}${owner}:${operationId}`;
export function rememberPendingRekordboxSave(owner:string,operationId:string,track:Track){
 if(!owner||!/^[a-f0-9-]{36}$/.test(operationId)||!/^rekordbox:\d+$/.test(track.id))return false;
 const saved:Track={id:track.id,title:track.title.slice(0,300),artist:track.artist.slice(0,300),album:track.album.slice(0,300),genre:'',durationMs:track.durationMs,artworkUrl:track.artworkUrl,sourceUrl:track.sourceUrl,explicit:track.explicit,localLibraryId:track.localLibraryId};
 try{localStorage.setItem(key(owner,operationId),JSON.stringify({operationId,track:saved,createdAt:Date.now()}));return true}catch{return false}
}
export function forgetPendingRekordboxSave(owner:string,operationId:string){try{localStorage.removeItem(key(owner,operationId))}catch{}}
export function pendingRekordboxSaves(owner:string):PendingRekordboxSave[]{
 const entries:PendingRekordboxSave[]=[];
 try{for(let i=0;i<localStorage.length;i++){const name=localStorage.key(i);if(!name?.startsWith(`${prefix}${owner}:`))continue;try{const value=JSON.parse(localStorage.getItem(name)||'null');if(value&&value.operationId===name.slice(`${prefix}${owner}:`.length)&&/^[a-f0-9-]{36}$/.test(value.operationId)&&/^rekordbox:\d+$/.test(value.track?.id)&&typeof value.track.title==='string'&&value.track.title.length<=300&&!/[\x00-\x1f]/.test(value.track.title)&&typeof value.track.artist==='string'&&value.track.artist.length<=300&&!/[\x00-\x1f]/.test(value.track.artist)&&Number.isFinite(value.track.durationMs)&&value.track.durationMs>0&&value.track.durationMs<24*3600000&&Number.isFinite(value.createdAt)&&Date.now()-value.createdAt<24*3600000){const library=typeof value.track.localLibraryId==='string'&&value.track.localLibraryId.length<200?value.track.localLibraryId:'';value.track.sourceUrl=`/api/rekordbox/audio/${value.track.id.slice(10)}?library=${encodeURIComponent(library)}`;value.track.artworkUrl=typeof value.track.artworkUrl==='string'&&/^https:\/\//.test(value.track.artworkUrl)?value.track.artworkUrl:null;entries.push(value)}}catch{}}}catch{}
 return entries.sort((a,b)=>a.createdAt-b.createdAt).slice(0,20);
}
