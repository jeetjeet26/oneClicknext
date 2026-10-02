'use client'
import { useEffect, useRef, useState } from 'react'
import { EVENT_WEIGHTS } from '@/utils/services/leadpulse-events'
import { leadResponse, savedLeadRequest } from '@/utils/leadpulse/client'
type Event = { id: string; eventType: string; scoreWeight: number; origin: string; createdAt: string; corrected: boolean; correctionReason?: string; reportedNote?: string; canCorrect: boolean }
const types = Object.keys(EVENT_WEIGHTS).filter(key => !key.startsWith('tour_'))
const button = 'rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 disabled:opacity-50'
export function LeadEngagementHistory({ propertyId, leadId, changed }: { propertyId: string; leadId: string; changed: () => void }) {
 const alive = useRef(true)
 const [events, setEvents] = useState<Event[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(0), [revision, setRevision] = useState(0)
 const [type, setType] = useState('call_inbound'), [note, setNote] = useState(''), [reason, setReason] = useState(''), [correcting, setCorrecting] = useState<string | null>(null)
 const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
 useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
 useEffect(() => {
  const controller = new AbortController(); setLoading(true)
  void fetch(`/api/leadpulse/events?leadId=${leadId}&offset=${page*20}&limit=20`, {signal: controller.signal}).then(leadResponse).then(data => { if (!controller.signal.aborted) { setEvents(data.events); setTotal(data.total) } }).catch(err => { if (!controller.signal.aborted) setError(err.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
  return () => controller.abort()
 }, [leadId, page, revision])
 async function save(correction: boolean) {
  if (busy) return
  setBusy(true); setError(null)
  try {
   const request = await savedLeadRequest(correction ? 'correct' : 'event', correction ? {propertyId,leadId,eventId:correcting,reason:reason.trim()} : {propertyId,leadId,eventType:type,metadata:note.trim() ? {note:note.trim()} : {}})
   const data = await leadResponse(await fetch('/api/leadpulse/events', {method: correction ? 'PATCH' : 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(request.body)}))
   if (!['applied','replayed'].includes(data.state)) throw new Error('The event result is not confirmed.')
   request.acknowledge()
   if (alive.current) { setNote(''); setReason(''); setCorrecting(null); setPage(0); setRevision(value => value+1); changed() }
  } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'The event could not be saved.') }
  finally { if (alive.current) setBusy(false) }
 }
 return <section className="mt-6 space-y-3" aria-label="Engagement history"><h3 className="font-semibold">Engagement evidence</h3><p className="text-xs text-gray-500">Reports are attributed to staff. System events keep their source. Record tour outcomes from tour management.</p>
  {error && <div role="alert" className="rounded border border-amber-300 p-2 text-sm">{error}<button className={button} onClick={() => {setError(null);setRevision(value=>value+1)}}>Reload saved events</button></div>}
  <form className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700" onSubmit={event => {event.preventDefault();void save(false)}}><label className="block text-sm">Report engagement<select className="mt-1 block w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-600" value={type} disabled={busy} onChange={e=>setType(e.target.value)}>{types.map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label><label className="block text-sm">Report note (optional)<textarea maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} className="mt-1 block w-full rounded border border-gray-300 bg-transparent p-2 dark:border-gray-600"/></label><button className={button} disabled={busy}>Save report and rescore</button></form>
  {loading ? <p className="text-sm">Loading saved events…</p> : <><p className="text-xs text-gray-500">{total} recorded events</p><ol className="space-y-3">{events.map(event=><li key={event.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"><p className="font-medium">{event.eventType.replaceAll('_',' ')}{event.corrected ? ' · Withdrawn' : ` · ${event.scoreWeight > 0 ? '+' : ''}${event.scoreWeight} event points`}</p><p className="mt-1 text-xs text-gray-500">{event.origin==='operator' ? 'Staff report' : event.origin==='legacy' ? 'Legacy source; no saved receipt' : `System: ${event.origin}`} · {new Date(event.createdAt).toLocaleString()}</p>{event.reportedNote && <p className="mt-2 whitespace-pre-wrap">{event.reportedNote}</p>}{event.corrected && <p className="mt-2">Correction: {event.correctionReason}. Excluded from later scores.</p>}{event.canCorrect && <button className={`${button} mt-2`} disabled={busy} onClick={()=>{setCorrecting(event.id);setReason('')}}>Withdraw report</button>}{correcting===event.id && <form className="mt-2 space-y-2" onSubmit={e=>{e.preventDefault();void save(true)}}><label className="block">Correction reason<textarea required minLength={3} maxLength={500} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} className="mt-1 block w-full rounded border bg-transparent p-2"/></label><button className={button} disabled={busy || reason.trim().length<3}>Confirm withdrawal</button><button type="button" className={button} disabled={busy} onClick={()=>setCorrecting(null)}>Keep report</button></form>}</li>)}</ol><div className="flex gap-2"><button className={button} disabled={page===0 || busy} onClick={()=>setPage(value=>value-1)}>Earlier page</button><button className={button} disabled={(page+1)*20>=total || busy} onClick={()=>setPage(value=>value+1)}>Older events</button></div></>}
 </section>
}
