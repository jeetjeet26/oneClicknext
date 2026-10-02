'use client'

import {useEffect,useRef,useState} from 'react'
import {DeliveryHistoryPages,useDeliveryHistory}from './DeliveryHistoryPages'
type Work={id:string;kind:string;action:string;date:string;time:string;timezone:string|null;state:string;attempts:number;attempted:boolean;recipient:string|null;providerId:string|null;pinnedEventId:string|null;errorCode:string|null;reviewReason:string|null;reviewable:boolean}
const labels:Record<string,string>={calendar:'Calendar change',notice_email:'Email notice',notice_sms:'Text notice'}
const states:Record<string,string>={queued:'Queued',running:'In progress',completed:'Accepted by provider',review:'Needs review',superseded:'Replaced by a later schedule',skipped:'Not sent'}
export function TourScheduleDeliveryHistory({leadId,onSaved}:{leadId:string;onSaved?:()=>void}) {
 const[open,setOpen]=useState(false)
 const history=useDeliveryHistory<Work>(leadId,'/api/tours/schedule-delivery/recovery',open),{work,error}=history
 return <section aria-label="Tour change delivery" className="rounded-xl border border-slate-200 bg-white p-4">
  <button type="button" aria-expanded={open} className="text-sm font-medium text-slate-800" onClick={()=>setOpen(!open)}>Tour change delivery {open?'−':'+'}</button>
  {open&&<div className="mt-3 space-y-3 text-sm">
   <p className="text-xs text-slate-500">Calendar changes and optional notices after rescheduling or cancellation. Provider acceptance does not confirm that the prospect read a message. Complete saved history is available below.</p>
   {error&&<p role="alert" className="text-red-700">{error} <button type="button" onClick={()=>history.reload()} className="underline">Retry update history</button></p>}
   {!work&&!error&&<p>Loading tour updates…</p>}
   {work?.length===0&&<p>No calendar changes or notices have been queued for this lead.</p>}
   {work?.map(w=><article key={`${w.id}/${w.state}/${w.attempts}`} className="rounded-lg bg-slate-50 p-3">
    <h3 className="font-medium">{labels[w.kind]||w.kind} · {w.action==='cancel'?'Cancellation':'Reschedule'}</h3>
    <p className="mt-1 text-xs text-slate-500">{w.date} · {w.time?.slice(0,5)} {w.timezone||''}</p>
    <p className="mt-2">{states[w.state]||w.state}</p>
    {w.recipient&&<p className="mt-1 break-all text-xs">Destination: {w.recipient}</p>}
    <p className="mt-1 text-xs text-slate-500">Attempts: {w.attempts} of 3</p>
    {(w.providerId||w.pinnedEventId)&&<p className="mt-1 break-all text-xs">{w.providerId?'Provider receipt':'Saved event ID'}: {w.providerId||w.pinnedEventId}</p>}
    {w.errorCode&&<p className="mt-1 text-xs text-amber-800">{({delivery_unconfirmed:'The provider result is unconfirmed.',not_attempted:'Delivery stopped before a provider attempt.',delivery_window_expired:'This update is outside its sending window.',attempt_limit:'The attempt limit was reached.',confirmed_not_sent:'Review confirmed that this update was not sent.'} as Record<string,string>)[w.errorCode]||'This update needs review.'}</p>}
    {w.reviewReason&&<p className="mt-1 text-xs">Review evidence: {w.reviewReason}</p>}
    {w.reviewable&&<Review key={w.id} work={w} leadId={leadId} onSaved={()=>{history.reload();onSaved?.()}}/>}
   </article>)}
   <DeliveryHistoryPages history={history}/>
  </div>}
 </section>
}
function Review({work,leadId,onSaved}:{work:Work;leadId:string;onSaved:()=>void}) {
 const [resolution,setResolution]=useState<'accepted'|'not_sent'>(work.attempted?'accepted':'not_sent'),[reason,setReason]=useState(''),[providerId,setProviderId]=useState(work.pinnedEventId||''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const request=useRef<{signature:string;id:string}|null>(null),active=useRef<AbortController|null>(null),saving=useRef(false)
 useEffect(()=>()=>active.current?.abort(),[])
 async function save(e:React.FormEvent){
  e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setMessage('')
  const input={leadId,workId:work.id,resolution,reason:reason.trim(),...(resolution==='accepted'?{providerId:providerId.trim()}:{})},signature=JSON.stringify(input)
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()}
  const controller=new AbortController();active.current=controller
  try {
   const r=await fetch('/api/tours/schedule-delivery/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId:request.current.id}),signal:controller.signal})
   const data=await r.json();if(!r.ok)throw new Error(data.error||'The review was not saved.')
   if(!controller.signal.aborted){setMessage('Review saved.');onSaved()}
  }catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error&&!(e instanceof TypeError)?e.message:'The save is unconfirmed. Retry the same review safely.')}
  finally{saving.current=false;if(!controller.signal.aborted)setBusy(false)}
 }
 return <form onSubmit={save} aria-label={`Review ${labels[work.kind]||'tour update'}`} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
  <p className="text-xs text-amber-800">Check the provider history first. Confirmed unaccepted updates can be queued again only while timely, within 23 hours and up to three attempts. Sending still follows the delivery pause.</p>
  <label className="block text-xs">Provider outcome<select aria-label="Provider outcome" value={resolution} onChange={e=>setResolution(e.target.value as typeof resolution)} disabled={busy} className="mt-1 block w-full rounded border p-2">
   {work.attempted&&<option value="accepted">Provider accepted the update</option>}
   <option value="not_sent">Confirmed not accepted by provider</option>
  </select></label>
  {resolution==='accepted'&&<label className="block text-xs">{work.kind==='calendar'?'Provider event ID':'Provider message ID'}<input required maxLength={300} disabled={busy} value={providerId} onChange={e=>setProviderId(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>}
  <label className="block text-xs">Review evidence<textarea required maxLength={2000} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded border p-2"/></label>
  <button disabled={busy||!reason.trim()||(resolution==='accepted'&&!providerId.trim())} className="rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50">{busy?'Saving review…':'Save update review'}</button>
  {message&&<p role="status" className="text-xs text-slate-700">{message}</p>}
 </form>
}
