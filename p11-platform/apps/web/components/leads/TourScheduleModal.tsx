'use client'
import {useEffect,useRef,useState} from 'react'
import {CalendarCheck,X} from 'lucide-react'
import type {BookingContext,ConsoleBookingResult} from '@/utils/services/console-tour-booking'
type Lead={id:string;first_name:string;last_name:string;email?:string;phone?:string;property_id:string}
const slots=Array.from({length:19},(_,i)=>{const hour=9+Math.floor(i/2),minute=i%2?'30':'00';return {value:`${String(hour).padStart(2,'0')}:${minute}`,label:`${hour%12||12}:${minute} ${hour>=12?'PM':'AM'}`}})
export function TourScheduleModal({onClose,lead,context:initialContext,onScheduled}:{onClose:()=>void;lead:Lead;context:BookingContext|null;onScheduled:(result:ConsoleBookingResult)=>void}) {
 const [context,setContext]=useState(initialContext),[zone,setZone]=useState('America/Los_Angeles')
 const zoneIdentity=useRef<{id:string;zone:string}|null>(null)
 const [date,setDate]=useState(()=>context?.today?new Date(Date.parse(`${context.today}T12:00:00Z`)+86400000).toISOString().slice(0,10):'')
 const [time,setTime]=useState('10:00'),[type,setType]=useState('in_person'),[notes,setNotes]=useState(''),[notify,setNotify]=useState(!!(lead.email||lead.phone))
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState<ConsoleBookingResult|null>(null)
 const identity=useRef<{signature:string;id:string}|null>(null),active=useRef<AbortController|null>(null)
 useEffect(()=>()=>active.current?.abort(),[])
 async function saveTimezone() {
  if(active.current)return
  if(zoneIdentity.current?.zone!==zone)zoneIdentity.current={id:crypto.randomUUID(),zone}
  const controller=new AbortController();active.current=controller;setBusy(true);setError('')
  try {
   const response=await fetch('/api/tours/timezone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId:lead.id,requestId:zoneIdentity.current.id,timezone:zone}),signal:controller.signal})
   const result=await response.json();if(!response.ok||!result.context?.timezone)throw new Error(result.error||'Timezone could not be confirmed.')
   if(!controller.signal.aborted){setContext(result.context);if(!date)setDate(new Date(Date.parse(`${result.context.today}T12:00:00Z`)+86400000).toISOString().slice(0,10))}
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Timezone could not be confirmed. Retry the same selection.')}
  finally{if(!controller.signal.aborted){active.current=null;setBusy(false)}}
 }
 async function submit(event:React.FormEvent) {
  event.preventDefault();if(active.current)return
  const body={tourDate:date,tourTime:time,tourType:type,notes:notes.trim()||null,sendConfirmation:notify}
  const signature=JSON.stringify(body);if(identity.current?.signature!==signature)identity.current={signature,id:crypto.randomUUID()}
  const controller=new AbortController();active.current=controller;setBusy(true);setError('')
  try {
   const response=await fetch(`/api/leads/${lead.id}/tours`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:identity.current.id}),signal:controller.signal})
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Booking could not be confirmed. Retry the same request.')
   if(!result.tour?.id||!result.actionEventId)throw new Error('Saved booking could not be confirmed. Retry the same request.')
   if(!controller.signal.aborted){setSaved(result);onScheduled(result)}
  }catch(cause){if(!controller.signal.aborted)setError(cause instanceof Error&&!(cause instanceof TypeError)?cause.message:'The booking result is unconfirmed. Retry the same request safely.')}
  finally{if(!controller.signal.aborted){active.current=null;setBusy(false)}}
 }
 const confirmation=saved?.confirmation==='accepted'?'Confirmation accepted by the messaging provider. Recipient receipt is not confirmed.'
  :saved?.confirmation==='review'?'Confirmation needs review. Check Tour message delivery.'
  :saved?.confirmation==='not_sent'?'Confirmation was not sent. Check Tour message delivery.'
  :saved?.confirmation==='queued'?`Confirmation is queued.${saved.deliveryPaused?' Outbound delivery is currently paused.':' Delivery is not yet confirmed.'}`
  :saved?.confirmation==='needs_contact'?'Confirmation needs contact details before it can be queued.':'No confirmation was requested.'
 return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
  <section onKeyDown={e=>{if(e.key==="Escape"&&!busy)onClose();if(e.key==="Tab"){const items=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}}} role="dialog" aria-modal="true" aria-labelledby="new-tour-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
   <header className="flex items-start justify-between border-b border-slate-200 p-5"><div><h2 id="new-tour-title" className="flex items-center gap-2 text-lg font-semibold text-slate-900"><CalendarCheck size={20} className="text-purple-600"/>Schedule tour</h2><p className="mt-1 text-sm text-slate-500">For {lead.first_name} {lead.last_name}</p></div><button autoFocus aria-label="Close booking" disabled={busy} onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X size={20}/></button></header>
   {saved?<div className="space-y-4 p-6"><h3 className="text-lg font-semibold text-slate-900">{saved.state==='replayed'?'Booking recovered':'Tour scheduled'}</h3><p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Current tour status: {saved.tour?.status}. {confirmation}</p><p className="text-sm text-slate-600">The booking and your decision are saved. Review each message in Tour message delivery.</p><button onClick={onClose} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white">Done</button></div>
   :<form aria-label="Schedule new tour" onSubmit={submit} className="space-y-4 p-5">
    <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{context?.timezone?`Date and time use ${context.timezone}. Availability is checked when you save.`:'Set a valid property timezone before booking.'}</p>
    {!context?.timezone&&<div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><label className="block text-sm text-slate-700">Property timezone<select aria-label="Property timezone" disabled={busy} value={zone} onChange={e=>setZone(e.target.value)} className="mt-1 block w-full rounded-lg border bg-white p-2">{['America/Los_Angeles','America/Denver','America/Phoenix','America/Chicago','America/New_York','America/Anchorage','Pacific/Honolulu','America/Toronto','America/Vancouver','Europe/London','Australia/Sydney','UTC'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><p className="text-xs text-slate-600">Choose the timezone where this property is located. It will be used for this property’s tours.</p><button type="button" disabled={busy} onClick={()=>void saveTimezone()} className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Save property timezone</button></div>}
    <label className="block text-sm text-slate-700">Tour type<select aria-label="Tour type" value={type} disabled={busy} onChange={e=>setType(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2"><option value="in_person">In-person</option><option value="virtual">Virtual</option><option value="self_guided">Self-guided</option></select></label>
    <div className="grid grid-cols-2 gap-3"><label className="block text-sm text-slate-700">Tour date<input type="date" required value={date} disabled={busy} min={context?.today||undefined} max={context?.lastDate||undefined} onChange={e=>setDate(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 p-2"/></label><label className="block text-sm text-slate-700">Tour time<select aria-label="Tour time" required value={time} disabled={busy} onChange={e=>setTime(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2">{slots.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label></div>
    <label className="block text-sm text-slate-700">Booking notes (optional)<textarea maxLength={2000} rows={2} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"/></label>
    <label className="flex items-center gap-2 rounded-lg bg-purple-50 p-3 text-sm text-purple-900"><input type="checkbox" checked={notify} disabled={busy||!(lead.email||lead.phone)} onChange={e=>setNotify(e.target.checked)}/>Queue confirmation{!lead.email&&!lead.phone?' — add contact details first':''}</label>
    <p className="text-xs text-slate-500">A queued confirmation follows the delivery pause and is tracked separately for email and text.</p>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancel</button><button disabled={busy||!context?.timezone} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy?'Saving booking…':'Save booking'}</button></div>
   </form>}
  </section>
 </div>
}
