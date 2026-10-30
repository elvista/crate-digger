const versionWords=/\b(?:remix|rework|bootleg|mashup|edit|mix|extended|dub|radio|vip)\b/i;
const otherPerformance=/\b(?:live|acoustic|instrumental|karaoke|cover)\b/i;
/** Strip only explicit version suffixes; musical subtitles such as Act I and II stay intact. */
export function baseTrackTitle(title:string):string{
 let current=title.trim();
 for(let pass=0;pass<3;pass++){
  const bracket=/\s*[\[(]([^()[\]]*)[\])]\s*$/.exec(current);
  if(bracket&&versionWords.test(bracket[1])){current=current.slice(0,bracket.index).trim();continue}
  const suffix=/\s+[-–—]\s+(.+)$/.exec(current);
  if(suffix&&versionWords.test(suffix[1])){current=current.slice(0,suffix.index).trim();continue}
  const inline=/\s+(VIP|Radio Edit|Extended Mix|Original Mix)$/i.exec(current);
  if(inline){current=current.slice(0,inline.index).trim();continue}
  break;
 }
 return current;
}
function versionSuffix(title:string):string{
 const bracket=/[\[(]([^()[\]]*)[\])]\s*$/.exec(title);
 const suffix=/\s+[-–—]\s+(.+)$/.exec(title);
 const inline=/\s+(VIP|Radio Edit|Extended Mix|Original Mix)$/i.exec(title);
 const text=bracket?.[1]||suffix?.[1]||inline?.[1]||'';
 return versionWords.test(text)||otherPerformance.test(text)?text:'';
}
export function relatedTrackVersion(a:string,b:string):boolean{
 const normalize=(v:string)=>v.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 if(otherPerformance.test(versionSuffix(a))||otherPerformance.test(versionSuffix(b)))return false;
 if(baseTrackTitle(a)===a.trim()&&baseTrackTitle(b)===b.trim())return false;
 return normalize(baseTrackTitle(a))===normalize(baseTrackTitle(b));
}
export function trackVersionLabel(title:string):string{
 const version=versionSuffix(title);
 if(/\b(?:remix|rework|bootleg|mashup)\b/i.test(version))return 'Remix';
 if(/\b(?:edit|radio|cut|vip)\b/i.test(version))return 'Edit';
 if(/\bdub\b/i.test(version))return 'Dub';
 if(/\bextended\b/i.test(version))return 'Extended';
 if(/\blive\b/i.test(version))return 'Live';
 if(/\bacoustic\b/i.test(version))return 'Acoustic';
 if(/\binstrumental\b/i.test(version))return 'Instrumental';
 return 'Original';
}
