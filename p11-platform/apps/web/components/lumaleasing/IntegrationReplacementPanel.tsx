"use client"
import {useEffect,useRef,useState} from 'react'
import type {ReplacementReview} from '@/utils/services/integration-replacement'
const blockers:Record<string,string>={active_tours:'Scheduled or confirmed tours still need this calendar. Complete or cancel them and settle their calendar updates first.',unfinished_calendar_delivery:'Calendar delivery still needs attention. Review it in TourSpark before replacing this account.',unfinished_email_threads:'Email conversations still need attention. Resolve or archive them before replacing this mailbox.',connection_review_required:'A single existing account is required. Connect an account first, or review duplicate connections.',configuration_required:'Set up LumaLeasing before replacing its mailbox.'}
export function IntegrationReplacementPanel({propertyId,defaultCapability='email'}:{propertyId:string;defaultCapability?:'calendar'|'email'}){
 const [capability,setCapability]=useState(defaultCapability),[provider,setProvider]=useState('google'),[account,setAccount]=useState(''),[acknowledged,setAcknowledged]=useState(false)
 const [review,setReview]=useState<ReplacementReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[startUrl,setStartUrl]=useState(''),[expiresAt,setExpiresAt]=useState(''),[retry,setRetry]=useState(false)
 const pending=useRef<{key:string;id:string}|null>(null),mounted=useRef(true),read=useRef<AbortController|null>(null)
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;read.current?.abort()}},[])
 const key=JSON.stringify([propertyId,capability,provider,account.trim(),review?.revision])
 async function load(){
  read.current?.abort();const control=new AbortController();read.current=control;setBusy(true);setError('');setReview(null);setStartUrl('');setAcknowledged(false);pending.current=null;setRetry(false)
  try{const response=await fetch(`/api/lumaleasing/integration-replacement?propertyId=${propertyId}&capability=${capability}`,{cache:'no-store',signal:control.signal}),data=await response.json();if(!response.ok||data.state!=='review')throw new Error(data.error||'Review is unavailable.')
   if(!control.signal.aborted)setReview(data)
  }catch(reason){if(!control.signal.aborted&&mounted.current)setError(reason instanceof Error?reason.message:'Review is unavailable. Retry to load the current account.')}
  finally{if(!control.signal.aborted&&mounted.current)setBusy(false)}
 }
 function change(){read.current?.abort();setReview(null);setStartUrl('');setAcknowledged(false);setError('');setRetry(false);pending.current=null}
 async function save(){
  if(busy||!review||!acknowledged)return
  if(pending.current?.key!==key)pending.current={key,id:crypto.randomUUID()}
  const requestId=pending.current.id;setBusy(true);setError('')
  try{const response=await fetch('/api/lumaleasing/integration-replacement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({propertyId,capability,provider,accountEmail:account.trim(),requestId,revision:review.revision,acknowledgeHistory:true})}),data=await response.json()
   if(!mounted.current)return
   if(!response.ok){if(response.status===409){setReview(null);setAcknowledged(false);pending.current=null;setRetry(false)}else setRetry(true);throw new Error(data.error||'The decision could not be confirmed. Retry the same request.')}
   if(data.actionEventId!==requestId||data.replacementId!==requestId||typeof data.startUrl!=='string'||!data.startUrl.startsWith('/api/lumaleasing/integrations/oauth/'))throw new Error('The decision could not be confirmed. Retry the same request.')
   setStartUrl(data.startUrl);setExpiresAt(data.expiresAt);setRetry(false)
  }catch(reason){if(mounted.current){setError(reason instanceof Error?reason.message:'The decision could not be confirmed. Retry the same request.');if(pending.current)setRetry(true)}}
  finally{if(mounted.current)setBusy(false)}
 }
 return <section aria-label="Replace connected account" className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
  <div><h3 className="font-semibold text-slate-900">Replace connected account</h3><p className="mt-1 text-sm text-slate-600">Review linked work before moving future activity to a different Google or Microsoft account. Use Reconnect to renew the same account.</p></div>
  <label className="block text-sm">Account type<select aria-label="Replacement account type" value={capability} disabled={busy} onChange={event=>{change();setCapability(event.target.value as 'calendar'|'email')}} className="ml-3 rounded border p-2"><option value="email">Email</option><option value="calendar">Calendar</option></select></label>
  <button type="button" disabled={busy} onClick={()=>void load()} className="text-sm font-medium text-indigo-700 underline disabled:opacity-50">{busy?'Checking…':review?'Reload replacement review':'Review account replacement'}</button>
  {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
  {review&&<div className="space-y-4 text-sm">
   {review.connections.map(connection=><p key={connection.id}><strong>Current {capability} account:</strong> {connection.accountEmail} ({connection.provider==='google'?'Google':'Microsoft'})</p>)}
   <p>{review.historyCount} linked {capability==='calendar'?`calendar record${review.historyCount===1?'':'s'}`:`email conversation${review.historyCount===1?'':'s'}`} will stay attached to the original account. Existing provider events and conversations are not transferred.</p>
   {review.blockers.length>0?<div className="rounded border border-amber-200 bg-amber-50 p-3"><p className="font-medium">Finish linked work before continuing</p><ul className="mt-2 list-disc pl-5">{review.blockers.map(code=><li key={code}>{blockers[code]||'This connection needs review.'}</li>)}</ul><p className="mt-2">Open work: {review.activeCount}. Calendar deliveries: {review.workCount}.</p></div>:<>
    <div className="flex flex-wrap gap-4"><label>New provider<select aria-label="Replacement provider" value={provider} disabled={busy||!!startUrl} onChange={event=>{setProvider(event.target.value);setAcknowledged(false);setRetry(false)}} className="mt-1 block rounded border p-2"><option value="google">Google</option><option value="microsoft">Microsoft</option></select></label><label className="min-w-0 flex-1">New account email<input aria-label="Replacement account email" type="email" value={account} disabled={busy||!!startUrl} onChange={event=>{setAccount(event.target.value);setAcknowledged(false);setRetry(false)}} className="mt-1 block w-full max-w-md rounded border p-2" autoComplete="off"/></label></div>
    <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} disabled={busy||!!startUrl} onChange={event=>setAcknowledged(event.target.checked)} className="mt-1"/><span>I understand that the old account will stop syncing after authorization. Its history stays attached to it. Future work uses the new account; existing events and conversations are not moved.</span></label>
    {startUrl?<div role="status" className="space-y-2 rounded border border-green-200 bg-green-50 p-3"><p>Replacement decision recorded. Authorize {account.trim()} with {provider==='google'?'Google':'Microsoft'} by {new Date(expiresAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}. The current account stays connected until that succeeds.</p><a href={startUrl} className="inline-block rounded bg-indigo-600 px-4 py-2 font-medium text-white">Authorize replacement account</a></div>:<button type="button" disabled={busy||!acknowledged||!account.trim()} onClick={()=>void save()} className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">{retry?'Retry replacement decision':'Record replacement decision'}</button>}
   </>}
  </div>}
 </section>
}
