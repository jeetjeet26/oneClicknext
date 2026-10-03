'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {Dialog,DialogContent} from '@/components/ui/dialog'
import {socialJson} from '@/utils/forgestudio/connections-client'
type Config={credentialStorageAvailable:boolean;hasConfig:boolean;disabled:boolean;version:number;configSource:string|null;config:{appId:string}|null}
type Props={propertyId:string;platform:string;onClose:()=>void;onConfigured:()=>void}
const names:Record<string,string>={meta:'Meta (Facebook and Instagram)',linkedin:'LinkedIn',tiktok:'TikTok',x:'X'}
export function SocialAppSetup(props:Props){return <Setup key={`${props.propertyId}:${props.platform}`} {...props}/>}
function Setup({propertyId,platform,onClose,onConfigured}:Props){
 const [saved,setSaved]=useState<Config|null>(null),[appId,setAppId]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('')
 const controller=useRef<AbortController|null>(null),mounted=useRef(true),pending=useRef<Record<string,unknown>|null>(null)
 const close=useRef(()=>{});useEffect(()=>{close.current=()=>{if(!busy)onClose()}},[busy,onClose]);const changeOpen=useCallback((open:boolean)=>{if(!open)close.current()},[])
 const reload=useCallback(async()=>{controller.current?.abort();const c=new AbortController();controller.current=c;setLoading(true);setError('');try{const data=await socialJson<Config>(`/api/forgestudio/social/config?propertyId=${propertyId}&platform=${platform}`,{signal:c.signal});if(!c.signal.aborted){setSaved(data);setAppId(data.config?.appId??'');setSecret('');pending.current=null}}catch(e){if(!c.signal.aborted){setSaved(null);setError(e instanceof Error?e.message:'App setup could not be loaded.')}}finally{if(!c.signal.aborted)setLoading(false)}},[propertyId,platform])
 useEffect(()=>{mounted.current=true;void reload();return()=>{mounted.current=false;controller.current?.abort()}},[reload])
 async function decide(action:'save'|'disable'){
  if(!saved||busy)return
  const body=pending.current??{propertyId,platform,requestId:crypto.randomUUID(),expectedVersion:saved.version,action,...action==='save'?{appId:appId.trim(),appSecret:secret}:{}};pending.current=body;setBusy(true);setError('');setMessage('')
  try{await socialJson('/api/forgestudio/social/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(mounted.current){pending.current=null;setSecret('');setMessage(body.action==='disable'?'App setup disabled. Existing accounts can still be disconnected below.':'App setup saved. Authorization is a separate step.');onConfigured();await reload()}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'The save could not be confirmed. Retry the same decision.')}finally{if(mounted.current)setBusy(false)}
 }
 return <Dialog open onOpenChange={changeOpen}><DialogContent aria-label={`${names[platform]} app setup`} className="max-h-[90vh] max-w-xl space-y-4 overflow-auto p-6 text-slate-900 dark:text-white">
  <div className="flex items-center justify-between gap-4"><h3 className="text-lg font-semibold">{names[platform]} app setup</h3><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-2">Close</button></div>
  <p className="text-sm text-slate-500">Save the provider app credentials for this property. Changing or disabling them closes unfinished authorization requests. Existing provider consent is not revoked.</p>
  {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}{message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
  <button type="button" disabled={busy||loading} onClick={()=>void reload()} className="text-sm underline">Reload saved app setup</button>
  {loading?<p role="status">Loading saved app setup…</p>:saved&&<form onSubmit={e=>{e.preventDefault();void decide('save')}} className="space-y-4">
   {!saved.credentialStorageAvailable&&<p role="status" className="text-sm text-amber-700">Secure credential storage is not configured on this server. Saving new app credentials is unavailable.</p>}
   <p className="text-sm">{saved.disabled?'Disabled for this property':saved.hasConfig?`Configured from ${saved.configSource==='environment'?'server settings':'saved property settings'}`:'No app credentials saved'}</p>
   <div><label htmlFor="social-app-id" className="block text-sm font-medium">App or client ID</label><input id="social-app-id" value={appId} onChange={e=>setAppId(e.target.value)} disabled={busy||!!pending.current} required maxLength={256} className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2"/></div>
   <div><label htmlFor="social-app-secret" className="block text-sm font-medium">App or client secret</label><input id="social-app-secret" type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} disabled={busy||!!pending.current} required maxLength={4096} className="mt-1 w-full rounded-lg border bg-transparent px-3 py-2"/><p className="mt-1 text-xs text-slate-500">The saved secret is never shown. Enter the complete new secret to replace it.</p></div>
   <div className="flex flex-wrap gap-3">{pending.current?<button type="button" disabled={busy} onClick={()=>void decide(pending.current?.action==='disable'?'disable':'save')} className="rounded-lg bg-violet-600 px-4 py-2 text-white">{busy?'Saving…':'Retry same app decision'}</button>:<><button type="submit" disabled={busy||!saved.credentialStorageAvailable||!appId.trim()||!secret} className="rounded-lg bg-violet-600 px-4 py-2 text-white disabled:opacity-50">Save app setup</button><button type="button" disabled={busy||saved.disabled} onClick={()=>void decide('disable')} className="rounded-lg border px-4 py-2">Disable app setup</button></>}</div>
  </form>}
 </DialogContent></Dialog>
}
