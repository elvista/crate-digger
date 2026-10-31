import {requireOrigin,requireLocalUser,noStore} from '@/lib/route-auth';
import {localSettingsStore} from '@/lib/local-download-settings';
import {validateSourcePlaylist} from '@/lib/rekordbox-destinations';
import {resolveRekordboxDestination,chooseRekordboxDestination} from '@/lib/rekordbox-playlist-mapping';
export const runtime='nodejs';
export async function POST(request:Request){
 if(process.env.VERCEL||!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.get('host')||''))return Response.json({error:'Rekordbox requires the local app on your Mac.'},{status:403,headers:noStore});
 let owner:string;try{requireOrigin(request);owner=(await requireLocalUser()).userId}catch{return Response.json({error:'Sign in from the local app to choose a Rekordbox playlist.'},{status:403,headers:noStore})}
 try{
  const text=await request.text();if(text.length>5000)throw new Error('Request too large.');
  const body=JSON.parse(text),source=validateSourcePlaylist(body.source),settings=await localSettingsStore().read(owner);
  if(body.action!=='resolve'&&body.action!=='choose')throw new Error('Unknown playlist action.');
  const result=body.action==='choose'?await chooseRekordboxDestination(owner,source,settings.libraryPath,body.destination):await resolveRekordboxDestination(owner,source,settings.libraryPath);
  return Response.json(result,{headers:noStore});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Could not resolve the Rekordbox playlist.'},{status:400,headers:noStore})}
}
