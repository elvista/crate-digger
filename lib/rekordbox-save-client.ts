import type {Track} from './catalog';
import type {Playlist} from './discovery-types';
export async function saveRekordboxTrack(track:Track,playlist:Playlist|null,operationId:string,progress:(message:string)=>void,live=()=>true){
 const r=await fetch('/api/rekordbox/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({track,playlistId:playlist?.id,mode:playlist?'existing':'finds',operationId}),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save to Rekordbox.');
 while(live()){
  const response=await fetch(`/api/downloads/jobs?id=${d.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)}),job=await response.json();if(!response.ok)throw new Error(job.error||'Could not check the library update.');if(!live())break;
  if(job.rekordbox?.status==='imported')return;
  if(['failed','partial','import-failed','needs-destination','cancelled','paused'].includes(job.status))throw new Error(job.rekordbox?.error||job.message||'The playlist update needs attention in Downloads.');
  progress(job.status==='waiting'?'Close Rekordbox and its background agent. Your playlist update will finish automatically.':'Updating Rekordbox playlist…');await new Promise(r=>setTimeout(r,2000));
 }
 throw new Error('The playlist update continues in the background.');
}
export async function spotifyUriForTrack(track:Track){
 if(track.id.startsWith('spotify:'))return `spotify:track:${track.id.slice(8)}`;
 const r=await fetch(`/api/track-search?${new URLSearchParams({q:`track:${track.title} artist:${track.artist}`})}`,{cache:'no-store'}),d=await r.json();if(!r.ok)throw new Error(d.error||'Spotify could not match this recording.');
 const norm=(s:string)=>s.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');const matches=(d.items||[]).filter((t:Track)=>norm(t.title)===norm(track.title)&&norm(t.artist)===norm(track.artist)&&Math.abs(t.durationMs-track.durationMs)<=5000);
 if(!matches.length)throw new Error('No exact Spotify recording was found for this local track.');return `spotify:track:${matches[0].id.slice(8)}`;
}
