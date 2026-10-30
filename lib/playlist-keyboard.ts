/** Playlist navigation wraps so the last destination never traps the keyboard. */
export function playlistFocusIndex(key:string,current:number,count:number):number|null{
 if(count<1)return null;
 if(key==='Home')return 0;
 if(key==='End')return count-1;
 if(key==='ArrowDown')return current<0?0:(current+1)%count;
 if(key==='ArrowUp')return current<0?count-1:(current-1+count)%count;
 return null;
}
