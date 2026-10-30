import { hasPlaybackScope, hasPlaylistScope, hasPlaylistWriteScope } from '@/lib/playback-settings';
import { appConfig } from '@/lib/spotify-session';
import { readSession } from '@/lib/spotify';
export async function GET(){let configured=true;try{appConfig();}catch{configured=false;}const session=await readSession();if(!session)return Response.json({configured,authenticated:false,localDownloads:!process.env.VERCEL},{headers:{'Cache-Control':'no-store'}});return Response.json({configured,authenticated:true,localDownloads:!process.env.VERCEL,user:{playlistWriteAuthorized:hasPlaylistWriteScope(session.scope),playlistAuthorized:hasPlaylistScope(session.scope),playbackAuthorized:hasPlaybackScope(session.scope),id:session.userId,name:session.name}},{headers:{'Cache-Control':'no-store'}});}
