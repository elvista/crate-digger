import {baseTrackTitle,relatedTrackVersion,trackVersionLabel} from './track-versions.ts';
export function recordingText(value:string){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(act|part)\s+([ivx]+)\s*(?:&|and)\s*([ivx]+)/gi,'$1 $2 and $3').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function primary(value:string){return recordingText(value.split(',')[0].split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0]);}
export function searchArtist(value:string){return primary(value.split(/\s*&\s*/)[0]);}
function credits(value:string){return value.split(/,|\s+(?:feat\.?|ft\.?|featuring|&|x)\s+/i).map(recordingText).filter(Boolean);}
export function sameRecording(a:{title:string;artist:string},b:{title:string;artist:string}){return recordingText(a.title)===recordingText(b.title)&&(recordingText(a.artist)===recordingText(b.artist)||primary(a.artist)===primary(b.artist));}
function textScore(a:string,b:string){a=recordingText(a);b=recordingText(b);if(a===b)return 1;if(!a||!b)return 0;const row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(a[i-1]===b[j-1]?0:1));diagonal=old}}return 1-row[b.length]/Math.max(a.length,b.length);}
export type Identity={title:string;artist:string;durationMs?:number;isrc?:string|null};
export function matchRecording(a:Identity,b:Identity){
 const artistsA=credits(a.artist),artistsB=credits(b.artist);
 const overlap=artistsA.some(x=>artistsB.includes(x));
 const artist=recordingText(a.artist)===recordingText(b.artist)?1:overlap?.9:textScore(a.artist,b.artist);
 const title=textScore(baseTrackTitle(a.title),baseTrackTitle(b.title));
 if(artist<.7||title<.7)return null;
 const exact=sameRecording(a,b),related=relatedTrackVersion(a.title,b.title);
 const performanceA=trackVersionLabel(a.title),performanceB=trackVersionLabel(b.title);
 if(performanceA!==performanceB&&['Live','Acoustic','Instrumental'].some(v=>v===performanceA||v===performanceB))return null;
 let confidence=.62*title+.38*artist;
 if(exact)confidence=1;
 else if(related)confidence=Math.min(confidence,.89);
 else confidence=Math.min(confidence,.84);
 if(a.durationMs&&b.durationMs){const gap=Math.abs(a.durationMs-b.durationMs)/Math.max(a.durationMs,b.durationMs);confidence-=Math.min(.15,gap*.3)}
 if(a.isrc&&a.isrc===b.isrc)confidence=1;
 return{confidence,kind:exact?'exact' as const:related?'related-version' as const:'approximate' as const};
}
export function recordingKey(t:Identity){return `${recordingText(t.artist)}|${recordingText(t.title)}`;}
