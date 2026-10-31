import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileLock} from '../scripts/download-runtime.mjs';
export type SourcePlaylist={id:string;name:string};
export type RekordboxPlaylist={id:string;name:string;path:string;parentId:string;attribute:number};
export type LibraryPlaylists={libraryId:string;libraryPath:string;playlists:RekordboxPlaylist[]};
export type PlaylistDestination={mode:'existing';id:string;name:string;path:string}|{mode:'create';name:string;parentId:'root'};
export type SavedPlaylistMapping={sourceId:string;sourceName:string;destination:PlaylistDestination};
export type DestinationResolution={status:'ready';source:SourcePlaylist;destination:PlaylistDestination;mapped:boolean}|{status:'choose';source:SourcePlaylist;reason:'ambiguous'|'intelligent'|'removed';suggestedName:string};
export function validateSourcePlaylist(value:unknown):SourcePlaylist{
 const p=value as Partial<SourcePlaylist>|null;
 if(!p||typeof p.id!=='string'||! /^(?:[A-Za-z0-9]{22}|rekordbox:[0-9]+)$/.test(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>299||p.name.includes('\0'))throw new Error('Choose a source playlist before downloading.');
 return {id:p.id,name:p.name.trim()};
}
export function resolvePlaylistDestination(source:SourcePlaylist,playlists:RekordboxPlaylist[],saved:SavedPlaylistMapping|null):DestinationResolution{
 if(saved?.destination.mode==='existing'){
  const id=saved.destination.id;const p=playlists.find(p=>p.id===id&&p.attribute===0);
  if(p)return {status:'ready',source,destination:{mode:'existing',id:p.id,name:p.name,path:p.path},mapped:true};
  return {status:'choose',source,reason:'removed',suggestedName:source.name};
 }
 if(saved?.destination.mode==='create'){
  // A later import may have created it before its ID receipt was persisted.
  // Never bind this intent to a same-name playlist without an explicit ID.
  return {status:'ready',source,destination:saved.destination,mapped:true};
 }
 if(source.id.startsWith('rekordbox:')){const p=playlists.find(p=>p.id===source.id.slice(10)&&p.attribute===0);if(p)return {status:'ready',source,destination:{mode:'existing',id:p.id,name:p.name,path:p.path},mapped:false}}
 const same=playlists.filter(p=>p.name.normalize('NFC').trim()===source.name.normalize('NFC'));
 const ordinary=same.filter(p=>p.attribute===0);
 if(ordinary.length===1){const p=ordinary[0];return {status:'ready',source,destination:{mode:'existing',id:p.id,name:p.name,path:p.path},mapped:false}}
 if(ordinary.length>1)return {status:'choose',source,reason:'ambiguous',suggestedName:source.name};
 if(same.some(p=>p.attribute===4))return {status:'choose',source,reason:'intelligent',suggestedName:`${source.name.slice(0,270)} (Crate Digger)`};
 return {status:'ready',source,destination:{mode:'create',name:source.name,parentId:'root'},mapped:false};
}
export function destinationMappingPath(owner:string,library:Pick<LibraryPlaylists,'libraryId'|'libraryPath'>,sourceId:string,root=join(process.cwd(),'.data','rekordbox-mappings')){return join(root,createHash('sha256').update(JSON.stringify([owner,library.libraryId,library.libraryPath,sourceId])).digest('hex')+'.json')}
export function destinationStore(root=join(process.cwd(),'.data','rekordbox-mappings')){
 const file=(owner:string,library:Pick<LibraryPlaylists,'libraryId'|'libraryPath'>,sourceId:string)=>destinationMappingPath(owner,library,sourceId,root);
 return {
  async read(owner:string,library:LibraryPlaylists,sourceId:string):Promise<SavedPlaylistMapping|null>{
   try{const value=JSON.parse(await readFile(file(owner,library,sourceId),'utf8'));
    if(value.sourceId!==sourceId||typeof value.sourceName!=='string'||!['create','existing'].includes(value.destination?.mode)||typeof value.destination.name!=='string'||!value.destination.name.trim()||(value.destination.mode==='existing'&&(typeof value.destination.id!=='string'||typeof value.destination.path!=='string'))||(value.destination.mode==='create'&&value.destination.parentId!=='root'))throw new Error('Invalid saved playlist mapping.');return value;
   }catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}
  },
  async save(owner:string,library:LibraryPlaylists,source:SourcePlaylist,destination:PlaylistDestination,expected?:SavedPlaylistMapping|null){
   await mkdir(root,{recursive:true,mode:0o700});const path=file(owner,library,source.id),temp=path+'.'+randomUUID()+'.tmp';
   let unlock;try{unlock=await fileLock(path+'.lock')}catch{throw new Error('This playlist destination is being updated. Retry shortly.')}
   try{
    if(expected!==undefined){let current=null;try{current=JSON.parse(await readFile(path,'utf8'))}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
     if(JSON.stringify(current)!==JSON.stringify(expected))return false;
    }
    const f=await open(temp,'wx',0o600);try{await f.writeFile(JSON.stringify({sourceId:source.id,sourceName:source.name,destination}));await f.sync()}finally{await f.close()}
    await rename(temp,path);const dir=await open(root,'r');try{await dir.sync()}finally{await dir.close()}return true;
   }finally{try{await rm(temp,{force:true})}finally{await unlock()}}

  }
 };
}
