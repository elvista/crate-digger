import { clearSession } from '@/lib/spotify';
import { appConfig, matchesAppHost } from '@/lib/spotify-session';
export async function POST(request:Request){if(request.headers.get('origin')!==appConfig().origin||!matchesAppHost(request,appConfig().origin))return Response.json({error:'Invalid origin.'},{status:403});await clearSession();return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});}
