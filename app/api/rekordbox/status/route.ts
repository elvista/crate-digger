import {requireOrigin,requireLocalUser,noStore} from '@/lib/route-auth';
import {localSettingsStore} from '@/lib/local-download-settings';
import {rekordboxStatus} from '@/lib/rekordbox';
export const runtime='nodejs';
export async function POST(request:Request){
  if(process.env.VERCEL||!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.get('host')||''))
    return Response.json({error:'Rekordbox requires the local app on your Mac.'},{status:403,headers:noStore});
  let owner:string;
  try{requireOrigin(request);owner=(await requireLocalUser()).userId;}
  catch{return Response.json({error:'Sign in from the local app to inspect Rekordbox.'},{status:403,headers:noStore});}
  try{return Response.json(await rekordboxStatus((await localSettingsStore().read(owner)).libraryPath),{headers:noStore});}
  catch(e){return Response.json({error:e instanceof Error?e.message:'Rekordbox connection failed.'},{status:503,headers:noStore});}
}
