"use client"
import {useEffect,useRef,useState} from 'react'
import type {CalendarBindingCandidate} from '@/utils/services/calendar-binding-provider'
type Page={events:CalendarBindingCandidate[];nextCursor:string|null;calendarId:string;credentialVersion:number;unsupported:number;timezone:string}
export function CalendarEventBinding({propertyId,bookingId,version,timezone,onUpdated}:{propertyId:string;bookingId:string;version:number;timezone:string|null;onUpdated:(message:string)=>Promise<void>}){
 const [page,setPage]=useState<Page|null>(null),[selected,setSelected]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false)
 const pending=useRef(false),request=useRef<{key:string;id:string}|null>(null),controller=useRef<AbortController|null>(null)
 useEffect(()=>()=>{controller.current?.abort()},[])
 async function submit(action:'list'|'bind',cursor?:string){
  if(pending.current)return
  pending.current=true;setBusy(true);setError('');controller.current=new AbortController()
  const body={action,propertyId,bookingId,version,...(action==='bind'?{calendarId:page?.calendarId,credentialVersion:page?.credentialVersion,providerEventId:selected,reason:reason.trim()}:{...(cursor?{cursor}:{})})}
  const key=JSON.stringify(body)
  if(action==='bind'&&request.current?.key!==key)request.current={key,id:crypto.randomUUID()}
  try{
   const response=await fetch('/api/lumaleasing/tours/calendar-binding',{method:'POST',signal:controller.current.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...(action==='bind'?{requestId:request.current?.id}:{})})})
   const data=await response.json()
   if(!response.ok){if(['stale','stale_connection','binding_conflict','provider_changed'].includes(data.state))setStale(true);throw new Error(data.error||'Calendar selection could not be confirmed. Retry the same selection.')}
   if(action==='list'){
    if(data.state!=='listed'||!Array.isArray(data.events)||!data.calendarId||!Number.isSafeInteger(data.credentialVersion))throw new Error('Matching events could not be verified. Reload the list.')
    if(cursor&&page&&(data.calendarId!==page.calendarId||data.credentialVersion!==page.credentialVersion)){setStale(true);throw new Error('Calendar connection changed. Reload matching events.')}
    setPage({...data,events:cursor&&page?[...new Map([...page.events,...data.events].map(event=>[event.id,event])).values()]:data.events});setStale(false);if(!cursor)setSelected('')
   }else{
    if(!['applied','replayed'].includes(data.state)||!data.eventId||!data.actionEventId)throw new Error('Saved calendar link could not be confirmed. Retry the same selection.')
    await onUpdated('Existing calendar event linked. No new event or prospect message was sent.')
   }
  }catch(e){if(!controller.current.signal.aborted)setError(e instanceof Error?e.message:'Calendar lookup or save is unavailable.')}
  finally{pending.current=false;if(!controller.current.signal.aborted)setBusy(false)}
 }
 return <section aria-label="Link existing calendar event" className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
  <h5 className="text-sm font-semibold text-indigo-950">Link an existing calendar event</h5>
  <p className="mt-1 text-xs text-indigo-900">Find an event in the connected calendar that matches this booking’s saved time and duration. Select it explicitly; the event is checked again before linking.</p>
  {!timezone&&<p className="mt-2 text-sm text-amber-800">Confirm this booking’s timezone before finding its event.</p>}
  {error&&<p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  <fieldset disabled={busy} className="mt-3 space-y-2">
   <button type="button" disabled={!timezone} onClick={()=>void submit('list')} className="rounded border border-indigo-300 bg-white px-3 py-2 text-sm disabled:opacity-50">{busy?'Checking…':page?'Reload matching events':'Find matching events'}</button>
   {page&&<>
    {page.events.length>0?<label className="block text-sm text-slate-800">Matching calendar event<select value={selected} onChange={e=>setSelected(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"><option value="">Choose an event</option>{page.events.map(event=><option key={event.id} value={event.id}>{event.title} · {new Intl.DateTimeFormat('en-US',{timeZone:page.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(event.startDateTime!))}</option>)}</select></label>:<p className="text-sm text-slate-700">{page.nextCursor?'No matching event on this page. Check the next page.':'No matching event found. Confirm its time and duration in your calendar, then reload.'}</p>}
    {page.unsupported>0&&<p className="text-xs text-slate-600">Some events have unsupported or unavailable timing and cannot be linked here.</p>}
    {page.nextCursor&&<button type="button" onClick={()=>void submit('list',page.nextCursor!)} className="text-sm text-indigo-700 underline">Load more calendar events</button>}
    {page.events.length>0&&<><label className="block text-sm text-slate-800">Reason for linking<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000} className="mt-1 block w-full rounded border border-slate-300 bg-white p-2"/></label><button type="button" disabled={!selected||!reason.trim()||stale} onClick={()=>void submit('bind')} className="rounded bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50">Link selected event</button></>}
   </>}
  </fieldset>
 </section>
}
