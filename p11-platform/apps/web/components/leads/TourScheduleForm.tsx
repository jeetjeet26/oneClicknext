'use client'

import {useEffect,useRef,useState} from 'react'
import type {ScheduleResult} from '@/utils/services/tour-scheduling'

export function TourScheduleForm({leadId,tour,onSaved}:{leadId:string;tour:{timezone?:string|null;id:string;tour_date:string;tour_time:string;schedule_version:number};onSaved:(result:ScheduleResult)=>void}) {
 const [action,setAction]=useState<'reschedule'|'cancel'|null>(null)
 const [date,setDate]=useState(tour.tour_date),[time,setTime]=useState(tour.tour_time.slice(0,5)),[reason,setReason]=useState('')
 const [notify,setNotify]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null)
 const request=useRef<AbortController|null>(null),identity=useRef<{key:string;id:string}|null>(null)
 useEffect(()=>()=>request.current?.abort(),[])
 async function save(event:React.FormEvent) {
  event.preventDefault();if(request.current || !action)return
  const controller=new AbortController();request.current=controller;setSaving(true);setError(null)
  const body={tourId:tour.id,expectedVersion:tour.schedule_version,action,reason:reason.trim(),notify,...(action==='reschedule'?{date,time}:{})}
  const key=JSON.stringify(body);if(identity.current?.key!==key)identity.current={key,id:crypto.randomUUID()}
  try {
   const response=await fetch(`/api/leads/${leadId}/tours`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:identity.current.id}),signal:controller.signal})
   const result=await response.json()
   if(!response.ok)throw new Error(result.error || 'The schedule change could not be saved. Please retry.')
   if(result.tour?.id!==tour.id || !result.changeId)throw new Error('The saved change is unconfirmed. Retry the same request safely.')
   if(!controller.signal.aborted)onSaved(result)
  } catch(cause) {
   if(!controller.signal.aborted)setError(cause instanceof Error && !(cause instanceof TypeError)?cause.message:'The result is unconfirmed. Retry the same request safely.')
  } finally {if(!controller.signal.aborted){setSaving(false);request.current=null}}
 }
 if(!action)return <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
  <button type="button" onClick={()=>setAction('reschedule')} className="flex-1 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">Reschedule</button>
  <button type="button" onClick={()=>setAction('cancel')} className="flex-1 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Cancel tour</button>
 </div>
 return <form onSubmit={save} aria-label={action==='cancel'?'Cancel tour':'Reschedule tour'} className="mt-3 space-y-3 border-t border-slate-100 pt-3">
  <p className="text-sm font-medium text-slate-900">{action==='cancel'?'Cancel this tour':'Choose a new tour time'}</p>
  {action==='reschedule' && <div className="grid grid-cols-2 gap-2">
   <label className="text-sm text-slate-700">New date<input type="date" required value={date} disabled={saving} onChange={e=>setDate(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 p-2"/></label>
   <label className="text-sm text-slate-700">New time<input type="time" required value={time} disabled={saving} onChange={e=>setTime(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 p-2"/></label>
  </div>}
  {action==='reschedule' && <p className="text-xs text-slate-500">{tour.timezone ? `Use ${tour.timezone}, the timezone saved for this tour.` : 'The tour timezone needs review before rescheduling.'} Availability is checked when saving.</p>}
  <label className="block text-sm text-slate-700">Reason for change<textarea required maxLength={2000} rows={2} value={reason} disabled={saving} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2"/></label>
  <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={notify} disabled={saving} onChange={e=>setNotify(e.target.checked)} className="mt-1"/>Queue an update for the prospect</label>
  <p className="text-xs text-slate-500">Old reminders will be stopped. Connected calendar changes and selected notifications are queued; saving does not confirm delivery.</p>
  {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  <div className="flex flex-wrap gap-2">
   <button type="submit" disabled={saving || !reason.trim()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">{saving?'Saving…':action==='cancel'?'Confirm cancellation':'Save new time'}</button>
   <button type="button" disabled={saving} onClick={()=>{setAction(null);setError(null)}} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">Close</button>
  </div>
 </form>
}
