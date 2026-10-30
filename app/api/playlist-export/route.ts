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
export async function GET(request:Request){try{
 const user=await requireUser();if(!hasPlaylistWriteScope(user.scope))throw new SpotifyError('Enable playlist saving to choose a destination.',403);
 let offset:number;try{offset=parseOffset(new URL(request.url).searchParams.get('cursor'))}catch{throw new SpotifyError('Invalid playlist cursor.',400)}
 const data=object(await spotifyRequest(`me/playlists?limit=50&offset=${offset}`));if(!Array.isArray(data.items))throw new SpotifyError('Spotify returned an unreadable playlist list.');
 return Response.json({items:data.items.filter(p=>object(object(p).owner).id===user.userId).map(normalizePlaylist).filter(Boolean),nextCursor:data.next&&offset<1000?String(offset+50):null},{headers:noStore});
 }catch(e){return apiError(e)}}
export async function POST(request:Request){const locks:(()=>Promise<void>)[]=[];try{
 requireOrigin(request);const user=await requireUser();if(!hasPlaylistWriteScope(user.scope))throw new SpotifyError('Reconnect Spotify to enable playlist saving.',403);
 const body=await request.text();if(Buffer.byteLength(body)>300000)throw new SpotifyError('Save request is too large.',400);
 let input;try{input=parseExport(JSON.parse(body))}catch(e){throw new SpotifyError(e instanceof Error?e.message:'Invalid playlist save request.',400)}
 const root=join(process.cwd(),'.data/playlist-exports');const storage=createTextStore(root,'playlist-exports');const owner=createHash('sha256').update(user.userId).digest('hex');
 if(input.mode==='finds')locks.push(await storage.lock(`${owner}/crate-finds`));
 const path=`${owner}/${input.operationId}.json`;locks.push(await storage.lock(path));
 const result=await exportPlaylist(input,user.userId,spotifyRequest,async()=>{const value=await storage.read(path);return value?JSON.parse(value) as ExportReceipt:null},async receipt=>{await storage.write(path,JSON.stringify(receipt))});
 return Response.json(result,{headers:noStore});
 }catch(e){return apiError(e instanceof StoreLockedError?new SpotifyError(e.message,409):e instanceof PlaylistExportError?new SpotifyError(e.message,e.status):e)}finally{for(const release of locks.reverse())try{await release()}catch{}}}
