"use client"
import {useRef,useState} from 'react'
export type CalendarObservation={id:string;sync_status:string|null;remote_snapshot:{id:string;status:string|null;startDateTime:string|null;endDateTime:string|null}|null;observed_schedule_version:number|null;last_synced_at:string|null}
function localTime(value:string|null|undefined,timezone:string|null){
  if(!value)return 'Time unavailable'
  try{return new Intl.DateTimeFormat('en-US',{timeZone:timezone||'UTC',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}catch{return 'Time unavailable'}
}
export function CalendarChangeReview({propertyId,bookingId,version,timezone,durationMinutes,observation,onUpdated}:{propertyId:string;bookingId:string;version:number;durationMinutes:number;timezone:string|null;observation:CalendarObservation;onUpdated:(message:string)=>Promise<void>}){
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false)
  const request=useRef<{key:string;id:string}|null>(null),pending=useRef(false)
  const removed=['external_missing','external_cancelled'].includes(observation.sync_status||'')
  const observedMinutes=observation.remote_snapshot?.startDateTime && observation.remote_snapshot?.endDateTime ? (Date.parse(observation.remote_snapshot.endDateTime)-Date.parse(observation.remote_snapshot.startDateTime))/60000 : null
  const durationChanged=Number.isInteger(observedMinutes)&&observedMinutes!==durationMinutes
  const current=observation.observed_schedule_version===version && Boolean(observation.last_synced_at)
  async function submit(action:'refresh'|'adopt'|'restore'){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    const body={action,propertyId,bookingId,...(action!=='refresh'?{eventId:observation.id,version,observedAt:observation.last_synced_at,reason:reason.trim()}:{})}
    const key=JSON.stringify(body)
    if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
    try{
      const response=await fetch('/api/lumaleasing/tours/calendar-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...(action!=='refresh'?{requestId:request.current.id}:{})})})
      const result=await response.json()
      if(!response.ok){if(['stale','provider_changed','binding_conflict'].includes(result.state))setStale(true);throw new Error(result.error||'Calendar decision could not be confirmed. Retry the same decision.')}
      if(action==='refresh')setStale(false)
      await onUpdated(action==='refresh'?'Calendar checked. Review the latest details.':result.action==='restore'?'Calendar restoration queued. The booking keeps its saved schedule; provider confirmation is pending.':result.action==='cancel'?'Booking cancelled to match the calendar. No message was sent.':'Booking updated to match the calendar. No message was sent.')
    }catch(e){setError(e instanceof Error?e.message:'Calendar decision could not be confirmed. Retry the same decision.')}
    finally{pending.current=false;setBusy(false)}
  }
  return <section aria-label="Review calendar change" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
    <h5 className="text-sm font-semibold text-amber-950">{removed?'Calendar event removed':'Calendar time changed'}</h5>
    <p className="mt-1 text-sm text-amber-950">{removed?'The provider reports this event as cancelled or missing. Review before cancelling the console booking.':`Calendar: ${localTime(observation.remote_snapshot?.startDateTime,timezone)} – ${localTime(observation.remote_snapshot?.endDateTime,timezone)} (${timezone||'UTC; booking timezone not set'}).`}</p>
    {!removed && durationChanged && <p className="mt-1 text-sm font-medium text-amber-950">Duration: {durationMinutes} minutes in the console → {observedMinutes} minutes in the calendar.</p>}
    <p className="mt-1 text-xs text-amber-900">{observation.last_synced_at?`Last checked ${new Date(observation.last_synced_at).toLocaleString()}.`:'No saved calendar check yet.'} The provider is checked again before a decision is saved.</p>
    {error&&<p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
    <fieldset disabled={busy} className="mt-3 space-y-2">
      <label className="block text-sm text-slate-800">Reason for calendar decision<input aria-label="Reason for calendar decision" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} className="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2"/></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={()=>void submit('adopt')} disabled={!reason.trim()||!current||stale} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Checking…':removed?'Cancel booking to match calendar':durationChanged?'Use calendar time and duration':'Use calendar time'}</button>
        <button type="button" onClick={()=>void submit('restore')} disabled={!reason.trim()||!current||stale} className="rounded border border-indigo-300 bg-white px-3 py-2 text-sm text-indigo-800 disabled:opacity-50">Restore console schedule to calendar</button>
        <button type="button" onClick={()=>void submit('refresh')} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm">Check calendar again</button>
      </div>
    </fieldset>
    <p className="mt-2 text-xs text-slate-600">Restoration keeps the console booking and queues a calendar update. It stays pending until the provider confirms the event. No separate prospect message is requested; calendar invitations follow provider behavior.</p>
  </section>
}
