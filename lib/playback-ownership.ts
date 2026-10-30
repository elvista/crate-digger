export type PlaybackChannel={postMessage:(value:unknown)=>void;addEventListener:(kind:'message',listener:(event:{data:unknown})=>void)=>void;removeEventListener:(kind:'message',listener:(event:{data:unknown})=>void)=>void};
/** Only an explicit Play gesture asks another tab to relinquish its player. */
export function playbackOwnership(channel:PlaybackChannel,id:string,onTakeover:()=>void){
 const receive=(event:{data:unknown})=>{const value=event.data as {type?:string;id?:string};if(value?.type==='play-here'&&typeof value.id==='string'&&value.id!==id)onTakeover()};
 channel.addEventListener('message',receive);
 return{request:()=>channel.postMessage({type:'play-here',id}),close:()=>channel.removeEventListener('message',receive)};
}
