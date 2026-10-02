"use client"
import {useCallback,useEffect,useRef,useState} from 'react'
type Provider='google'|'microsoft'
type Capability='calendar'|'email'
type Invite={id:string;provider:Provider;requested_capabilities:Capability[];expires_at:string;created_at:string;state:'pending'|'used'|'expired'|'revoked';recoverable:boolean}
const labels={pending:'Pending',used:'Used',expired:'Expired',revoked:'Revoked'}
export function IntegrationInvitesPanel({propertyId,defaultCapability='email'}:{propertyId:string;defaultCapability?:Capability}) {
 const [provider,setProvider]=useState<Provider>('google'),[capability,setCapability]=useState<string>(defaultCapability)
 const [rows,setRows]=useState<Invite[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[readError,setReadError]=useState('')
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[link,setLink]=useState<{id:string;url:string;expires:string}|null>(null)
 const [unconfirmedRevoke,setUnconfirmedRevoke]=useState<Invite|null>(null)
 const draftKey=JSON.stringify([propertyId,provider,capability==='both'?['calendar','email']:[capability]])
 const pending=useRef<Record<string,string>>({}),read=useRef<AbortController|null>(null),mounted=useRef(true)
 useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;read.current?.abort()}},[])
 const load=useCallback(async(after:string|null=null)=>{
  read.current?.abort();const control=new AbortController();read.current=control;setLoading(true);setReadError('')
  try{const response=await fetch(`/api/lumaleasing/integration-invites?propertyId=${propertyId}${after?`&cursor=${encodeURIComponent(after)}`:''}`,{signal:control.signal,cache:'no-store'});const data=await response.json();if(!response.ok||!Array.isArray(data.invites))throw new Error('unavailable')
   if(!control.signal.aborted){setRows(previous=>after?[...new Map([...previous,...data.invites].map(row=>[row.id,row])).values()]:data.invites);setCursor(data.nextCursor||null);setLink(current=>current&&data.invites.some((row:Invite)=>row.id===current.id&&row.state!=='pending')?null:current)}
  }catch{if(!control.signal.aborted)setReadError('Authorization links are unavailable. Retry to load their current status.')}
  finally{if(!control.signal.aborted)setLoading(false)}
 },[propertyId])
 useEffect(()=>{void load()},[load])
 async function create(existing?:Invite){
  if(busy)return
  const selectedProvider=existing?.provider||provider,capabilities=existing?.requested_capabilities||(capability==='both'?['calendar','email']:[capability])
  const key=JSON.stringify([propertyId,selectedProvider,capabilities]);const requestId=existing?.id||(pending.current[key]??=crypto.randomUUID())
  setBusy(true);setError('');setMessage('');setLink(null)
  try{const response=await fetch('/api/lumaleasing/integration-invites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,provider:selectedProvider,capabilities,requestId})});const data=await response.json()
   if(!response.ok||data.actionEventId!==requestId||!data.url||!data.invite?.expires_at)throw new Error(data.error||'Creation could not be confirmed. Retry to recover the same link.')
   if(!mounted.current)return
   delete pending.current[key];setLink({id:requestId,url:data.url,expires:data.invite.expires_at});setMessage(data.replayed?'Recovered the saved authorization link.':'Authorization link created and recorded.');await load()
  }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Creation could not be confirmed. Retry the same request.')}
  finally{if(mounted.current)setBusy(false)}
 }
 async function revoke(invite:Invite){
  if(busy)return
  const key=`revoke/${invite.id}`,requestId=pending.current[key]??=crypto.randomUUID();setBusy(true);setError('');setMessage('')
  try{const response=await fetch(`/api/lumaleasing/integration-invites/${invite.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,requestId})});const data=await response.json()
   if(!mounted.current)return
   if(data.actionEventId===requestId&&data.state==='already_used'){delete pending.current[key];setUnconfirmedRevoke(null);setError(data.error||'This link was already used. Manage removal from the connected account.');await load();return}
   if(!response.ok||data.state!=='revoked'||data.actionEventId!==requestId)throw new Error(data.error||'Revocation could not be confirmed. Retry the same request.')
   delete pending.current[key];setUnconfirmedRevoke(null);setLink(current=>current?.id===invite.id?null:current);setMessage('Authorization link revoked and recorded.');await load()
  }catch(reason){if(mounted.current){setUnconfirmedRevoke(invite);setError(reason instanceof Error?reason.message:'Revocation could not be confirmed. Retry the same request.');await load()}}
  finally{if(mounted.current)setBusy(false)}
 }
 async function copy(){if(!link)return;try{await navigator.clipboard.writeText(link.url);setMessage('Authorization link copied.')}catch{setError('Copy is unavailable. Select and copy the link below.')}}
 return <section aria-label="Client authorization links" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
  <div><h3 className="font-semibold text-slate-900">Client authorization links</h3><p className="mt-1 text-sm text-slate-600">A client can connect the selected account for this property without a console login. Links can be used once and expire after seven days.</p></div>
  <div className="flex flex-wrap items-end gap-3">
   <label className="text-sm text-slate-700">Provider<select aria-label="Link provider" value={provider} onChange={event=>setProvider(event.target.value as Provider)} disabled={busy} className="ml-2 rounded border p-2"><option value="google">Google</option><option value="microsoft">Microsoft</option></select></label>
   <label className="text-sm text-slate-700">Access<select aria-label="Link access" value={capability} onChange={event=>setCapability(event.target.value)} disabled={busy} className="ml-2 rounded border p-2"><option value="email">Email</option><option value="calendar">Calendar</option><option value="both">Calendar and email</option></select></label>
   <button type="button" disabled={busy||loading||!!readError} onClick={()=>void create()} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Saving link decision…':pending.current[draftKey]?'Retry link creation':'Create client link'}</button>
  </div>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
  {unconfirmedRevoke&&<button type="button" disabled={busy} onClick={()=>void revoke(unconfirmedRevoke)} className="text-sm text-red-700 underline disabled:opacity-50">Retry revocation</button>}
  {link&&<div className="space-y-2 rounded border border-slate-200 p-3"><label className="block text-sm">Authorization link<input aria-label="Authorization link" readOnly value={link.url} onFocus={event=>event.target.select()} className="mt-1 w-full rounded border p-2 text-sm"/></label><p className="text-xs text-slate-600">Expires {new Date(link.expires).toLocaleString()}. Share with the person who owns the account.</p><button type="button" onClick={()=>void copy()} className="text-sm underline">Copy link</button></div>}
  {readError&&<div role="alert" className="text-sm text-red-700"><p>{readError}</p><button type="button" onClick={()=>void load()} className="underline">Retry authorization links</button></div>}
  {loading&&<p role="status" className="text-sm text-slate-600">Loading authorization links…</p>}
  {!loading&&!readError&&rows.length===0&&<p className="text-sm text-slate-500">No client authorization links yet.</p>}
  <ul className="space-y-2">{rows.map(invite=><li key={invite.id} className="rounded border border-slate-200 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{invite.provider==='google'?'Google':'Microsoft'} · {invite.requested_capabilities.join(' and ')}</span><strong>{labels[invite.state]}</strong></div><p className="mt-1 text-xs text-slate-500">Created {new Date(invite.created_at).toLocaleString()} · Expires {new Date(invite.expires_at).toLocaleString()}</p>{invite.state==='used'?<p className="mt-2 text-xs text-slate-600">Already authorized. Manage removal from the connected account.</p>:invite.state==='pending'&&<div className="mt-2 flex gap-4">{invite.recoverable&&<button type="button" disabled={busy||!!readError} onClick={()=>void create(invite)} className="underline disabled:opacity-50">Recover link</button>}<button type="button" disabled={busy||!!readError} onClick={()=>void revoke(invite)} className="text-red-700 underline disabled:opacity-50">Revoke link</button></div>}</li>)}</ul>
  {cursor&&<button type="button" disabled={loading} onClick={()=>void load(cursor)} className="text-sm underline disabled:opacity-50">Load older links</button>}
 </section>
}
