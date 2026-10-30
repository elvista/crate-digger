import type { Track } from './catalog.ts';
import { normalizeTrack } from './spotify-data.ts';

export class CosineError extends Error {
  status: number;
  retryAfter?: string;
  constructor(message: string, status = 502, retryAfter?: string) { super(message); this.status = status; this.retryAfter = retryAfter; }
}
export type CosineTrack = { id: string; title: string; artist: string; score?: number };
export type ProviderRead = (path: string, options?: {method:'POST';body:{tracks:string[];similar_limit:number}}) => Promise<unknown>;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
// Keep all version words: a remix, edit, live version or instrumental is a different seed.
export function recordingText(value: string) { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function sameArtist(a: string, b: string) { return recordingText(a.split(',')[0]) === recordingText(b.split(',')[0]); }
export function sameRecording(a: {title:string;artist:string}, b: {title:string;artist:string}) { return recordingText(a.title) === recordingText(b.title) && sameArtist(a.artist, b.artist); }
// Reissues can carry different ISRCs for the same named recording. Accept them
// only when the exact artist/version matches and their durations agree closely.
export function chooseSpotifyRecording(matches: Track[]): Track | null {
  if(!matches.length)return null;
  const recordings=new Set(matches.flatMap(track=>track.isrc?[track.isrc]:[]));
  if(recordings.size>1){
    const durations=matches.map(track=>track.durationMs);
    const shortest=Math.min(...durations),longest=Math.max(...durations);
    if(shortest<=0||longest-shortest>Math.max(2000,shortest*.005))return null;
  }
  return matches[0];
}
export function cosineTracks(value: unknown): CosineTrack[] {
  if (!Array.isArray(value)) throw new CosineError('cosine.club returned an unreadable track list. Try again.');
  return value.flatMap(raw => {
    const v = object(raw), id = typeof v.id === 'number' ? String(v.id) : v.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || typeof v.track !== 'string' || !v.track.trim() || typeof v.artist !== 'string' || !v.artist.trim()) return [];
    return [{ id, title: v.track.trim(), artist: v.artist.trim(), ...(typeof v.score === 'number' && Number.isFinite(v.score) && v.score >= 0 && v.score <= 1 ? {score:v.score} : {}) }];
  });
}
export async function cosineDiscovery(seeds: Track[], cosine: ProviderRead, spotify: (path:string)=>Promise<unknown>, signal?: AbortSignal, progress: (stage:string)=>void = ()=>{}) {
  const check = () => { if (signal?.aborted) throw new CosineError('Generation cancelled.', 499); };
  const read = async (api:ProviderRead,path:string,options?:Parameters<ProviderRead>[1]) => { check();const data=await api(path,options);check();return data; };
  type Candidate = CosineTrack & {seed:string;seedIds:Set<string>;seedTitles:Set<string>};
  const candidates = new Map<string,Candidate>();
  const uniqueSeeds=[...new Map(seeds.map(t=>[`${recordingText(t.artist.split(',')[0])}|${recordingText(t.title)}`,t])).values()];
  const matchedSeeds=new Set<string>();
  let singleMatch: {seed:Track;match:CosineTrack}|undefined;
  function add(seed:Track,values:unknown) {
    for(const track of cosineTracks(values)) {
      if(uniqueSeeds.some(original=>sameRecording(original,track)))continue;
      const prior=candidates.get(track.id);
      if(prior){prior.seedIds.add(seed.id);prior.seedTitles.add(seed.title);if((track.score??0)>(prior.score??0)){prior.score=track.score;prior.seed=seed.title}}
      else candidates.set(track.id,{...track,seed:seed.title,seedIds:new Set([seed.id]),seedTitles:new Set([seed.title])});
    }
  }
  // The bulk API accepts 50 source songs and returns independent neighbors per song.
  // This is not a combined-playlist embedding or a chain seeded from the next card.
  for(let offset=0;offset<uniqueSeeds.length;offset+=50) {
    const batch=uniqueSeeds.slice(offset,offset+50);
    progress(`Finding similar tracks for source songs ${offset+1}–${offset+batch.length} of ${uniqueSeeds.length}`);
    const query=(seed:Track)=>`${seed.artist.split(',')[0]} - ${seed.title}`;
    const queries=new Map(batch.map(seed=>[query(seed),seed]));
    const response=object(await read(cosine,'search/bulk',{method:'POST',body:{tracks:[...queries.keys()],similar_limit:20}}));
    const data=object(response.data);
    if(!Array.isArray(data.results)||!Array.isArray(data.unmatched))throw new CosineError('cosine.club returned an unreadable bulk-search response. Try again.');
    for(const raw of data.results) {
      const result=object(raw), seed=typeof result.query==='string'?queries.get(result.query):undefined;
      if(!seed)continue;
      const match=cosineTracks([result.track])[0];
      if(!match||!sameRecording(seed,match))continue;
      matchedSeeds.add(seed.id);add(seed,result.similar_tracks);
      if(uniqueSeeds.length===1&&Array.isArray(result.similar_tracks)&&result.similar_tracks.length>=20)singleMatch={seed,match};
    }
  }
  // Bulk responses are capped at 20 neighbors even when a larger limit is sent.
  // A single seed can use the dedicated endpoint's larger, verified 50-song pool.
  if(singleMatch){
    progress('Finding more similar songs for this seed');
    try{const response=object(await read(cosine,`tracks/${encodeURIComponent(singleMatch.match.id)}/similar?limit=50`));add(singleMatch.seed,object(response.data).similar_tracks)}
    catch(e){if(!(e instanceof CosineError&&e.status===404))throw e;}
  }
  // Exact bulk lookup can miss punctuation differences. Retry a small number as
  // single catalog searches, but never retry rate limits or change remix names.
  const unmatched=uniqueSeeds.filter(seed=>!matchedSeeds.has(seed.id));
  for(const seed of unmatched.slice(0,8)) {
    progress('Trying individual source-track matches');
    const response=object(await read(cosine,`search?${new URLSearchParams({q:`${seed.artist.split(',')[0]} ${seed.title}`.slice(0,200),limit:'20'})}`));
    const match=cosineTracks(response.data).find(t=>sameRecording(seed,t));
    if(!match)continue;
    try {
      const similar=object(await read(cosine,`tracks/${encodeURIComponent(match.id)}/similar?limit=${uniqueSeeds.length===1?50:20}`));
      add(seed,object(similar.data).similar_tracks);matchedSeeds.add(seed.id);
    } catch(e) {if(e instanceof CosineError&&e.status===404)continue;throw e;}
  }
  const items: Track[]=[];let unmatchedResults=0,lookedUp=0;
  const sorted=[...candidates.values()].sort((a,b)=>b.seedIds.size-a.seedIds.size||(b.score??0)-(a.score??0));
  // Prioritize agreement across sources, then spread remaining slots across seeds.
  const shared=sorted.filter(t=>t.seedIds.size>1).slice(0,20),used=new Set(shared.map(t=>t.id));
  const groups=new Map<string,Candidate[]>();
  for(const candidate of sorted)if(!used.has(candidate.id))groups.set(candidate.seed,[...(groups.get(candidate.seed)||[]),candidate]);
  const ranked=[...shared,...Array.from({length:uniqueSeeds.length===1?50:20},(_,i)=>[...groups.values()].flatMap(g=>g[i]?[g[i]]:[])).flat()].slice(0,60);
  for(const candidate of ranked) {
    progress('Matching similar tracks to Spotify');
    const quote=(v:string)=>v.replace(/["\\]/g,' ');
    const params=new URLSearchParams({q:`track:"${quote(candidate.title)}" artist:"${quote(candidate.artist.split(',')[0])}"`,type:'track',limit:'10'});
    const response=object(await read(spotify,`search?${params}`));lookedUp++;
    if(!Array.isArray(object(response.tracks).items))throw new CosineError('Spotify returned an unreadable search response. Try again.');
    const matches=(object(response.tracks).items as unknown[]).map(raw=>normalizeTrack(raw,'Audio similarity')).filter((t):t is Track=>!!t&&sameRecording(t,candidate));
    const match=chooseSpotifyRecording(matches);
    if(!match){unmatchedResults++;continue;}
    const seedLabel=candidate.seedIds.size>1?`${candidate.seedIds.size} source songs`:candidate.seed;
    items.push({...match,reason:`Sounds similar to ${seedLabel} · cosine.club`,similaritySource:'cosine.club',similarityTrackId:candidate.id,similarityScore:candidate.score,similaritySeedCount:candidate.seedIds.size});
  }
  const warnings=[`Audio similarity from cosine.club. Matched ${matchedSeeds.size} of ${uniqueSeeds.length} source songs; ${items.length} of ${lookedUp} candidates matched to playable Spotify versions. Results combine individual song matches, not a whole-playlist sound profile.`];
  const missing=uniqueSeeds.length-matchedSeeds.size;
  if(missing){const missingSeeds=uniqueSeeds.filter(seed=>!matchedSeeds.has(seed.id));const labels=missingSeeds.slice(0,5).map(seed=>`${seed.title} — ${seed.artist}`).join('; ');warnings.push(`Not matched in cosine.club: ${labels}${missingSeeds.length>5?`; and ${missingSeeds.length-5} more`:''}. Catalog coverage and recording names vary. Try another seed or check the track version.`)}
  if(unmatchedResults)warnings.push(`${unmatchedResults} candidates were unavailable or could not be matched to the same version on Spotify and were omitted.`);
  if(candidates.size>ranked.length)warnings.push(`Showing a first digging queue from ${ranked.length} of ${candidates.size} similar-track candidates. Narrow your sources to explore a particular sound.`);
  if(!items.length)warnings.push('No playable matches found. Try different seeds; artist-only results have not been substituted.');
  return {items,warnings};
}
