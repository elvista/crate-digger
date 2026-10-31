'use client';
import {useEffect,useState} from 'react';
import {FolderOpen,RefreshCw} from 'lucide-react';
import type {LocalDownloadSettings as Settings} from '@/lib/local-download-settings';
import type {RekordboxStatus} from '@/lib/rekordbox';
import styles from './LocalDownloadSettings.module.css';
async function request(action:string,values:Record<string,unknown>={}){
 const r=await fetch('/api/local-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...values})});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;
}
export default function LocalDownloadSettings(){
 const [local,setLocal]=useState<boolean|null>(null),[saved,setSaved]=useState<Settings|null>(null),[folder,setFolder]=useState(''),[library,setLibrary]=useState(''),[autoImport,setAutoImport]=useState(true);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState<RekordboxStatus|null>(null),[checking,setChecking]=useState(false),[connectionError,setConnectionError]=useState('');
 useEffect(()=>{let live=true;request('read').then(d=>{if(!live)return;setLocal(d.local);if(d.settings){setSaved(d.settings);setFolder(d.settings.downloadFolder);setLibrary(d.settings.libraryPath||'');setAutoImport(d.settings.autoImport!==false)}}).catch(e=>{if(live){setLocal(true);setError(e.message)}});return()=>{live=false}},[]);
 async function check(){setChecking(true);setConnectionError('');try{const r=await fetch('/api/rekordbox/status',{method:'POST'});const d=await r.json();if(!r.ok)throw new Error(d.error);setStatus(d)}catch(e){setStatus(null);setConnectionError((e as Error).message)}finally{setChecking(false)}}
 async function act(action:'browse'|'default'|'save'|'reveal'){
  setBusy(true);setError('');setMessage('');try{const d=await request(action,{downloadFolder:folder,libraryPath:library.trim()||null,autoImport});if(d.cancelled)return;
   if(d.folder){setFolder(d.folder);setMessage('Folder selected. Save to use it.');}
   if(d.settings){setSaved(d.settings);setFolder(d.settings.downloadFolder);setLibrary(d.settings.libraryPath||'');setAutoImport(d.settings.autoImport!==false);setStatus(null);setMessage('Saved on this Mac.');try{localStorage.setItem('crate-local-settings-revision',d.settings.revision)}catch{}window.dispatchEvent(new Event('crate:local-settings-changed'));}
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const dirty=!!saved&&(folder!==saved.downloadFolder||(library.trim()||null)!==saved.libraryPath||autoImport!==saved.autoImport);
 return <section className={styles.panel} aria-labelledby="local-download-heading"><h2 id="local-download-heading">Downloads & Rekordbox</h2>
 {local===null?<p role="status">Loading local settings…</p>:local===false?<p>Open the local app on your Mac to choose a download folder and connect Rekordbox.</p>:<>
 <label htmlFor="download-folder">MP3 folder</label><div className={styles.folder}><input id="download-folder" value={folder} onChange={e=>setFolder(e.target.value)} placeholder="/Users/you/Music/Crate Digger" disabled={!saved||busy}/><button onClick={()=>act('browse')} disabled={!saved||busy}><FolderOpen size={16}/>Choose folder</button></div>
 <div className={styles.actions}><button onClick={()=>act('default')} disabled={!saved||busy}>Use default folder</button><button onClick={()=>act('reveal')} disabled={!saved||busy}>Show saved folder in Finder</button></div>
 <label className={styles.toggle}><input type="checkbox" checked={autoImport} disabled={!saved||busy} onChange={e=>setAutoImport(e.target.checked)}/>Automatically add downloads to Rekordbox</label>
 <details className={styles.advanced}><summary>Rekordbox library location</summary><label htmlFor="rekordbox-path">Database path (leave empty for automatic detection)</label><input id="rekordbox-path" value={library} onChange={e=>setLibrary(e.target.value)} placeholder="Automatically detect master.db" disabled={!saved||busy}/><p>This changes Crate Digger’s connection. It does not switch Rekordbox’s active library.</p></details>
 <div className={styles.footer}><button className={styles.save} onClick={()=>act('save')} disabled={!saved||busy||!folder.trim()}>{busy?'Working…':'Save settings'}</button><span role="status">{message||(dirty?'Unsaved changes':'')}</span></div>
 {error&&<p className={styles.error} role="alert">{error}</p>}
 <div className={styles.connection}><div className={styles.connectionHeading}><h3>Rekordbox connection</h3><button disabled={checking||busy||dirty||!saved} onClick={check}><RefreshCw size={14}/>{checking?'Checking…':status?'Check again':'Check connection'}</button></div>
 {dirty&&<p>Save changes before checking the connection.</p>}
 {status&&<><p>{!status.schemaSupported?'Library schema is not supported.':status.processCheckError?'Library readable; process status unavailable.':status.blockingProcesses?.length?'Library connected · Rekordbox is open':'Library connected'}</p><p className={styles.path}>{status.libraryPath}</p>{status.versions?.length>0&&<p>Rekordbox {status.versions.join(', ')}</p>}{status.usingOverride&&!status.overrideMatchesActiveLibrary&&<p className={styles.error}>This is different from the library currently configured in Rekordbox.</p>}{!status.schemaSupported&&<p className={styles.error}>Missing fields: {status.missing.join(', ')}</p>}</>}
 {connectionError&&<p className={styles.error} role="alert">{connectionError}</p>}
 <p>Downloads save MP3s directly to this folder. Automatic imports wait until Rekordbox and its background agent are closed. You can also retry an import without downloading again.</p></div>
 </>}
 </section>;
}
