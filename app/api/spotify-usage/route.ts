import {requireUser,apiError,noStore} from '@/lib/route-auth';
import {appConfig} from '@/lib/spotify-session';
import {usageStore} from '@/lib/spotify-usage';
export async function GET(){try{await requireUser();const {store,prefix}=usageStore(appConfig().clientId);const byCategory:Record<string,number>={};let total=0,limited=0;
 for(let i=0;i<24;i++){const hour=new Date(Date.now()-i*3600000).toISOString().slice(0,13).replace(/:/g,'-'),raw=await store.read(`${prefix}/${hour}.json`);if(!raw)continue;const d=JSON.parse(raw);total+=d.total;limited+=d.limited;for(const [k,v] of Object.entries(d.byCategory))byCategory[k]=(byCategory[k]||0)+Number(v)}
 return Response.json({total,limited,byCategory},{headers:noStore});
}catch(e){return apiError(e)}}
