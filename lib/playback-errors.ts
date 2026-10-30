export type PlaybackRecovery='retry'|'activate'|'reconnect'|'wait';
export type PlaybackIssue={message:string;recovery:PlaybackRecovery;retryAt?:number};
export function playbackIssue(message:string,kind='',status?:number,retryAfter?:string|null,now=Date.now()):PlaybackIssue{
 if(status===429){const seconds=retryAfter&&/^\d+$/.test(retryAfter)?Number(retryAfter):60;return{message:'Spotify is temporarily limiting playback requests. Your queue is saved.',recovery:'wait',retryAt:now+Math.max(1,seconds)*1000}}
 if(kind==='account_error')return{message:'Spotify Premium is required. Check your subscription, then reconnect Spotify.',recovery:'reconnect'};
 if(status===401||kind==='authentication_error')return{message:'Your Spotify connection expired. Reconnect to keep listening.',recovery:'reconnect'};
 if(status===404)return{message:kind==='NO_ACTIVE_DEVICE'?'Spotify cannot find this browser player. Reconnect the player to continue.':'Spotify could not find this recording or player. Reconnect the player, or pass to another song.',recovery:'retry'};
 if(status===502||status===503)return{message:'Spotify could not be reached. Check your connection, then retry playback.',recovery:'retry'};
 if(status===403)return{message:'Spotify Premium and playback permission are required. Reconnect Spotify to check access.',recovery:'reconnect'};
 if(/autoplay|activate|notallowed|enable sound|blocked.*sound/i.test(message)||kind==='autoplay_failed')return{message:'Your browser needs permission to play sound. Press Play to enable it.',recovery:'activate'};
 if(/no list|not loaded|no active device|disconnected|device|initialization/i.test(message+' '+kind))return{message:'This browser lost its Spotify player connection. Try reconnecting the player.',recovery:'retry'};
 return{message:'Spotify could not play this recording. Try again, or pass to another song.',recovery:'retry'};
}
/** Pausing a newly connected SDK device can reject before its first track is loaded. */
export async function pauseBeforeStarting(player:{pause:()=>Promise<void>}|null){try{await player?.pause()}catch{/* Starting the new recording establishes the device's playback list. */}}
