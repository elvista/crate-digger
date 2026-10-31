import {savedSpotify} from './saved-spotify.ts';
import {createHash} from 'node:crypto';
/** Reconcile only a previously captured source snapshot; never fetch Spotify here. */
export async function downloadSourceState(owner:string,id:unknown):Promise<{items:any[];revision:string;complete:boolean}>{
 if(typeof id!=='string'||!/^[A-Za-z0-9]{22}$/.test(id))return {items:[],revision:'none',complete:false};
 try{const snapshot=await savedSpotify(owner,'songs:'+id,async():Promise<{items:any[];warnings?:string[]}>=>{throw new Error('No saved source snapshot')});const items=Array.isArray(snapshot.items)?snapshot.items.filter((t:any)=>t&&typeof t.id==='string'&&/^spotify:[A-Za-z0-9]{22}$/.test(t.id)):[];const revision=createHash('sha256').update(JSON.stringify(items.map((t:any)=>[t.id,t.title,t.artist,t.durationMs]))).digest('hex');return {items,revision,complete:!snapshot.warnings?.some((w:string)=>/first 500|truncated/i.test(w))}}
 catch{return {items:[],revision:'none',complete:false}}
}
export async function downloadSourceSnapshot(owner:string,id:unknown):Promise<any[]>{return (await downloadSourceState(owner,id)).items}
