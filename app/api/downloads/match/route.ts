import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {requireUser,requireOrigin,apiError,noStore} from '@/lib/route-auth';
import {spotifyRequest,SpotifyError} from '@/lib/spotify';
import {normalizeTrack} from '@/lib/spotify-data';
import {rankVideos} from '@/lib/youtube-match';
const run=promisify(execFile);
const active=new Set<string>();
export async function POST(request:Request){let owner:string|undefined;try{requireOrigin(request);const user=await requireUser();if(active.has(user.userId))throw new SpotifyError('A YouTube search is already running. Wait for it to finish.',429);active.add(user.userId);owner=user.userId;const {trackId}=await request.json();if(typeof trackId!=='string'||!/^spotify:[A-Za-z0-9]{22}$/.test(trackId))throw new SpotifyError('Invalid track.',400);const track=normalizeTrack(await spotifyRequest(`tracks/${trackId.slice(8)}`),'Playlist');if(!track)throw new SpotifyError('Track unavailable.',404);let stdout:string;try{({stdout}=await run(process.env.YTDLP_PATH||'/opt/homebrew/bin/yt-dlp',['--ignore-config','--flat-playlist','--dump-single-json','--no-warnings','--socket-timeout','15',`ytsearch5:${track.artist} ${track.title}`],{timeout:45000,maxBuffer:4000000,signal:request.signal}))}catch{throw new SpotifyError('YouTube search failed. Check yt-dlp is installed and YouTube is reachable. Try again.',502)}const data=JSON.parse(stdout);return Response.json({matches:rankVideos(track.title,track.artist,track.durationMs,Array.isArray(data.entries)?data.entries:[])},{headers:noStore})}catch(e){return apiError(e)}finally{if(owner)active.delete(owner)}}
