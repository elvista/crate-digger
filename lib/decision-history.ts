import type {Track} from './catalog';

export type StoredDecision={eventId:string;trackId:string;track:Track;decision:'skip'|'save';occurredAt:string;archived?:boolean};
const prefix=(owner:string)=>`crate-spotify-decision-v2:${owner}:`;
const valid=(entry:any):entry is StoredDecision=>entry&&typeof entry.eventId==='string'&&/^[a-f0-9-]{36}$/.test(entry.eventId)&&/^(?:spotify:[A-Za-z0-9]{22}|rekordbox:\d+)$/.test(entry.trackId)&&entry.track?.id===entry.trackId&&['save','skip'].includes(entry.decision)&&typeof entry.occurredAt==='string';

/** Separate keys make simultaneous tab writes independent. Legacy array entries remain readable. */
export function readDecisionHistory(owner:string,storage:Storage=localStorage):StoredDecision[]{
 const entries=new Map<string,StoredDecision>();
 try{const legacy=JSON.parse(storage.getItem(`crate-spotify-decisions-v1:${owner}`)||'[]');if(Array.isArray(legacy))for(const entry of legacy)if(valid(entry))entries.set(entry.eventId,entry)}catch{}
 const keyPrefix=prefix(owner);
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key?.startsWith(keyPrefix))continue;try{const entry=JSON.parse(storage.getItem(key)||'null');if(valid(entry)&&key===keyPrefix+entry.eventId)entries.set(entry.eventId,entry)}catch{}}
 return [...entries.values()].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.eventId.localeCompare(b.eventId)).slice(-5000);
}
export function writeDecision(owner:string,entry:StoredDecision,storage:Storage=localStorage){if(!valid(entry))throw new Error('Invalid review decision.');storage.setItem(prefix(owner)+entry.eventId,JSON.stringify(entry));const own=prefix(owner),keys:string[]=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(own))keys.push(key)}if(keys.length>5000){const dated=keys.map(key=>{try{return{key,at:JSON.parse(storage.getItem(key)||'null')?.occurredAt||''}}catch{return{key,at:''}}}).sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key));for(const old of dated.slice(0,keys.length-5000))storage.removeItem(old.key)}}
export function archiveDecision(owner:string,entry:StoredDecision,storage:Storage=localStorage){writeDecision(owner,{...entry,archived:true},storage)}
export function isDecisionStorageKey(owner:string,key:string|null){return !!key&&(key===`crate-spotify-decisions-v1:${owner}`||key.startsWith(prefix(owner)))}
