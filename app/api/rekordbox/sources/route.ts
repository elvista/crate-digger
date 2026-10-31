import {requireLocalUser,requireOrigin,noStore,apiError} from '@/lib/route-auth';
import {rekordboxRequest} from '@/lib/rekordbox';
import {localSettingsStore} from '@/lib/local-download-settings';
import {SpotifyError} from '@/lib/spotify';
export async function POST(request:Request){try{
 if(process.env.VERCEL)throw new SpotifyError('Open the local app to read Rekordbox.',403);
 requireOrigin(request);const user=await requireLocalUser(),settings=await localSettingsStore().read(user.userId),body=await request.json();
 if(body.id){if(!/^rekordbox:\d+$/.test(body.id))throw new SpotifyError('Invalid playlist.',400);const data=await rekordboxRequest<{items:any[]}>('source-tracks',{libraryPath:settings.libraryPath,playlistId:body.id.slice(10)});const offset=body.offset||0;if(!Number.isInteger(offset)||offset<0||offset>500)throw new SpotifyError('Invalid offset.',400);return Response.json({items:data.items.slice(offset,offset+50),nextOffset:offset+50<data.items.length?offset+50:null,warnings:[]},{headers:noStore})}
 const data=await rekordboxRequest<{playlists:any[]}>('playlists',{libraryPath:settings.libraryPath});return Response.json({items:data.playlists.filter(p=>p.attribute===0||p.attribute===1||p.attribute===4).map(p=>({id:'rekordbox:'+p.id,name:p.name,path:p.path,attribute:p.attribute,parentId:p.parentId==='root'?'root':'rekordbox:'+p.parentId,count:null,image:null,url:'',snapshotId:''})),nextCursor:null},{headers:noStore});
}catch(e){return apiError(e instanceof SpotifyError?e:new SpotifyError(e instanceof Error?e.message:'Could not read Rekordbox sources.',409),'local')}}
