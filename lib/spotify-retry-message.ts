/** Shared server error copy, retained by all song and playlist clients. */
export function spotifyRetryDetails(message:string,status:number,retryAfter?:string,now=Date.now()){
 const limited=(status===429&&(/spotify|quota/i.test(message)||!!retryAfter))||/spotify.*quota|quota.*spotify/i.test(message);
 if(!limited)return {error:message};
 let seconds=retryAfter&&/^\d+$/.test(retryAfter)?Number(retryAfter):retryAfter?Math.ceil((Date.parse(retryAfter)-now)/1000):NaN;
 if(!Number.isFinite(seconds)||seconds<=0)return {error:'Spotify has asked us to wait, but hasn’t said how long. Please try again later.'};
 seconds=Math.max(1,Math.ceil(seconds));
 const retryAt=now+seconds*1000;
 const totalMinutes=Math.ceil(seconds/60),hours=Math.floor(totalMinutes/60),minutes=totalMinutes%60;
 const parts=seconds<60?[`${seconds} ${seconds===1?'second':'seconds'}`]:[hours?`${hours} ${hours===1?'hour':'hours'}`:'',minutes?`${minutes} ${minutes===1?'minute':'minutes'}`:''].filter(Boolean);
 return {error:`Spotify has asked us to wait. Try again in ${seconds>=60?'about ':''}${parts.join(' and ')}.`,retryAt};
}
