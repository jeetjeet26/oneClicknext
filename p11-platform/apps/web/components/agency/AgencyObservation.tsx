'use client'

import Link from 'next/link'
import {useEffect,useRef,useState} from 'react'
import {usePropertyContext} from '@/components/layout/PropertyContext'
import {ACTION_LABELS,PRODUCT_LABELS} from '@/utils/actions/catalog'
import {boardSchema,historySchema,choices,productLinks,currentWork,needsAgencyReview,workSourceLabels,workExplanation,type Board,type ReviewInput,type ReviewRecord} from '@/utils/agency/contracts'
import {agencyFetch,agencyUrl,pendingReview,postReview,recoverReview,type PendingReview} from '@/utils/agency/client'

const button='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50'
const date=(value:string)=>new Date(value).toLocaleString()
export function AgencyObservation(){
 const {currentProperty,hasLoadedProperties}=usePropertyContext()
 return <div className="mx-auto max-w-6xl p-4 sm:p-0">
  <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold text-slate-900">Agency review</h1><span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-800">Observation only</span></div>
  <Link href="/dashboard/agency/plans" className="mt-3 inline-block text-sm font-medium text-indigo-700 underline">Draft follow-up plans</Link>
  <Link href="/dashboard/agency/execution" className="ml-4 mt-3 inline-block text-sm font-medium text-indigo-700 underline">Execution pilot status</Link>
  <p className="mt-2 text-slate-600">Review recorded work across products for {currentProperty.name}.</p>
  <p className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-950">Review recent failures and saved unfinished work. Open work stays visible regardless of age. Your decision is recorded here; follow-up happens in the product. Automatic work needs a separate launch review.</p>
  {hasLoadedProperties&&currentProperty.id?<Workbench key={currentProperty.id} propertyId={currentProperty.id}/>:<p className="mt-6 text-sm text-slate-500">Select a property to review its work.</p>}
 </div>
}
function Workbench({propertyId}:{propertyId:string}){
 const [board,setBoard]=useState<Board|null>(null),[history,setHistory]=useState<ReviewRecord[]>([]),[next,setNext]=useState<string|null>(null)
 const [pending,setPending]=useState<PendingReview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const alive=useRef(false),loading=useRef(false),generation=useRef(0)
 async function refresh(){
  const current=++generation.current
  try{
  const results=await Promise.all([agencyFetch(agencyUrl(propertyId)),agencyFetch(agencyUrl(propertyId,{kind:'history'}))])
  if(current!==generation.current||!alive.current)return
  const b=boardSchema.parse(results[0]),h=historySchema.parse(results[1])
  if(b.propertyId!==propertyId||h.propertyId!==propertyId)throw new Error('The review does not match this property.')
  if(alive.current){setBoard(b);setHistory(h.items);setNext(h.nextBefore)}
  }catch(e){if(current===generation.current&&alive.current)throw e}
 }
 useEffect(()=>{alive.current=true;setPending(pendingReview(propertyId));void refresh().catch(()=>{if(alive.current)setError('Agency evidence could not be loaded. Refresh to try again.')});return()=>{alive.current=false}
 // Each mount belongs to one property; late responses cannot populate another property.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[])
 async function run(task:()=>Promise<void>){if(loading.current)return;loading.current=true;setBusy(true);setError('');setNotice('');try{await task()}catch(e){if(alive.current)setError(e instanceof Error?e.message:'The review could not be confirmed.')}finally{loading.current=false;if(alive.current){setBusy(false);setPending(pendingReview(propertyId))}}}
 async function save(input:ReviewInput){await run(async()=>{const r=await postReview(input);if(alive.current)setNotice(r.record.kind==='review'?'Review saved. Follow-up remains a human decision.':'Unused request closed.');await refresh()})}
 async function recover(close:boolean){if(!pending)return;await run(async()=>{const r=await recoverReview(pending,close);if(alive.current)setNotice(r.record.kind==='review'?'Found your saved review.':'Unused request closed.');await refresh()})}
 async function more(){if(!next)return;await run(async()=>{const h=historySchema.parse(await agencyFetch(agencyUrl(propertyId,{kind:'history',before:next})));if(h.propertyId!==propertyId)throw new Error('The history does not match this property.');if(alive.current){setHistory(old=>[...old,...h.items]);setNext(h.nextBefore)}})}
 return <>
  <div className="my-6 flex flex-wrap items-center gap-3"><button className={button} disabled={busy} onClick={()=>void run(refresh)}>Refresh evidence</button><Link href="/dashboard/activity" className="text-sm font-medium text-indigo-700 underline">Open activity history</Link></div>
  {error&&<p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
  {notice&&<p role="status" className="mb-4 text-sm text-emerald-800">{notice}</p>}
  {pending&&<section aria-label="Unconfirmed review" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-medium">Check your earlier review</h2><p className="my-2 text-sm">Its reply was interrupted. Check the saved decision, or close the request if it was never saved.</p><div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>void recover(false)}>Check saved review</button><button className={button} disabled={busy} onClick={()=>void recover(true)}>Close unused request</button></div></section>}
  {!board&&!error&&<p className="text-sm text-slate-500">Loading recorded work…</p>}
  {board&&<>
   <section aria-label="Recommendations" className="space-y-4"><h2 className="text-lg font-semibold">Suggested reviews</h2><p className="text-sm text-slate-600">Recent failed actions and current unfinished work are separate evidence. A saved hold can be a successful recording action. These checks do not establish current provider health; open the product to inspect the work.</p>
    {!board.items.some(i=>needsAgencyReview(i.evidence))&&<p className="rounded-xl border border-dashed p-5 text-sm text-slate-600">No recent failures or unfinished items were found in the checked sources. This does not establish complete coverage or readiness.</p>}
    {board.items.filter(i=>needsAgencyReview(i.evidence)).map(item=><Recommendation key={`${item.evidence.product}:${item.evidence.sourceHash}:${item.review?.id||''}`} item={item} propertyId={propertyId} disabled={busy||!!pending||!board.canManage} onSave={save}/>)}
    {!board.canManage&&<p className="text-sm text-slate-500">A manager can save review decisions.</p>}
   </section>
   <section aria-label="Evidence coverage" className="mt-8"><h2 className="text-lg font-semibold">Evidence by product</h2><p className="mt-2 text-sm text-slate-600">Property-scoped records only. Organization-wide actions are outside this view. Recorded actions include saved decisions and attempts; they do not prove business outcomes or successful provider delivery. Page observations are counted separately. Missing records do not establish inactivity.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{board.items.map(({evidence:e})=><article key={e.product} className="rounded-xl border border-slate-200 bg-white p-4"><Link className="font-medium text-indigo-700 underline" href={productLinks[e.product]}>{PRODUCT_LABELS[e.product]}</Link><p className="mt-2 text-sm">{e.confirmedCount} recorded actions · {e.failedCount} failures</p><p className="mt-1 text-xs text-slate-500">{e.observedCount} browser observations</p><p className="mt-2 text-sm">{currentWork(e)?.checkedSources.length?`${currentWork(e)!.total} current items need review`:currentWork(e)?.coverage?'No separate property queue':'Current work checks not yet available'}</p>{!!currentWork(e)?.checkedSources.length&&<p className="mt-1 text-xs text-slate-500">Checked: {currentWork(e)!.checkedSources.map(source=>workSourceLabels[source]).join(', ')}</p>}{currentWork(e)?.coverage&&<p className="mt-2 text-xs text-slate-500">{currentWork(e)!.coverage!.detail}</p>}<p className="mt-2 text-xs text-slate-500">{e.latestConfirmedAt?`Latest action: ${date(e.latestConfirmedAt)}`:'No confirmed actions in this window'}</p><p className="mt-1 text-xs text-slate-500">Window: {date(e.windowStart)} – {date(e.capturedAt)}</p></article>)}</div>
   </section>
  </>}
  <section aria-label="Saved agency reviews" className="mt-8 space-y-3"><h2 className="text-lg font-semibold">Saved review history</h2><p className="text-sm text-slate-600">Decisions retain the evidence seen at review time. A new decision preserves earlier reviews.</p>
   {board&&history.length===0&&<p className="text-sm text-slate-500">No agency reviews saved yet.</p>}
   {history.map(r=><article key={r.id} className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-medium">{r.kind==='cancel_unused'?'Unused request closed':`${r.evidence?PRODUCT_LABELS[r.evidence.product]:''}: ${r.decision?choices[r.decision]:''}`}</h3><p className="mt-1 text-xs text-slate-500">{date(r.created_at)}</p>{r.reason&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{r.reason}</p>}<details className="mt-2 text-xs text-slate-500"><summary>Saved evidence</summary>{r.evidence&&<><p className="mt-2">{r.evidence.failedCount} recorded failures among {r.evidence.confirmedCount} recorded actions. {currentWork(r.evidence)?`${currentWork(r.evidence)!.total} unfinished items in the saved summary.`:'Earlier review of recorded actions only.'}</p><p>Observed: {date(r.evidence.capturedAt)}</p>{currentWork(r.evidence)?.items.map(item=><p key={`${item.source}:${item.id}`} className="mt-1 break-all">{workSourceLabels[item.source]} · {item.category==='unconfirmed'?'Result unconfirmed':item.category==='incident'?'Open incident':'Waiting for review'} · {item.id}</p>)}{r.evidence.failures.map(f=><p key={f.eventId} className="mt-1 break-all">{ACTION_LABELS[f.action]||'Recorded product action'} · {date(f.recordedAt)} · {f.eventId}</p>)}</>}<p className="mt-2 break-all">Review: {r.id}</p><p className="break-all">Reviewer record: {r.actor_id}</p></details></article>)}
   {next&&<button className={button} disabled={busy} onClick={()=>void more()}>Load older reviews</button>}
  </section>
 </>
}
function Recommendation({item,propertyId,disabled,onSave}:{item:Board['items'][number];propertyId:string;disabled:boolean;onSave:(input:ReviewInput)=>Promise<void>}){
 const e=item.evidence,[decision,setDecision]=useState<ReviewInput['decision']>(item.review?.decision||'investigate'),[reason,setReason]=useState('')
 return <article aria-label={`${PRODUCT_LABELS[e.product]} recommendation`} className="rounded-xl border border-amber-200 bg-white p-5">
  <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-slate-900">Review {PRODUCT_LABELS[e.product]} work</h3><Link href={productLinks[e.product]} className="text-sm font-medium text-indigo-700 underline">Open {PRODUCT_LABELS[e.product]}</Link></div>
  <p className="mt-2 text-sm text-slate-600">{e.failedCount} failed actions recorded since {date(e.windowStart)}. Inspect the work before deciding whether follow-up is needed.</p>
  {!!currentWork(e)?.total&&<section aria-label="Current unfinished work" className="mt-4 rounded-lg bg-amber-50 p-4"><h4 className="font-medium">{currentWork(e)!.total} unfinished items in checked sources</h4><p className="mt-1 text-xs text-slate-600">{currentWork(e)!.heldCount} waiting for review · {currentWork(e)!.unconfirmedCount} unconfirmed · {currentWork(e)!.incidentCount} open incidents. Counts can overlap the recent failed-action history.</p><p className="mt-2 text-xs text-slate-500">Showing the {Math.min(5,currentWork(e)!.total)} oldest of {currentWork(e)!.total}. Open the product for the full work list. This decision reviews the displayed summary and does not resolve these items.</p>{currentWork(e)!.items.map(item=><div key={`${item.source}:${item.id}`} className="mt-3 border-l-2 border-amber-200 pl-3"><p className="text-sm font-medium">{workSourceLabels[item.source]}</p><p className="mt-1 text-sm text-slate-700">{workExplanation(item)}</p><p className="mt-1 text-xs text-slate-500">{item.opened_at?`Work recorded: ${date(item.opened_at)}`:'Original work date unavailable'}</p><p className="text-xs text-slate-500">{item.changed_at?`Last saved change: ${date(item.changed_at)}`:'Change time unavailable'}</p><details className="mt-1 text-xs text-slate-500"><summary>Source record</summary><p className="break-all">{item.id}</p></details></div>)}</section>}
  <details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer">View failure evidence ({Math.min(5,e.failedCount)} of {e.failedCount})</summary>{e.failures.map(f=><div key={f.eventId} className="mt-3 border-l-2 border-slate-200 pl-3"><p>{ACTION_LABELS[f.action]||'Recorded product action'}</p><p className="text-xs">{date(f.recordedAt)}</p><p className="break-all text-xs">Activity record: {f.eventId}</p></div>)}</details>
  {item.review&&<p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">Last review of this evidence: {choices[item.review.decision]} · {date(item.review.createdAt)}<span className="mt-1 block whitespace-pre-wrap break-words">{item.review.reason}</span></p>}
  <form className="mt-4 space-y-3" onSubmit={event=>{event.preventDefault();if(!disabled&&reason.trim().length>=3)void onSave({propertyId,operation:'review',product:e.product,sourceHash:e.sourceHash,decision,reason:reason.trim()})}}>
   <label className="block text-sm font-medium">Your decision<select className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2" value={decision} disabled={disabled} onChange={event=>setDecision(event.target.value as ReviewInput['decision'])}>{Object.entries(choices).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label className="block text-sm font-medium">Review reason<textarea className="mt-1 block w-full rounded-lg border border-slate-300 p-2 font-normal" value={reason} disabled={disabled} minLength={3} maxLength={2000} required rows={2} onChange={event=>setReason(event.target.value)}/></label>
   <button className={button} disabled={disabled||reason.trim().length<3}>Save review</button>
  </form>
 </article>
}
