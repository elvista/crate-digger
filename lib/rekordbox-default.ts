import type {RekordboxPlaylist,PlaylistDestination} from './rekordbox-destinations';
export function defaultRekordboxDestination(playlists:RekordboxPlaylist[]):PlaylistDestination{
 const roots=playlists.filter(p=>p.name==='Crate Finds'&&p.parentId==='root'&&p.attribute===0);
 if(roots.length>1)throw new Error('Several root playlists are named Crate Finds. Keep one default playlist in Rekordbox, then retry.');
 const p=roots[0];return p?{mode:'existing',id:p.id,name:p.name,path:p.path}:{mode:'create',name:'Crate Finds',parentId:'root'};
}
