import 'server-only';
import {rekordboxRequest} from './rekordbox';
import {destinationStore,resolvePlaylistDestination,type LibraryPlaylists,type SourcePlaylist,type PlaylistDestination} from './rekordbox-destinations';
export async function resolveRekordboxDestination(owner:string,source:SourcePlaylist,libraryPath:string|null){
 const library=await rekordboxRequest<LibraryPlaylists>('playlists',{libraryPath});
 const store=destinationStore(),saved=await store.read(owner,library,source.id);
 const resolution=resolvePlaylistDestination(source,library.playlists,saved);
 if(resolution.status==='ready'){const written=await store.save(owner,library,source,resolution.destination,saved);if(!written)return {library,resolution:resolvePlaylistDestination(source,library.playlists,await store.read(owner,library,source.id))};}
 return {library,resolution};
}
export async function chooseRekordboxDestination(owner:string,source:SourcePlaylist,libraryPath:string|null,choice:unknown){
 const library=await rekordboxRequest<LibraryPlaylists>('playlists',{libraryPath});
 const value=choice as Partial<PlaylistDestination>&{id?:string;name?:string};let destination:PlaylistDestination;
 if(value?.mode==='existing'){
  const playlist=library.playlists.find(p=>p.id===value.id&&p.attribute===0);
  if(!playlist)throw new Error('Choose an existing ordinary Rekordbox playlist.');
  destination={mode:'existing',id:playlist.id,name:playlist.name,path:playlist.path};
 }else if(value?.mode==='create'&&typeof value.name==='string'&&value.name.trim()&&value.name.length<300&&!value.name.includes('\0')){
  destination={mode:'create',name:value.name.trim(),parentId:'root'};
 }else throw new Error('Choose a playlist or enter a new playlist name.');
 await destinationStore().save(owner,library,source,destination);
 return {library,resolution:{status:'ready' as const,source,destination,mapped:true}};
}
