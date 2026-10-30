import type {Track} from './catalog.ts';
import type {Playlist} from './discovery-types.ts';
import type {VideoMatch} from './youtube-match.ts';
export type DownloadRow={track:Track;matches:VideoMatch[];chosen:string;selected:boolean;error:string};
export type DownloadWorkspace={selected:string[];rows:DownloadRow[];warnings:string[];library:Playlist[];showSources:boolean;nextOffset:number|null;query:string};
export function readDownloadWorkspace(raw:string|null):DownloadWorkspace|null{
 try{if(!raw||raw.length>2000000)return null;const d=JSON.parse(raw);if(d.version!==1||!Array.isArray(d.rows)||!Array.isArray(d.selected)||!Array.isArray(d.library))return null;
 const validId=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9]{22}$/.test(v);
 const library=d.library.filter((p:any)=>p&&validId(p.id)&&typeof p.name==='string').slice(0,1050);
 const rows=d.rows.slice(0,50).flatMap((r:any)=>{if(!r?.track||!/^spotify:[A-Za-z0-9]{22}$/.test(r.track.id)||typeof r.track.title!=='string'||typeof r.track.artist!=='string'||!Number.isFinite(r.track.durationMs))return[];const matches=Array.isArray(r.matches)?r.matches.filter((v:any)=>v&&/^[A-Za-z0-9_-]{11}$/.test(v.id)&&typeof v.title==='string'&&Number.isFinite(v.score)&&v.score>=0&&v.score<=1).slice(0,5).map((v:any)=>({...v,channel:typeof v.channel==='string'?v.channel:'YouTube',duration:Number.isFinite(v.duration)?v.duration:0,url:`https://www.youtube.com/watch?v=${v.id}`})):[];return[{track:{...r.track,sourceUrl:`https://open.spotify.com/track/${r.track.id.slice(8)}`},matches,chosen:matches.some((v:VideoMatch)=>v.id===r.chosen)?r.chosen:'',selected:r.selected===true&&(!matches.length||matches.some((v:VideoMatch)=>v.id===r.chosen)),error:typeof r.error==='string'?r.error:''}]});
 return{selected:d.selected.filter(validId).slice(0,10),rows,library,warnings:Array.isArray(d.warnings)?d.warnings.filter((w:unknown)=>typeof w==='string'):[],showSources:d.showSources!==false,nextOffset:Number.isInteger(d.nextOffset)&&d.nextOffset>=0?d.nextOffset:null,query:typeof d.query==='string'?d.query:''};
 }catch{return null}
}
