import 'server-only';
import {recoverAll} from '../scripts/download-runtime.mjs';
const state=globalThis as typeof globalThis & {crateDownloadSupervisor?:ReturnType<typeof setInterval>};
export async function startDownloadSupervisor(){
 if(process.env.VERCEL||state.crateDownloadSupervisor)return;
 let scanning=false;
 const scan=async()=>{if(scanning)return;scanning=true;try{await recoverAll()}finally{scanning=false}};
 await scan();
 state.crateDownloadSupervisor=setInterval(()=>{void scan().catch(()=>{})},30000);
 state.crateDownloadSupervisor.unref();
}
