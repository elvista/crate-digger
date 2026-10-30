import { createHash, randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile,rename,rm } from 'node:fs/promises';
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
export async function POST(request:Request){const locks:string[]=[];try{
 requireOrigin(request);const user=await requireUser();if(!hasPlaylistWriteScope(user.scope))throw new SpotifyError('Reconnect Spotify to enable playlist saving.',403);
 const body=await request.text();if(Buffer.byteLength(body)>300000)throw new SpotifyError('Save request is too large.',400);
 let input;try{input=parseExport(JSON.parse(body))}catch(e){throw new SpotifyError(e instanceof Error?e.message:'Invalid playlist save request.',400)}
 const root=join(process.cwd(),'.data/playlist-exports',createHash('sha256').update(user.userId).digest('hex'));await mkdir(root,{recursive:true,mode:0o700});
 if(input.mode==='finds'){const accountLock=join(root,'crate-finds.lock');try{await mkdir(accountLock,{mode:0o700});locks.push(accountLock)}catch{throw new SpotifyError('Another song is being saved to Crate Finds. Please retry shortly.',409)}}
 const path=join(root,`${input.operationId}.json`),lockPath=`${path}.lock`;
 try{await mkdir(lockPath,{mode:0o700});locks.push(lockPath)}catch{throw new SpotifyError('This save is already running. Please wait before retrying.',409)}
 const result=await exportPlaylist(input,user.userId,spotifyRequest,async()=>{try{return JSON.parse(await readFile(path,'utf8')) as ExportReceipt}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e}},async receipt=>{const temp=`${path}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(receipt),{mode:0o600});await rename(temp,path)});
 return Response.json(result,{headers:noStore});
 }catch(e){return apiError(e instanceof PlaylistExportError?new SpotifyError(e.message,e.status):e)}finally{for(const lock of locks.reverse())await rm(lock,{recursive:true,force:true})}}
