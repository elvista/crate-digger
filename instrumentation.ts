export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'&&!process.env.VERCEL){
  const {startDownloadSupervisor}=await import('./lib/download-supervisor');
  await startDownloadSupervisor();
 }
}
