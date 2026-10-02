'use client'

import {useEffect,useRef,useState} from 'react'
import {DeliveryHistoryPages,useDeliveryHistory}from './DeliveryHistoryPages'

type Delivery={id:string;step:number;channel:string;recipient:string|null;state:string;providerId:string|null;attempts:number;attempted:boolean;legacy:boolean;reviewable:boolean;reviewReason:string|null;errorCode:string|null}
const issues:Record<string,string>={backlog_expired:'This follow-up is too old to send automatically.',legacy_delivery_review:'An earlier attempt needs its provider history checked.',recipient_missing:'The lead has no recipient for this step.',recipient_changed:'The lead’s contact details changed.',template_unavailable:'The message template is unavailable.',template_changed:'The message template changed.',template_variables_missing:'The message needs missing information, such as the public tour booking link.',configuration_missing:'The messaging provider or sender is not configured.',definition_changed:'The follow-up sequence changed.',definition_inactive:'The sequence is disabled.',delivery_unconfirmed:'The provider outcome is uncertain.',workflow_changed:'The workflow was paused or stopped before sending.',retry_limit:'The delivery window or attempt limit has been reached.',invalid_steps:'The follow-up schedule needs correction.',reviewed_stop:'Stopped after review.',lead_exit_condition:'The lead no longer needs this follow-up.'}
export function WorkflowDeliveryHistory({leadId,onSaved}:{leadId:string;onSaved:()=>void}) {
 const history=useDeliveryHistory<Delivery>(leadId,'/api/workflows/recovery'),{work,error}=history
 return <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4" aria-label="Follow-up delivery">
  <h5 className="text-sm font-medium text-slate-800">Follow-up delivery</h5>
  <p className="mt-1 text-xs text-slate-500">Accepted means the provider accepted the message; it does not confirm the prospect received it.</p>
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error} <button className="underline" onClick={()=>history.reload()}>Retry history</button></p>}
  {!work&&!error&&<p className="mt-3 text-sm">Loading follow-ups…</p>}
  {work?.length===0&&<p className="mt-3 text-sm text-slate-500">No delivery attempts have been prepared for this lead.</p>}
  {work?.map(d=><div key={`${d.id}/${d.state}/${d.attempts}`} className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
   <p className="font-medium text-slate-800">Step {d.step} · {d.channel==='sms'?'Text':d.channel==='email'?'Email':'Wait'}</p>
   {d.recipient&&<p className="break-words text-xs text-slate-500">{d.recipient}</p>}
   <p className="mt-1 text-xs">{({accepted:'Accepted by provider',queued:'Queued',running:'Sending',review:'Needs review',skipped:'Not sent'})[d.state]||d.state}</p>
   {d.errorCode&&<p className="mt-2 text-xs text-amber-800">{issues[d.errorCode]||'This follow-up needs review.'}</p>}
   {d.providerId&&<p className="mt-1 break-all text-xs text-slate-500">Message ID: {d.providerId}</p>}
   {d.reviewReason&&<p className="mt-1 text-xs text-slate-600">Review: {d.reviewReason}</p>}
   {d.reviewable&&d.state==='review'&&<DeliveryReview leadId={leadId} delivery={d} onSaved={()=>{history.reload();onSaved()}}/>}
  </div>)}
   <DeliveryHistoryPages history={history}/>
 </section>
}
function DeliveryReview({leadId,delivery:d,onSaved}:{leadId:string;delivery:Delivery;onSaved:()=>void}) {
 const [resolution,setResolution]=useState(d.attempted?'accepted':'skip'),[reason,setReason]=useState(''),[providerId,setProviderId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const request=useRef<{signature:string;id:string}|null>(null),active=useRef<AbortController|null>(null)
 useEffect(()=>()=>active.current?.abort(),[])
 async function save(event:React.FormEvent) {
  event.preventDefault();setBusy(true);setMessage('')
  const input={leadId,deliveryId:d.id,resolution,reason:reason.trim(),...(resolution==='accepted'?{providerId:providerId.trim()}:{})}
  const signature=JSON.stringify(input)
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()}
  const controller=new AbortController();active.current=controller
  try {
   const r=await fetch('/api/workflows/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId:request.current.id}),signal:controller.signal})
   const data=await r.json();if(!r.ok)throw new Error(data.error)
   if(!controller.signal.aborted)onSaved()
  }catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error&&!(e instanceof TypeError)?e.message:'The save is unconfirmed. Retry the same review safely.')}
  finally{if(!controller.signal.aborted)setBusy(false)}
 }
 return <form aria-label={`Review follow-up step ${d.step}`} onSubmit={save} className="mt-3 space-y-2">
  <p className="text-xs text-amber-800">{d.attempted?'Check the provider history before recording an outcome.':'This message was held before a send attempt.'} Confirmed unaccepted messages can retry within 23 hours of their due time, up to three attempts. Older and legacy work is stopped. Paused workflows stay paused.</p>
  <label className="block text-xs">Review outcome<select value={resolution} onChange={e=>setResolution(e.target.value)} disabled={busy} className="mt-1 block w-full rounded border p-2">
   {d.attempted&&<option value="accepted">Provider accepted the message</option>}
   <option value="not_sent">Confirmed not accepted by provider</option>
   {!d.attempted&&<option value="skip">Stop this follow-up sequence</option>}
  </select></label>
  {resolution==='accepted'&&<label className="block text-xs">Provider message ID<input required maxLength={300} value={providerId} onChange={e=>setProviderId(e.target.value)} disabled={busy} className="mt-1 block w-full rounded border p-2"/></label>}
  <label className="block text-xs">Review evidence<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} className="mt-1 block w-full rounded border p-2"/></label>
  <button disabled={busy||!reason.trim()||(resolution==='accepted'&&!providerId.trim())} className="rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50">{busy?'Saving review…':'Save follow-up review'}</button>
  {message&&<p role="status" className="text-xs text-slate-700">{message}</p>}
 </form>
}
