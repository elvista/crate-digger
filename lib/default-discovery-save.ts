import type {Track} from './catalog';
import {saveRekordboxTrack,spotifyUriForTrack} from './rekordbox-save-client.ts';
// Recommendations resolve to Spotify recordings even when their seeds are local.
// Route by the displayed recording so draft source changes cannot redirect saves.
export function discoverySaveService(track:Pick<Track,'id'>|null|undefined):'spotify'|'rekordbox'{
 return track?.id.startsWith('rekordbox:')?'rekordbox':'spotify';
}
export async function saveDefaultDiscoveryTrack(service:'spotify'|'rekordbox',track:Track,operationId:string,progress:(message:string)=>void,live=()=>true){
 if(service==='rekordbox'){await saveRekordboxTrack(track,null,operationId,progress,live);return {service,added:true} as const}
 const uri=await spotifyUriForTrack(track);
 const response=await fetch('/api/playlist-export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId,mode:'finds',uris:[uri],tracks:track.id.startsWith('spotify:')?[track]:[]})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Spotify could not save this song.');return {...result,service};
}
