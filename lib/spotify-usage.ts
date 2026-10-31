import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {createTextStore} from './text-store';
export function usageStore(client:string){const store=createTextStore(join(process.cwd(),'.data/spotify-usage'),'spotify-usage');const prefix=createHash('sha256').update(client).digest('hex');return {store,prefix}}
export async function recordSpotifyUsage(client:string,path:string,status:number){
 const {store,prefix}=usageStore(client),hour=new Date().toISOString().slice(0,13).replace(/:/g,'-'),key=`${prefix}/${hour}.json`;
 const category=path.startsWith('search?')?'search':path.includes('playlists')?'playlists':path.startsWith('tracks/')?'tracks':path.includes('player')?'playback':'other';
 const raw=await store.read(key),data=raw?JSON.parse(raw):{total:0,limited:0,byCategory:{}};data.total++;if(status===429)data.limited++;data.byCategory[category]=(data.byCategory[category]||0)+1;await store.write(key,JSON.stringify(data));
}
