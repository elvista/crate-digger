import {normalizePlaylist} from './discovery-core.ts';
import type {Playlist} from './discovery-types.ts';
export class PlaylistExportError extends Error { status:number; constructor(message:string,status=400){super(message);this.status=status;} }
export type ExportInput={operationId:string;uris:string[];mode:'new'|'existing'|'finds';name:string;playlistId:string;public:boolean};
export type ExportResult={playlistId:string;url:string;added:number;alreadyPresent:number;count?:number;playlist?:Playlist};
export type ExportReceipt={signature:string;phase:'creating'|'adding'|'done';playlistId?:string;result?:ExportResult};
export function parseExport(value:unknown):ExportInput {
 const d=value as Record<string,unknown>;
 if(!d||typeof d!=='object'||typeof d.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(d.operationId))throw new PlaylistExportError('Invalid save request. Reopen Save to Spotify.');
 if(!Array.isArray(d.uris)||!d.uris.length||d.uris.length>5000||!d.uris.every(u=>typeof u==='string'&&/^spotify:track:[A-Za-z0-9]{22}$/.test(u)))throw new PlaylistExportError('Choose between 1 and 5,000 valid Spotify tracks.');
 if(d.mode!=='new'&&d.mode!=='existing'&&d.mode!=='finds')throw new PlaylistExportError('Choose a new or existing playlist.');
 const name=typeof d.name==='string'?d.name.trim():'';const playlistId=typeof d.playlistId==='string'?d.playlistId:'';
 if(d.mode==='new'&&(!name||name.length>100))throw new PlaylistExportError('Enter a playlist name, up to 100 characters.');
 if(d.mode==='existing'&&!/^[A-Za-z0-9]{22}$/.test(playlistId))throw new PlaylistExportError('Choose one of your Spotify playlists.');
 if(d.public!==undefined&&typeof d.public!=='boolean')throw new PlaylistExportError('Choose a valid playlist visibility.');
 return{operationId:d.operationId,uris:[...new Set(d.uris as string[])],mode:d.mode,name:d.mode==='finds'?'Crate Finds':name,playlistId:d.mode==='finds'?'':playlistId,public:d.mode==='finds'?false:d.public===true};
}
type API=(path:string,options?:{method?:'GET'|'POST';body?:string})=>Promise<any>;
// Receipts bind retries to the exact request. Existing-item reads recover safely
// from a successful append whose HTTP response was lost.
export async function exportPlaylist(input:ExportInput,userId:string,api:API,load:()=>Promise<ExportReceipt|null>,save:(receipt:ExportReceipt)=>Promise<void>,knownFindsId?:string):Promise<ExportResult>{
 const signature=JSON.stringify({uris:input.uris,mode:input.mode,name:input.name,playlistId:input.playlistId,public:input.public});
 let receipt=await load();
 if(receipt&&receipt.signature!==signature)throw new PlaylistExportError('This save request changed. Reopen Save to Spotify.',409);
 if(receipt?.phase==='done'&&receipt.result)return receipt.result;
 if(receipt?.phase==='creating'&&input.mode!=='finds')throw new PlaylistExportError('Spotify may have created this playlist, but confirmation was lost. Check Spotify and choose that playlist under Existing playlist before retrying.',409);
 let playlistId=receipt?.playlistId||input.playlistId;
 let knownPlaylist:any=null;
 if(input.mode==='finds'&&!playlistId&&knownFindsId&&/^[A-Za-z0-9]{22}$/.test(knownFindsId)){
  try{const p=await api(`playlists/${knownFindsId}`);if(p?.owner?.id===userId&&p.name==='Crate Finds'){playlistId=knownFindsId;knownPlaylist=p}}
  catch(e){if((e as {status?:number}).status!==404)throw e}
 }

 if(input.mode==='finds'&&!playlistId){
  let offset=0,more=true;
  while(more&&offset<10000){
   const page=await api(`me/playlists?limit=50&offset=${offset}`);
   if(!Array.isArray(page?.items))throw new PlaylistExportError('Could not check your Spotify playlists. Try saving again.',502);
   const found=page.items.find((p:any)=>p?.owner?.id===userId&&p?.name==='Crate Finds'&&/^[A-Za-z0-9]{22}$/.test(p.id));
   if(found){playlistId=found.id;break}
   more=typeof page.next==='string'&&page.items.length>0;offset+=50;
  }
  if(!playlistId&&more)throw new PlaylistExportError('Could not finish checking your playlists. No new playlist was created.',502);
  if(!playlistId&&receipt?.phase==='creating')throw new PlaylistExportError('Spotify may still be creating Crate Finds. Wait a moment, then retry; another playlist will not be created.',409);
  if(playlistId&&receipt?.phase==='creating'){receipt={signature,phase:'adding',playlistId};await save(receipt)}
 }
 if((input.mode==='new'||input.mode==='finds')&&!playlistId){
  receipt={signature,phase:'creating'};await save(receipt);
  const created=await api('me/playlists',{method:'POST',body:JSON.stringify({name:input.name,public:input.public,description:'Tracks saved from Crate.'})});
  if(typeof created?.id!=='string'||!/^[A-Za-z0-9]{22}$/.test(created.id))throw new PlaylistExportError('Spotify did not confirm the new playlist. Check Spotify before retrying.',502);
  playlistId=created.id;receipt={signature,phase:'adding',playlistId};await save(receipt);
 }
 const playlist=knownPlaylist??await api(`playlists/${playlistId}`);
 if(playlist?.owner?.id!==userId)throw new PlaylistExportError('Choose a playlist owned by your Spotify account.',403);
 const existing=new Set<string>();let offset=0,itemCount=0,more=true;
 while(more&&offset<10000){
  const page=await api(`playlists/${playlistId}/items?limit=50&offset=${offset}&additional_types=track`);
  if(!Array.isArray(page?.items))throw new PlaylistExportError('Could not check the playlist contents. Nothing more was added; try again.',502);
  itemCount+=page.items.length;
  for(const entry of page.items){const item=entry?.item??entry?.track;if(typeof item?.uri==='string')existing.add(item.uri);else if(typeof item?.id==='string')existing.add(`spotify:track:${item.id}`);}
  more=typeof page.next==='string'&&page.items.length>0;offset+=50;
 }
 if(more)throw new PlaylistExportError('This playlist is too large to check safely. Choose a smaller playlist or create a new one.',400);
 if(!receipt){receipt={signature,phase:'adding',playlistId};await save(receipt);}
 const pending=input.uris.filter(uri=>!existing.has(uri));
 for(let i=0;i<pending.length;i+=100)await api(`playlists/${playlistId}/items`,{method:'POST',body:JSON.stringify({uris:pending.slice(i,i+100)})});
 const metadata=normalizePlaylist(playlist);
 const count=itemCount+pending.length;
 const result={playlistId,url:`https://open.spotify.com/playlist/${playlistId}`,added:pending.length,alreadyPresent:input.uris.length-pending.length,count,...(metadata?{playlist:{...metadata,count}}:{})};
 await save({signature,phase:'done',playlistId,result});return result;
}
