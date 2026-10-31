import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {requireOrigin,requireLocalUser,noStore} from '@/lib/route-auth';
import {defaultDownloadFolder,localSettingsStore,validateDownloadFolder} from '@/lib/local-download-settings';
const run=promisify(execFile),settings=localSettingsStore();
export const runtime='nodejs';
export async function POST(request:Request){
 if(process.env.VERCEL||!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.get('host')||''))return Response.json({local:false},{headers:noStore});
 let owner:string;
 try{requireOrigin(request);owner=(await requireLocalUser()).userId;}
 catch{return Response.json({error:'Sign in from the local app to manage local settings.'},{status:403,headers:noStore});}
 try{
  const text=await request.text();if(text.length>12000)throw new Error('Settings request is too large.');
  const body=JSON.parse(text);
  if(body.action==='read')return Response.json({local:true,settings:await settings.read(owner)},{headers:noStore});
  if(body.action==='save')return Response.json({local:true,settings:await settings.save(owner,body)},{headers:noStore});
  if(body.action==='default'){
   const folder=defaultDownloadFolder();await mkdir(folder,{recursive:true});
   return Response.json({folder:await validateDownloadFolder(folder)},{headers:noStore});
  }
  if(body.action==='browse'){
   if(process.platform!=='darwin')throw new Error('Enter the folder path on this computer.');
   try{const {stdout}=await run('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "Choose where Crate Digger saves MP3s")'],{timeout:120000,maxBuffer:16384});return Response.json({folder:await validateDownloadFolder(stdout.trim())},{headers:noStore});}
   catch(e){if(String((e as {stderr?:string}).stderr).includes('-128'))return Response.json({cancelled:true},{headers:noStore});throw new Error('Could not open the folder picker. Enter a folder path instead.');}
  }
  if(body.action==='reveal'){
   const saved=await settings.read(owner);const folder=await validateDownloadFolder(saved.downloadFolder);
   if(process.platform!=='darwin')throw new Error('Show in Finder is available on macOS.');
   await run('/usr/bin/open',[folder],{timeout:10000});return Response.json({ok:true},{headers:noStore});
  }
  throw new Error('Unknown settings action.');
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Local settings could not be saved.'},{status:400,headers:noStore});}
}
