'use client'

import {useEffect,useRef,useState} from 'react'
import {DeliveryHistoryPages,useDeliveryHistory}from './DeliveryHistoryPages'

type Channel={id:string;channel:'email'|'sms';recipient:string;state:string;providerId:string|null;attempts:number;attempted:boolean;reviewReason:string|null}
type Work={id:string;kind:string;date:string;time:string;timezone:string|null;state:string;reviewable:boolean;legacy:boolean;channels:Channel[]}
export function TourReminderHistory({leadId}:{leadId:string}) {
 const[open,setOpen]=useState(false)
 const history=useDeliveryHistory<Work>(leadId,'/api/tours/reminders/recovery',open),{work,error}=history
 return <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Tour message delivery">
  <button type="button" className="text-sm font-medium text-slate-800" aria-expanded={open} onClick={()=>setOpen(!open)}>Tour message delivery {open?'−':'+'}</button>
  {open && <div className="mt-3 space-y-3 text-sm">
   <p className="text-xs text-slate-500">Accepted means the messaging provider accepted the message; it does not confirm that the prospect received it.</p>
   {error && <p role="alert" className="text-red-700">{error} <button className="underline" onClick={()=>history.reload()}>Retry history</button></p>}
   {!work&&!error&&<p>Loading tour messages…</p>}
   {work?.length===0&&<p className="text-slate-500">No confirmations or reminders have been queued for this lead.</p>}
   {work?.map(w=><div key={w.id} className="rounded-lg bg-slate-50 p-3">
    <p className="font-medium text-slate-800">{w.kind==='confirmation'?'Booking confirmation':w.kind==='reminder_24h'?'24-hour reminder':'One-hour reminder'}</p>
    <p className="text-xs text-slate-500">{w.date} · {w.time?.slice(0,5)} {w.timezone || ''}</p>
    {w.legacy&&<p className="mt-2 text-amber-800">This earlier reminder has a combined delivery record. Check the provider history before taking further action.</p>}
    {!w.legacy&&w.channels.length===0&&<p className="mt-2 text-amber-800">No recipient was available. Add contact details to the lead; a reminder can be prepared during its delivery window.</p>}
    {w.channels.map(c=><div key={`${c.id}/${c.state}/${c.attempts}`} className="mt-3 border-t border-slate-200 pt-3">
     <p className="break-words"><span className="font-medium">{c.channel==='sms'?'Text':'Email'}</span> · {c.recipient}</p>
     <p className="mt-1 text-xs">{({accepted:'Accepted by provider',queued:'Queued',running:'Sending',review:'Needs review',skipped:'Not sent'})[c.state] || c.state}</p>
     {c.providerId&&<p className="mt-1 break-all text-xs text-slate-500">Message ID: {c.providerId}</p>}
     {c.reviewReason&&<p className="mt-1 text-xs text-slate-600">Review: {c.reviewReason}</p>}
     {w.reviewable&&c.state==='review'&&<ReminderReview leadId={leadId} channel={c} onSaved={()=>history.reload()}/>}
    </div>)}
   </div>)}
   <DeliveryHistoryPages history={history}/>
  </div>}
 </section>
}
function ReminderReview({leadId,channel,onSaved}:{leadId:string;channel:Channel;onSaved:()=>void}) {
 const [resolution,setResolution]=useState<'accepted'|'not_sent'>(channel.attempted?'accepted':'not_sent'),[reason,setReason]=useState(''),[providerId,setProviderId]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const request=useRef<{signature:string;id:string}|null>(null),active=useRef<AbortController|null>(null)
 useEffect(()=>()=>active.current?.abort(),[])
 async function save(event:React.FormEvent) {
  event.preventDefault();setBusy(true);setMessage('')
  const input={leadId,channelId:channel.id,resolution,reason:reason.trim(),...(resolution==='accepted'?{providerId:providerId.trim()}:{})}
  const signature=JSON.stringify(input)
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()}
  const controller=new AbortController();active.current=controller
  try {
   const r=await fetch('/api/tours/reminders/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,requestId:request.current.id}),signal:controller.signal})
   const data=await r.json();if(!r.ok)throw new Error(data.error)
   if(!controller.signal.aborted){setMessage(data.channelState==='queued'?'Review saved. Only this channel is queued; sending still follows the delivery pause.':'Review saved.');onSaved()}
  } catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error && !(e instanceof TypeError)?e.message:'The save is unconfirmed. Retry the same review safely.')}
  finally {if(!controller.signal.aborted)setBusy(false)}
 }
 return <form onSubmit={save} aria-label={`Review ${channel.channel==='sms'?'text':'email'} reminder`} className="mt-3 space-y-2">
  <p className="text-xs text-amber-800">Check the provider history first. Record its evidence below. A confirmed unaccepted message can be queued again while timely, up to three attempts.</p>
  <label className="block text-xs">Provider outcome<select aria-label="Provider outcome" value={resolution} onChange={e=>setResolution(e.target.value as typeof resolution)} className="mt-1 block w-full rounded border p-2" disabled={busy}>
   {channel.attempted&&<option value="accepted">Provider accepted the message</option>}
   <option value="not_sent">Confirmed not accepted by provider</option>
  </select></label>
  {resolution==='accepted'&&<label className="block text-xs">Provider message ID<input required maxLength={300} value={providerId} onChange={e=>setProviderId(e.target.value)} disabled={busy} className="mt-1 block w-full rounded border p-2"/></label>}
  <label className="block text-xs">Review evidence<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} className="mt-1 block w-full rounded border p-2"/></label>
  <button disabled={busy||!reason.trim()||(resolution==='accepted'&&!providerId.trim())} className="rounded bg-slate-900 px-3 py-2 text-xs text-white disabled:opacity-50">{busy?'Saving review…':'Save delivery review'}</button>
  {message&&<p role="status" className="text-xs text-slate-700">{message}</p>}
 </form>
}
