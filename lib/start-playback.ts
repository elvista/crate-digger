type Read=(path:string,options:{method:'PUT';body:string})=>Promise<unknown>;
/** Recover a missing active device once; never retry rate limits or other failures. */
export async function startPlayback(api:Read,deviceId:string,uri:string,positionMs:number,wait:(milliseconds:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
 const play=()=>api(`me/player/play?device_id=${encodeURIComponent(deviceId)}`,{method:'PUT',body:JSON.stringify({uris:[uri],position_ms:positionMs})});
 try{await play()}catch(e){const error=e as {status?:number;code?:string};if(error.status!==404||error.code!=='NO_ACTIVE_DEVICE')throw e;
  // SDK ready can precede registration with the Web API. Allow propagation once.
  await wait(750);
  await api('me/player',{method:'PUT',body:JSON.stringify({device_ids:[deviceId],play:false})});await play();
 }
}
