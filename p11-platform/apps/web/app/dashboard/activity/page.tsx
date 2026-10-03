'use client'
import {integrationFailureMessage} from '@/utils/services/integration-result-message'
import {useEffect,useRef,useState} from 'react'
import {usePropertyContext} from '@/components/layout/PropertyContext'
import {ACTION_LABELS,PRODUCT_LABELS,type ProductKey} from '@/utils/actions/catalog'
import type {ActionEvent} from '@/utils/actions/history'
type Event=Omit<ActionEvent,'actor_id'>&{actor:string}
type Cursor={before:string;beforeId:string}
function summary(value:unknown) {
 if(!value||typeof value!=='object')return ''
 const v=value as Record<string,unknown>
 if('brandAssetId' in v) return [typeof v.revision==='number'?`Version ${v.revision}`:null,typeof v.approvalStatus==='string'?v.approvalStatus:null,typeof v.step==='number'?`section ${v.step}`:null,v.hasExport===true?'Export ready':null].filter(Boolean).join(' · ')
 if('widget' in v){
  if(v.widget===null)return 'Assistant not initialized'
  if(v.widget&&typeof v.widget==='object'){
   const widget=v.widget as Record<string,unknown>
   return [typeof widget.widget_name==='string'?widget.widget_name:null,
    typeof v.propertyTimezone==='string'?v.propertyTimezone:typeof widget.timezone==='string'?widget.timezone:'Timezone not set',
    typeof widget.tour_duration_minutes==='number'?`${widget.tour_duration_minutes} minute tours`:null].filter(Boolean).join(' · ')
  }
 }

 return [typeof v.status==='string'?v.status:typeof v.state==='string'?v.state:null,typeof v.calendarStatus==='string'?({unbound:'No calendar event linked',pending:'Calendar update pending',synced:'Calendar up to date',external_drift:'Calendar change awaiting review',external_missing:'Calendar event missing',external_cancelled:'Calendar event cancelled'} as Record<string,string>)[v.calendarStatus]:null,typeof v.durationMinutes==='number'?`${v.durationMinutes} minute tour`:null,typeof v.step==='number'?`step ${v.step+1}`:null,typeof v.date==='string'?`${v.date}${typeof v.time==='string'?` ${v.time.slice(0,5)}`:''}`:null].filter(Boolean).join(' · ')
}
function authorizationReason(event:Event){
 return event.result&&typeof event.result==='object'&&!Array.isArray(event.result)&&typeof event.result.state==='string'?event.result.state:null
}
function statusLabel(event:Event){
 if(event.action==='integration.authorization.started')return 'Request saved'
 if(event.product==='integrations'&&event.phase==='failed'){
  const reason=authorizationReason(event)
  return reason==='authorization_denied'?'Cancelled':reason==='expired_state'?'Expired':'Could not complete'
 }
 return event.phase==='succeeded'?'Saved':event.phase==='failed'?'Could not complete':'Observed'
}
function transitionSummary(event:Event){
 if(event.action==='integration.authorization.started')return 'Waiting for account authorization.'
 if(event.product==='integrations'&&event.phase==='failed'&&event.after_state&&typeof event.after_state==='object'&&!Array.isArray(event.after_state)&&event.after_state.authorizationChangedConnection===false)return 'This request did not change the connected account.'
 return summary(event.before_state)||summary(event.after_state)?`${summary(event.before_state)||'Earlier state not recorded'} → ${summary(event.after_state)||'No saved change'}`:''
}
export default function ActivityPage(){
 const {currentProperty,hasLoadedProperties}=usePropertyContext()
 return <div className="mx-auto max-w-5xl p-4 sm:p-0"><h1 className="text-2xl font-semibold text-slate-900">Activity history</h1><p className="mt-2 text-sm text-slate-600">Decisions and recorded results for {currentProperty.name}.</p>{hasLoadedProperties&&<ActivityList key={currentProperty.id} propertyId={currentProperty.id}/>}</div>
}
function ActivityList({propertyId}:{propertyId:string}) {
 const [product,setProduct]=useState(''),[evidence,setEvidence]=useState('server_confirmed'),[revision,setRevision]=useState(0)
 return <><div className="my-6 flex flex-wrap gap-3">
  <label className="text-sm text-slate-600">Product<select aria-label="Product" value={product} onChange={e=>setProduct(e.target.value)} className="ml-2 rounded border bg-white p-2"><option value="">All products</option>{Object.entries(PRODUCT_LABELS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
  <label className="text-sm text-slate-600">Show<select aria-label="Show" value={evidence} onChange={e=>setEvidence(e.target.value)} className="ml-2 rounded border bg-white p-2"><option value="server_confirmed">Confirmed actions</option><option value="browser_observed">Page observations</option><option value="">All activity</option></select></label>
  <button className="rounded border bg-white px-3 py-2 text-sm" onClick={()=>setRevision(x=>x+1)}>Refresh history</button>
 </div><HistoryRows key={`${product}/${evidence}/${revision}`} propertyId={propertyId} product={product} evidence={evidence}/></>
}
function HistoryRows({propertyId,product,evidence}:{propertyId:string;product:string;evidence:string}) {
 const [events,setEvents]=useState<Event[]|null>(null),[cursor,setCursor]=useState<Cursor|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const active=useRef<AbortController|null>(null)
 async function load(next:Cursor|null,signal:AbortSignal){
  const params=new URLSearchParams({propertyId,...(product?{product}:{}),...(evidence?{evidence}:{}),...(next||{})})
  const response=await fetch(`/api/activity?${params}`,{signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'History could not be loaded')
  if(!signal.aborted){setEvents(previous=>next?[...(previous||[]),...data.events]:data.events);setCursor(data.nextCursor);setError('')}
 }
 useEffect(()=>{
  const controller=new AbortController();active.current=controller
  void load(null,controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)})
  return()=>{controller.abort();active.current?.abort()}
  // This component is keyed by its filters; each mount represents one immutable query.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])
 async function more(){if(busy||!cursor)return;setBusy(true);const controller=new AbortController();active.current=controller;try{await load(cursor,controller.signal)}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'History could not be loaded')}finally{if(!controller.signal.aborted)setBusy(false)}}
 return <section aria-label="Recorded activity" className="space-y-4">
  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Recording coverage is being completed across products. Page observations, leasing-assistant settings, tour outcomes/corrections, schedule decisions, external-calendar reviews, reminder reviews, integration requests and follow-up controls/reviews are available here. A page observation does not confirm a task result.</p>
  {error&&<p role="alert" className="text-sm text-red-700">{error} Use Refresh history to try again.</p>}
  {!events&&!error&&<p className="text-sm text-slate-500">Loading activity…</p>}
  {events?.length===0&&<p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No recorded activity matches these filters.</p>}
  {events?.map(event=><article key={event.id} className="rounded-xl border border-slate-200 bg-white p-4">
   <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-medium text-slate-900">{event.phase==='failed'&&event.action==='integration.account.replaced'?'Account replacement stopped':ACTION_LABELS[event.action]||event.action}</h2><span className={`rounded px-2 py-1 text-xs ${event.phase==='failed'?'bg-amber-50 text-amber-900':'bg-slate-100 text-slate-700'}`}>{statusLabel(event)}</span></div>
   <p className="mt-1 text-xs text-slate-500">{PRODUCT_LABELS[event.product as ProductKey]||event.product} · {event.actor} · {new Date(event.created_at).toLocaleString()}</p>
   {transitionSummary(event)&&<p className="mt-3 text-sm text-slate-700">{transitionSummary(event)}</p>}
   {event.product==='integrations'&&event.phase==='failed'&&event.result&&typeof event.result==='object'&&!Array.isArray(event.result)&&typeof event.result.state==='string'&&<p className="mt-2 text-sm text-amber-900">{integrationFailureMessage(event.result.state)}</p>}
   <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Record details</summary><p className="mt-2 break-all">Action: {event.id}</p><p className="mt-1 break-all">Task: {event.episode_id}</p><p className="mt-1">{event.evidence==='server_confirmed'?'Confirmed by the server':'Observed in the browser'}</p></details>
  </article>)}
  {cursor&&<button disabled={busy} onClick={()=>void more()} className="rounded border bg-white px-4 py-2 text-sm disabled:opacity-50">{busy?'Loading…':'Load older activity'}</button>}
 </section>
}
