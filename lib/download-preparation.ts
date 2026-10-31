export class DownloadPreparationError extends Error{}
type Track={spotifyTrackId?:string;videoId?:string;acquisition:'download'|'reuse';title:string;artist:string;durationMs?:number};
type Resolution={status:string;message?:string;recording?:{videoId:string;filename:string;recordingId?:string}};
/** Bind one download job to the explicitly checked source IDs and recording identities. */
export async function prepareDownloadTracks<T extends Track>(selected:T[],source:Map<string,T>,additionalExistingIds:string[],resolve:(track:T)=>Promise<Resolution>):Promise<T[]>{
 const requested=[...selected];
 for(const id of new Set(additionalExistingIds)){
  if(requested.some(track=>track.spotifyTrackId===id))continue;
  const track=source.get(id);if(!track)throw new DownloadPreparationError('The source playlist changed since the file check. Refresh Downloads before starting.');
  const result=await resolve({...track,spotifyTrackId:id});
  if(result.status!=='available'||!result.recording)throw new DownloadPreparationError('An existing recording changed since the file check. Refresh Downloads before starting.');
  requested.push({...track,spotifyTrackId:id,videoId:result.recording.videoId,acquisition:'reuse'});
 }
 const prepared:T[]=[],seen=new Set<string>();
 for(const track of requested){
  const result=await resolve(track);
  if(!['available','missing'].includes(result.status))throw new DownloadPreparationError(result.message||'Review the existing recording.');
  if(track.acquisition==='reuse'&&result.status!=='available')throw new DownloadPreparationError('An existing file is missing. Refresh the playlist.');
  const videoId=result.recording?.videoId||track.videoId;
  if(!videoId)throw new DownloadPreparationError('Choose a YouTube version for this track.');
  const key=result.recording?.recordingId||result.recording?.filename||track.spotifyTrackId||videoId;
  if(seen.has(key))continue;seen.add(key);
  prepared.push({...track,videoId,acquisition:result.status==='available'?'reuse':'download'});
 }
 return prepared;
}
