export type SourceIdentity={playlistIds:string[];trackIds:string[];mode:'related'|'playlist';relatedMethod:'cosine'|'auto'|'artists'};
export function sourceIdentity(value:SourceIdentity){return JSON.stringify({playlists:[...value.playlistIds].sort(),tracks:[...value.trackIds].sort(),mode:value.mode,method:value.mode==='playlist'?'playlist':value.relatedMethod})}
export function sourceNamesMatch(selected:string[],active:string[]){return selected.length===active.length&&[...selected].sort().every((name,i)=>name===[...active].sort()[i])}

export function sourceDraftMethod(stored:unknown,applied?:SourceIdentity):SourceIdentity['relatedMethod']{return stored==='cosine'||stored==='auto'||stored==='artists'?stored:applied?.relatedMethod||'cosine'}
