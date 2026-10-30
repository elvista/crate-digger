import type {RecordingMappings} from './recording-mappings.ts';
import type {Track} from './catalog.ts';
import {normalizeTrack} from './spotify-data.ts';
import {baseTrackTitle} from './track-versions.ts';
import {recordingText,sameRecording,searchArtist,matchRecording,recordingKey} from './recording-match.ts';
export {recordingText,sameRecording} from './recording-match.ts';
export class CosineError extends Error{status:number;retryAfter?:string;constructor(message:string,status=502,retryAfter?:string){super(message);this.status=status;this.retryAfter=retryAfter}}
export type CosineTrack={id:string;title:string;artist:string;score?:number};
export type ProviderRead=(path:string,options?:{method:'POST';body:{tracks:string[];similar_limit:number}})=>Promise<unknown>;
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export function cosineTracks(value:unknown):CosineTrack[]{if(!Array.isArray(value))throw new CosineError('cosine.club returned an unreadable track list. Try again.');return value.flatMap(raw=>{const v=object(raw),id=typeof v.id==='number'?String(v.id):v.id;return typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&typeof v.track==='string'&&v.track.trim()&&typeof v.artist==='string'&&v.artist.trim()?[{id,title:v.track.trim(),artist:v.artist.trim(),...(typeof v.score==='number'&&v.score>=0&&v.score<=1?{score:v.score}:{})}]:[]})}
export function chooseSpotifyRecording(matches:Track[]){return matches[0]??null;}
type Provenance='direct'|'second-hop'|'artist-fallback';
type Candidate=CosineTrack&{seedIds:string[];seedTitles:string[];provenance:Provenance;seedConfidence:number;attempt:number;done:boolean;rank:number};
type Task={kind:'bulk';offset:number}|{kind:'seed';index:number;attempt:number}|{kind:'neighbors';track:CosineTrack;seedIndex:number;provenance:Provenance;confidence:number};
export type MatchingState={version:1;seeds:Track[];excluded:string[];excludedIsrc:string[];tasks:Task[];candidates:Candidate[];expanded:string[];matchedSeeds:string[];items:Track[];warnings:string[];lookups:number;status:'running'|'paused'|'complete';retryAt?:number;target:number;reason?:string};
export function createMatchingState(seeds:Track[],excluded:string[]=[],excludedIsrc:string[]=[]):MatchingState{
 const unique=[...new Map(seeds.map(t=>[recordingKey(t),t])).values()];
 return{version:1,seeds:unique,excluded:[...new Set([...excluded,...seeds.map(t=>t.id)])],excludedIsrc:[...new Set([...excludedIsrc,...seeds.flatMap(t=>t.isrc?[t.isrc]:[])])],tasks:Array.from({length:Math.ceil(unique.length/50)},(_,i)=>({kind:'bulk',offset:i*50})),candidates:[],expanded:[],matchedSeeds:[],items:[],warnings:[],lookups:0,status:'running',target:50};
}
const candidateRank=(c:Candidate)=>(c.provenance==='direct'?3:c.provenance==='second-hop'?2:1)*10+c.seedConfidence+(c.score??0)+Math.min(c.seedIds.length,10)*.03;
const queries=(t:{title:string;artist:string})=>[...new Set([`track:"${t.title.replace(/["\\]/g,' ')}" artist:"${searchArtist(t.artist)}"`,`track:"${baseTrackTitle(t.title).replace(/["\\]/g,' ')}" artist:"${searchArtist(t.artist)}"`,`${baseTrackTitle(t.title)} ${t.artist}`,baseTrackTitle(t.title)])];
function addNeighbors(s:MatchingState,seedIndex:number,raw:unknown,provenance:Provenance,confidence:number){
 const seed=s.seeds[seedIndex];
 for(const t of cosineTracks(raw)){
  if(s.seeds.some(v=>sameRecording(v,t)))continue;
  const prior=s.candidates.find(c=>c.id===t.id);
  if(prior){if(!prior.seedIds.includes(seed.id)){prior.seedIds.push(seed.id);prior.seedTitles.push(seed.title)}if(provenance==='direct')prior.provenance='direct';if((t.score??0)>(prior.score??0))prior.score=t.score;prior.rank=candidateRank(prior);continue}
  if(s.candidates.length>=1500)continue;
  const c:Candidate={...t,seedIds:[seed.id],seedTitles:[seed.title],provenance,seedConfidence:confidence,attempt:0,done:false,rank:0};c.rank=candidateRank(c);s.candidates.push(c);
 }
}
function addItem(s:MatchingState,t:Track){
 if(s.excluded.includes(t.id)||t.isrc&&s.excludedIsrc.includes(t.isrc))return;
 const old=s.items.findIndex(v=>v.id===t.id||!!t.isrc&&v.isrc===t.isrc||recordingKey(v)===recordingKey(t));
 if(old<0)s.items.push(t);else if((t.matchRank??0)>(s.items[old].matchRank??0))s.items[old]=t;
 s.items.sort((a,b)=>(b.matchRank??0)-(a.matchRank??0));
}
export function matchingWarnings(s:MatchingState){return[
 `Audio similarity from cosine.club. Matched ${s.matchedSeeds.length} of ${s.seeds.length} source songs; ${s.items.length} of ${s.target} playable Spotify songs resolved from ${s.candidates.length} candidates. Ranked strongest to weakest.`,
 ...s.warnings,
 ...(s.items.some(t=>t.similarityMatch==='related-version')?[`Included ${s.items.filter(t=>t.similarityMatch==='related-version').length} related Spotify versions. Alternate versions do not inherit the analyzed recording's audio score.`]:[]),
 ...(s.status==='paused'?[`Matching paused until ${new Date(s.retryAt!).toISOString()}. Your matches are saved and matching resumes after the cooldown.`]:s.status==='complete'&&s.items.length<s.target?[`Found ${s.items.length}/${s.target} songs. ${s.reason||'Available candidate paths were exhausted.'}`]:[])
]}
/** One resumable batch. Each completed request advances the saved cursor; a 429 retains the pending task. */
export async function advanceMatching(s:MatchingState,cosine:ProviderRead,spotify:(path:string)=>Promise<unknown>,signal?:AbortSignal,limits={spotify:12,cosine:20,milliseconds:45000},mappings?:RecordingMappings){
 if(s.status==='complete'||s.retryAt&&s.retryAt>Date.now())return s;
 s.status='running';s.retryAt=undefined;let sp=0,co=0;const started=Date.now();
 const check=()=>{if(signal?.aborted)throw new CosineError('Generation cancelled.',499)};
 while(s.items.length<s.target&&Date.now()-started<limits.milliseconds){
  check();
  try{
   const task=s.tasks[0];
   if(task){
    if(co>=limits.cosine)break;co++;
    if(task.kind==='bulk'){
     const batch=s.seeds.slice(task.offset,task.offset+50);const qs=new Map(batch.map((t,i)=>[`${t.artist.split(',')[0]} - ${t.title}`,task.offset+i]));
     const data=object(object(await cosine('search/bulk',{method:'POST',body:{tracks:[...qs.keys()],similar_limit:20}})).data);check();
     if(!Array.isArray(data.results)||!Array.isArray(data.unmatched))throw new CosineError('cosine.club returned an unreadable bulk-search response.');
     s.tasks.shift();const found=new Set<number>();
     for(const raw of data.results){const v=object(raw),index=qs.get(String(v.query));if(index===undefined)continue;const t=cosineTracks([v.track])[0],match=t&&matchRecording(s.seeds[index],t);if(!t||!match)continue;found.add(index);s.matchedSeeds.push(s.seeds[index].id);addNeighbors(s,index,v.similar_tracks,'direct',match.confidence);if(Array.isArray(v.similar_tracks)&&v.similar_tracks.length>=20)s.tasks.push({kind:'neighbors',track:t,seedIndex:index,provenance:'direct',confidence:match.confidence})}
     for(const index of qs.values())if(!found.has(index))s.tasks.push({kind:'seed',index,attempt:0});
    }else if(task.kind==='seed'){
     const seed=s.seeds[task.index],artists=seed.artist.split(/,|\s+&\s+/).map(v=>v.trim());
     const variants=[`${artists[0]} ${seed.title}`,`${artists.at(-1)} ${baseTrackTitle(seed.title)}`,`${baseTrackTitle(seed.title)} ${seed.artist}`,artists[0]];
     const data=cosineTracks(object(await cosine(`search?${new URLSearchParams({q:variants[task.attempt].slice(0,200),limit:'20'})}`)).data);check();
     const ranked=data.map(t=>({t,m:matchRecording(seed,t)})).filter(v=>v.m).sort((a,b)=>b.m!.confidence-a.m!.confidence);
     s.tasks.shift();
     if(ranked.length){const {t,m}=ranked[0];if(!s.matchedSeeds.includes(seed.id))s.matchedSeeds.push(seed.id);if(!sameRecording(seed,t))s.warnings.push(`Using approximate seed: ${t.title} — ${t.artist} for ${seed.title} — ${seed.artist}.`);s.tasks.push({kind:'neighbors',track:t,seedIndex:task.index,provenance:'direct',confidence:m!.confidence});}
     else if(task.attempt<3)s.tasks.push({...task,attempt:task.attempt+1});
     else{const fallback=data.filter(t=>recordingText(t.artist).includes(recordingText(artists[0]))).slice(0,2);s.warnings.push(`Not matched in cosine.club: ${seed.title} — ${seed.artist}.${fallback.length?' Using broader artist-based discovery, not similarity to the requested recording.':' No plausible recording found; unrelated tracks have not been substituted.'}`);for(const t of fallback)s.tasks.push({kind:'neighbors',track:t,seedIndex:task.index,provenance:'artist-fallback',confidence:.5})}
    }else{
     const data=object(object(await cosine(`tracks/${encodeURIComponent(task.track.id)}/similar?limit=50`)).data);check();addNeighbors(s,task.seedIndex,data.similar_tracks,task.provenance,task.confidence);s.tasks.shift();
    }
    continue;
   }
   const c=s.candidates.filter(t=>!t.done).sort((a,b)=>b.rank-a.rank)[0];
   if(!c){
    const hub=s.candidates.filter(t=>t.provenance==='direct'&&!s.expanded.includes(t.id)).sort((a,b)=>b.rank-a.rank)[0];
    if(hub&&s.expanded.length<20){s.expanded.push(hub.id);s.tasks.push({kind:'neighbors',track:hub,seedIndex:Math.max(0,s.seeds.findIndex(t=>t.id===hub.seedIds[0])),provenance:'second-hop',confidence:hub.seedConfidence});continue}
    s.status='complete';s.reason=s.expanded.length>=20?'The current search expansion budget was exhausted.':'Available cosine search paths were exhausted.';break;
   }
   const cached=c.attempt===0?await mappings?.get(c.id):null;
   if(!cached&&sp>=limits.spotify)break;
   let playable:Track[];
   if(cached)playable=cached;
   else{
    sp++;s.lookups++;
    const qs=queries(c);const response=object(await spotify(`search?${new URLSearchParams({q:qs[c.attempt],type:'track',limit:'10'})}`));check();
    if(!Array.isArray(object(response.tracks).items))throw new CosineError('Spotify returned an unreadable search response.');
    playable=(object(response.tracks).items as unknown[]).map(raw=>normalizeTrack(raw,'Audio similarity')).filter((t):t is Track=>!!t);
   }
   const ranked=playable.map(t=>({t,m:t.matchConfirmedByUser?{kind:'approximate' as const,confidence:1}:matchRecording(c,t)})).filter(v=>v.m).sort((a,b)=>b.m!.confidence-a.m!.confidence);
   if(ranked.length&&!cached)await mappings?.set(c.id,ranked.map(v=>v.t));
   for(const {t,m} of ranked){
    const kind=m!.kind;const provenanceLabel=c.provenance==='second-hop'?'Second-hop discovery':c.provenance==='artist-fallback'?'Broader artist-based discovery':'Sounds similar';
    const label=t.matchConfirmedByUser?`Your chosen Spotify recording for ${c.title} by ${c.artist}`:kind==='related-version'?`Related version of ${c.title} by ${c.artist}`:kind==='approximate'?`Approximate Spotify match for ${c.title} by ${c.artist}`:`${provenanceLabel} to ${c.seedTitles.length>1?`${c.seedTitles.length} source songs`:c.seedTitles[0]}`;
    addItem(s,{...t,reason:`${label} · cosine.club${c.provenance==='direct'?'':` · ${provenanceLabel}`}`,similaritySource:'cosine.club',similarityMatch:kind,similarityTrackId:c.id,...(kind==='exact'&&c.provenance==='direct'&&c.seedConfidence>=.99?{similarityScore:c.score}:{}),similaritySeedCount:c.seedIds.length,matchConfidence:m!.confidence,matchProvenance:c.provenance,matchRank:c.rank*10+m!.confidence*5+(kind==='exact'?2:0)});
   }
   if(ranked.length)c.done=true;else if(++c.attempt>=queries(c).length)c.done=true;
  }catch(e){
   check();const error=e as {status?:number;retryAfter?:string;message?:string};
   if(error.status===404){if(s.tasks.length)s.tasks.shift();else{const c=s.candidates.filter(t=>!t.done).sort((a,b)=>b.rank-a.rank)[0];if(c)c.done=true}continue}
   if(error.status===429||error.status===502||error.status===503){const seconds=Number(error.retryAfter)||60;s.status='paused';s.retryAt=Date.now()+Math.max(1,seconds)*1000;break}
   throw e;
  }
 }
 if(s.items.length>=s.target){s.items=s.items.slice(0,s.target);s.status='complete'}
 return s;
}
export async function cosineDiscovery(seeds:Track[],cosine:ProviderRead,spotify:(path:string)=>Promise<unknown>,signal?:AbortSignal,progress:(stage:string)=>void=()=>{}){
 const state=createMatchingState(seeds);progress('Matching and expanding toward 50 playable songs');
 while(state.status==='running')await advanceMatching(state,cosine,spotify,signal,{spotify:250,cosine:150,milliseconds:240000});
 return{items:state.items,warnings:matchingWarnings(state)};
}
