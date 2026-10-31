import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createTextStore} from './text-store.ts';
import {spotifyRetryDetails} from './spotify-retry-message.ts';
const snapshotRevision=(value:any)=>createHash('sha256').update(JSON.stringify((Array.isArray(value?.items)?value.items:[]).map((item:any)=>[item?.id,item?.title,item?.artist,item?.durationMs]))).digest('hex');
const snapshotComplete=(value:any)=>!value?.nextCursor&&!(Array.isArray(value?.warnings)&&value.warnings.some((warning:unknown)=>typeof warning==='string'&&/first 500|truncated/i.test(warning)));
export async function savedSpotify<T>(owner:string,key:string,load:()=>Promise<T>,refresh=false){
 const store=createTextStore(join(process.cwd(),'.data/saved-spotify'),'saved-spotify'),name=createHash('sha256').update(owner+':'+key).digest('hex')+'.json';
 const raw=await store.read(name);let saved:any=null;try{saved=raw?JSON.parse(raw):null;if(saved&&(!saved.value||!Number.isFinite(saved.at)))saved=null}catch{}
 if(saved&&!refresh&&!saved.value.requiresRefresh)return {...saved.value,saved:true,savedAt:saved.at,revision:saved.revision||snapshotRevision(saved.value),complete:saved.complete??snapshotComplete(saved.value)};
 try{const value=await load(),at=Date.now(),revision=snapshotRevision(value),complete=snapshotComplete(value);await store.write(name,JSON.stringify({at,value,revision,complete}));return {...value,saved:false,savedAt:at,revision,complete}}
 catch(e){if(saved&&(e as {status?:number}).status!==401){const error=e as {message?:string;status?:number;retryAfter?:string};const retry=spotifyRetryDetails(error.message||'',error.status||0,error.retryAfter);return {...saved.value,saved:true,savedAt:saved.at,revision:saved.revision||snapshotRevision(saved.value),complete:saved.complete??snapshotComplete(saved.value),notice:retry.retryAt?`Using your saved version. ${retry.error}`:'Spotify could not refresh this playlist. Using your saved version.',retryAt:retry.retryAt}}throw e}
}

/** Apply confirmed writes to durable offline snapshots without another provider read. */
export async function syncSavedPlaylist(owner:string,playlist:any,tracks:any[]){
 const store=createTextStore(join(process.cwd(),'.data/saved-spotify'),'saved-spotify');
 const patch=async(key:string,update:(value:any)=>any)=>{const name=createHash('sha256').update(owner+':'+key).digest('hex')+'.json';const raw=await store.read(name);if(!raw)return;let saved:any;try{saved=JSON.parse(raw);if(!saved?.value||!Number.isFinite(saved.at))return}catch{return}const value=update(saved.value);await store.write(name,JSON.stringify({...saved,value,revision:snapshotRevision(value),complete:snapshotComplete(value)}))};
 for(let offset=0;offset<=1000;offset+=50)await patch(`library:${offset}`,value=>({...value,items:(value.items||[]).some((p:any)=>p.id===playlist.id)?value.items.map((p:any)=>p.id===playlist.id?{...p,...playlist}:p):offset===0?[playlist,...(value.items||[])]:value.items}));
 await patch('songs:'+playlist.id,value=>{const items=[...(value.items||[])];for(const track of tracks)if(!items.some((t:any)=>t.id===track.id))items.push(track);return {...value,items,seedCount:items.length,requiresRefresh:items.length<playlist.count}});
}
