import {syncSavedPlaylist} from '@/lib/saved-spotify';
import { createHash } from 'node:crypto';
import {createTextStore,StoreLockedError} from '@/lib/text-store';
import {join} from 'node:path';
import {requireUser,requireOrigin,apiError,noStore} from '@/lib/route-auth';
import {spotifyRequest,SpotifyError} from '@/lib/spotify';
import {hasPlaylistWriteScope} from '@/lib/playback-settings';
import {parseOffset} from '@/lib/spotify-data';
import {normalizePlaylist,object} from '@/lib/discovery-core';
import {parseExport,exportPlaylist,PlaylistExportError,type ExportReceipt} from '@/lib/playlist-export';
export const maxDuration=300;
async function waitForMutationLock(storage:ReturnType<typeof createTextStore>,name:string,signal:AbortSignal){const until=Date.now()+120000;while(true){signal.throwIfAborted();try{return await storage.lock(name)}catch(e){if(!(e instanceof StoreLockedError)||Date.now()>=until)throw e;await new Promise(resolve=>setTimeout(resolve,300))}}}
export async function GET(request:Request){try{
 const user=await requireUser();if(!hasPlaylistWriteScope(user.scope))throw new SpotifyError('Enable playlist saving to choose a destination.',403);
 let offset:number;try{offset=parseOffset(new URL(request.url).searchParams.get('cursor'))}catch{throw new SpotifyError('Invalid playlist cursor.',400)}
 const data=object(await spotifyRequest(`me/playlists?limit=50&offset=${offset}`));if(!Array.isArray(data.items))throw new SpotifyError('Spotify returned an unreadable playlist list.');
 return Response.json({items:data.items.filter(p=>object(object(p).owner).id===user.userId).map(normalizePlaylist).filter(Boolean),nextCursor:data.next&&offset<1000?String(offset+50):null},{headers:noStore});
 }catch(e){return apiError(e)}}
export async function POST(request:Request){const locks:(()=>Promise<void>)[]=[];try{
 requireOrigin(request);const user=await requireUser();if(!hasPlaylistWriteScope(user.scope))throw new SpotifyError('Reconnect Spotify to enable playlist saving.',403);
 const body=await request.text();if(Buffer.byteLength(body)>300000)throw new SpotifyError('Save request is too large.',400);
 let submitted:any;try{submitted=JSON.parse(body)}catch{throw new SpotifyError('Could not read the playlist save request.',400)}let input;try{input=parseExport(submitted)}catch(e){throw new SpotifyError(e instanceof Error?e.message:'Invalid playlist save request.',400)}
 const root=join(process.cwd(),'.data/playlist-exports');const storage=createTextStore(root,'playlist-exports');const owner=createHash('sha256').update(user.userId).digest('hex');
 // Every Spotify playlist mutation for this account uses the same lock. A
 // default Crate Finds save and an explicit save can target the same playlist.
 locks.push(await waitForMutationLock(storage,`${owner}/playlist-mutations`,request.signal));
 const path=`${owner}/${input.operationId}.json`;locks.push(await storage.lock(path));
 const previous=await storage.read(path);const replay=previous?JSON.parse(previous) as ExportReceipt:null;
 const knownFindsId=input.mode==='finds'?await storage.read(`${owner}/finds-playlist-id`):null;
 const result=await exportPlaylist(input,user.userId,(path,options)=>spotifyRequest(path,{...options,fresh:true}),async()=>{const value=await storage.read(path);return value?JSON.parse(value) as ExportReceipt:null},async receipt=>{await storage.write(path,JSON.stringify(receipt))},knownFindsId??undefined);
 let refreshPending=false;const repairPath=`${owner}/repair/${input.operationId}.json`;
 try{
  if(input.mode==='finds')await storage.write(`${owner}/finds-playlist-id`,result.playlistId);
  const tracks=(Array.isArray(submitted.tracks)?submitted.tracks:[]).filter((t:any)=>t&&typeof t.id==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(t.id)&&input.uris.includes(`spotify:track:${t.id.slice(8)}`)&&typeof t.title==='string'&&!!t.title.trim()&&t.title.length<300&&typeof t.artist==='string'&&!!t.artist.trim()&&t.artist.length<300&&Number.isFinite(t.durationMs)&&t.durationMs>0&&t.durationMs<24*3600000).map((t:any)=>({id:t.id,title:t.title.trim(),artist:t.artist.trim(),album:typeof t.album==='string'?t.album.slice(0,300):'',durationMs:t.durationMs,genre:'',artworkUrl:typeof t.artworkUrl==='string'&&/^https:\/\//.test(t.artworkUrl)?t.artworkUrl:null,sourceUrl:`https://open.spotify.com/track/${t.id.slice(8)}`,explicit:t.explicit===true}));
  // Replays repair only derived snapshots. Read current metadata so an older
  // operation cannot restore an obsolete playlist count.
  const current=replay?.phase==='done'?normalizePlaylist(object(await spotifyRequest(`playlists/${result.playlistId}`,{fresh:true}))):result.playlist;
  if(current)await syncSavedPlaylist(user.userId,current,tracks);
  if(replay?.phase==='done')await storage.write(repairPath,JSON.stringify({pending:false,at:Date.now()}));
 }catch{refreshPending=true;try{await storage.write(repairPath,JSON.stringify({pending:true,at:Date.now(),playlistId:result.playlistId}))}catch{}}
 // A replay is a confirmed save, but its old count must never overwrite a
 // more recent update from another operation or tab.
 return Response.json(replay?.phase==='done'?{...result,count:null,playlist:null,refreshPending:true}:{...result,refreshPending},{headers:noStore});
 }catch(e){return apiError(e instanceof StoreLockedError?new SpotifyError(e.message,409):e instanceof PlaylistExportError?new SpotifyError(e.message,e.status):e)}finally{for(const release of locks.reverse())try{await release()}catch{}}}
