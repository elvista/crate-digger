import {createReadStream} from 'node:fs';
import {stat,realpath} from 'node:fs/promises';
import {extname} from 'node:path';
import {Readable} from 'node:stream';
import {requireLocalUser,noStore,apiError} from '@/lib/route-auth';
import {rekordboxRequest} from '@/lib/rekordbox';
import {localSettingsStore} from '@/lib/local-download-settings';
import {SpotifyError} from '@/lib/spotify';
import {browserMp3} from '@/lib/local-audio-transcode';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){try{
 if(process.env.VERCEL)throw new SpotifyError('Local playback requires your Mac.',403);const user=await requireLocalUser(),{id}=await params;if(!/^\d+$/.test(id))throw new SpotifyError('Invalid local track.',400);
 const record=await rekordboxRequest<{path:string;audioPath?:string|null;localLibraryId:string}>('content-file',{libraryPath:(await localSettingsStore().read(user.userId)).libraryPath,contentId:id});if(new URL(request.url).searchParams.get('library')!==record.localLibraryId)throw new SpotifyError('The library changed. Reload your Rekordbox sources.',409);if(!record.audioPath)throw new SpotifyError('This track is not stored locally. Download it in Rekordbox or reconnect its drive, then retry local audio.',404);const original=await realpath(record.audioPath),originalInfo=await stat(original);const type:Record<string,string>={'.mp3':'audio/mpeg','.m4a':'audio/mp4','.wav':'audio/wav','.flac':'audio/flac','.aiff':'audio/aiff','.aif':'audio/aiff'};if(!originalInfo.isFile()||!type[extname(original).toLowerCase()])throw new SpotifyError('This audio format cannot be played in the browser.',415);
 const convert=new URL(request.url).searchParams.get('transcode')==='1';let path=original,info=originalInfo;if(convert&&extname(original).toLowerCase()!=='.mp3'){try{path=await browserMp3(original,originalInfo);info=await stat(path)}catch{throw new SpotifyError('Your browser could not play this recording, and an MP3 playback copy could not be prepared. Try the file in Rekordbox.',415)}}
 let start=0,end=info.size-1;const range=request.headers.get('range');if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}});if(!m[1])start=Math.max(0,info.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]))}if(start>end||start>=info.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${info.size}`}})}
 return new Response(Readable.toWeb(createReadStream(path,{start,end})) as ReadableStream,{status:range?206:200,headers:{...noStore,'Accept-Ranges':'bytes','Content-Type':convert?'audio/mpeg':type[extname(path).toLowerCase()],'Content-Length':String(end-start+1),...(range?{'Content-Range':`bytes ${start}-${end}/${info.size}`}:{})}});
}catch(e){return apiError(e instanceof SpotifyError?e:new SpotifyError('Local audio is unavailable. Reconnect its drive and reload your Rekordbox sources.',404),'local')}}
