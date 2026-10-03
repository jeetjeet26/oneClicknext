'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePropertyContext } from '@/components/layout/PropertyContext'
import { LeadPulseInsights } from '@/components/leadpulse/LeadPulseInsights'
import { LeadScoreBadge } from '@/components/leadpulse/LeadScoreBadge'
import { ScoreBreakdown } from '@/components/leadpulse/ScoreBreakdown'
import { LeadScoreReview } from '@/components/leadpulse/LeadScoreReview'
import { LeadEngagementHistory } from '@/components/leadpulse/LeadEngagementHistory'
import { leadResponse, savedLeadRequest, type ScoreBatch } from '@/utils/leadpulse/client'
import type { LeadScore } from '@/app/api/leadpulse/score/route'
import { RefreshCw, Sparkles, X } from 'lucide-react'

type Lead = { id: string; first_name: string | null; last_name: string | null; email: string | null; source: string | null; status: string; score: number | null; score_bucket: 'hot' | 'warm' | 'cold' | 'unqualified' | null }
const button = 'rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50'
const secondary = 'rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 disabled:opacity-50'
export default function LeadPulsePage() {
 const { currentProperty } = usePropertyContext()
 return currentProperty?.id ? <LeadPulseWorkspace key={currentProperty.id} propertyId={currentProperty.id} propertyName={currentProperty.name}/> : <p>Select a property to review lead scores.</p>
}
function LeadPulseWorkspace({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
 const alive = useRef(true), halted = useRef(false), runOwner = useRef(0)
 const [leads, setLeads] = useState<Lead[]>([]), [total, setTotal] = useState(0), [pages, setPages] = useState(0)
 const [page, setPage] = useState(1), [search, setSearch] = useState(''), [bucket, setBucket] = useState('all')
 const [selected, setSelected] = useState<Lead | null>(null), [version, setVersion] = useState(0)
 const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [batchReady, setBatchReady] = useState(false)
 const [error, setError] = useState<string | null>(null), [listError, setListError] = useState<string | null>(null)
 const [batch, setBatch] = useState<ScoreBatch | null>(null)
 useEffect(() => { alive.current = true; return () => { alive.current = false; halted.current = true } }, [])
 useEffect(() => {
  const controller = new AbortController()
  setLoading(true); setListError(null)
  const timer = setTimeout(() => { void fetch(`/api/leadpulse/leads?${new URLSearchParams({propertyId, search, bucket, page: String(page)})}`, { signal: controller.signal })
   .then(leadResponse).then(data => { if (!controller.signal.aborted) { setLeads(data.leads); setTotal(data.total); setPages(data.pages) } })
   .catch(err => { if (!controller.signal.aborted) { setLeads([]); setListError(err.message) } })
   .finally(() => { if (!controller.signal.aborted) setLoading(false) }) }, search ? 250 : 0)
  return () => { clearTimeout(timer); controller.abort() }
 }, [propertyId, search, bucket, page, version])
 const checkBatch = useCallback(async () => {
  const data = await leadResponse(await fetch(`/api/leadpulse/batches?propertyId=${propertyId}`))
  if (alive.current) { setBatch(data.batch); setBatchReady(true) }
  return data.batch as ScoreBatch | null
 }, [propertyId])
 useEffect(() => { void checkBatch().catch(err => { if (alive.current) setError(err.message) }) }, [checkBatch])
 const refresh = () => setVersion(value => value + 1)
 async function continuePages(initial: ScoreBatch, owner: number) {
  let current = initial
  while (alive.current && !halted.current && owner === runOwner.current && current.state === 'running' && current.canContinue) {
   current = await leadResponse(await fetch('/api/leadpulse/score', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId, batchId: current.requestId, requestId: current.requestId, action: 'continue' }) }))
   if (alive.current && owner === runOwner.current) { setBatch(current); refresh() }
  }
 }
 async function start(leadId?: string, retryBatchId?: string) {
  if (busy || !batchReady || batch?.state === 'running') return
  const owner = ++runOwner.current; halted.current = false; setBusy(true); setError(null)
  try {
   const request = await savedLeadRequest('score', { propertyId, ...(leadId ? { leadId } : {}), ...(retryBatchId ? { retryBatchId } : {}) })
   const data = await leadResponse(await fetch('/api/leadpulse/score', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }))
   request.acknowledge()
   if (alive.current && owner === runOwner.current) { setBatch(data); refresh(); await continuePages(data, owner) }
  } catch (err) { if (alive.current && owner === runOwner.current) setError(err instanceof Error ? err.message : 'Scoring could not be confirmed.') }
  finally { if (alive.current && owner === runOwner.current) setBusy(false) }
 }
 async function resume() {
  if (!batch || busy) return
  const owner = ++runOwner.current; halted.current = false; setBusy(true); setError(null)
  try { await continuePages(batch, owner) }
  catch (err) { if (alive.current && owner === runOwner.current) setError(err instanceof Error ? err.message : 'Progress could not be confirmed.') }
  finally { if (alive.current && owner === runOwner.current) setBusy(false) }
 }
 async function stop() {
  if (!batch) return
  halted.current = true; const owner = ++runOwner.current; setBusy(true); setError(null)
  try {
   const request = await savedLeadRequest('stop', { propertyId, batchId: batch.requestId, action: 'cancel' })
   const data = await leadResponse(await fetch('/api/leadpulse/score', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) }))
   request.acknowledge(); if (alive.current && owner === runOwner.current) { setBatch(data); refresh() }
  } catch (err) { if (alive.current && owner === runOwner.current) setError(err instanceof Error ? err.message : 'Stop could not be confirmed.') }
  finally { if (alive.current && owner === runOwner.current) setBusy(false) }
 }
 return <div className="space-y-6 text-gray-900 dark:text-gray-100">
  <header className="flex flex-wrap items-start justify-between gap-4">
   <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="text-indigo-500"/>LeadPulse</h1><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Understand and prioritize leads for {propertyName}.</p><p className="mt-1 text-xs text-gray-500">Scores use fixed rules. They are not conversion predictions or a trained model.</p></div>
   <button className={button} disabled={busy || !batchReady || batch?.state === 'running'} onClick={() => void start()}>Rescore all property leads</button>
  </header>
  {error && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</div>}
  <section aria-label="Scoring progress" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
   <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Saved scoring progress</h2><button className={secondary} disabled={busy} onClick={() => { setError(null); void checkBatch().then(refresh).catch(err => setError(err.message)) }}>Check saved progress</button></div>
   {!batchReady ? <p className="mt-2 text-sm">Checking saved work before starting another run…</p> : batch ? <>
    <p className="mt-3 text-sm" role="status">{batch.state === 'running' ? 'In progress' : batch.state === 'cancelled' ? 'Stopped' : batch.failed ? 'Finished with errors' : 'Completed'} · {batch.successful} of {batch.total} scored · {batch.failed} failed · {batch.pending} remaining</p>
    <p className="mt-1 text-xs text-gray-500">Lead selection saved {new Date(batch.startedAt).toLocaleString()}. Each score uses the evidence available when it is calculated.</p>
    <div className="mt-3 flex flex-wrap gap-2">{batch.state === 'running' && <><button className={button} disabled={busy || !batch.canContinue} onClick={() => void resume()}>Continue saved run</button><button className={secondary} onClick={() => void stop()}>Stop remaining work</button></>}{batch.state !== 'running' && batch.failed > 0 && <button className={button} disabled={busy} onClick={() => void start(undefined, batch.requestId)}>Retry failed leads</button>}</div>
    {batch.state === 'running' && !batch.canContinue && <p className="mt-2 text-sm">The person who started this run can continue it. You can stop remaining work.</p>}
    {batch.failed > 0 && <details className="mt-3 text-sm"><summary>Review failures{batch.failed > 20 ? ' (first 20)' : ''}</summary><ul className="mt-2">{batch.failures.map(item => <li key={item.leadId}>Lead {item.leadId}: {item.code === 'target_changed' ? 'Deleted or moved since the run began' : 'Score could not be saved; no partial score was kept'}</li>)}</ul></details>}
   </> : <p className="mt-3 text-sm text-gray-500">No scoring run has been saved for this property.</p>}
  </section>
  <LeadPulseInsights key={`${propertyId}/${version}`} propertyId={propertyId}/>
  <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
   <div className="flex flex-wrap gap-3 border-b border-gray-200 p-4 dark:border-gray-700"><input aria-label="Search leads" maxLength={200} placeholder="Search name or email" className="min-w-40 flex-1 rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm dark:border-gray-600" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/><select aria-label="Score category" className="rounded-lg border border-gray-300 bg-transparent p-2 text-sm dark:border-gray-600" value={bucket} onChange={e => { setBucket(e.target.value); setPage(1) }}>{['all','hot','warm','cold','unqualified','unscored'].map(value => <option key={value} value={value}>{value === 'all' ? 'All score categories' : value[0].toUpperCase() + value.slice(1)}</option>)}</select></div>
   {listError ? <div role="alert" className="p-4">{listError}<button className={secondary} onClick={refresh}>Retry loading leads</button></div> : loading ? <p className="p-6 text-sm">Loading leads…</p> : <><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-gray-500 dark:bg-gray-900"><tr><th className="p-3">Score</th><th className="p-3">Lead</th><th className="p-3">Source</th><th className="p-3">Status</th></tr></thead><tbody>{leads.map(lead => <tr key={lead.id} className="border-t border-gray-100 dark:border-gray-700"><td className="p-3"><LeadScoreBadge score={lead.score} bucket={lead.score_bucket}/></td><td className="p-3"><button className="text-left font-medium text-indigo-600 dark:text-indigo-300" onClick={() => setSelected(lead)}>{[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unnamed lead'}</button><p className="text-xs text-gray-500">{lead.email}</p></td><td className="p-3">{lead.source || 'Unknown'}</td><td className="p-3">{lead.status.replaceAll('_',' ')}</td></tr>)}</tbody></table>{!leads.length && <p className="p-6 text-sm text-gray-500">No leads match these filters.</p>}</div><div className="flex items-center justify-between border-t border-gray-200 p-3 text-sm dark:border-gray-700"><p>{total} matching leads · Page {page} of {Math.max(1,pages)}</p><div className="flex gap-2"><button className={secondary} disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className={secondary} disabled={page >= pages} onClick={() => setPage(value => value + 1)}>Next</button></div></div></>}
  </section>
  {selected && <LeadScorePanel key={selected.id} propertyId={propertyId} lead={selected} version={version} rescore={() => start(selected.id)} disabled={busy || !batchReady || batch?.state === 'running'} close={() => setSelected(null)} changed={refresh}/>}
 </div>
}
function LeadScorePanel({ propertyId, lead, version, rescore, disabled, close, changed }: { propertyId: string; lead: Lead; version: number; rescore: () => Promise<void>; disabled: boolean; close: () => void; changed: () => void }) {
 const [refresh, setRefresh] = useState(0)
 const readKey = `${lead.id}/${version}/${refresh}`
 const [result, setResult] = useState<{key:string;score:LeadScore|null;error:string|null}|null>(null)
 const loading = result?.key !== readKey, score = !loading ? result?.score : null, error = !loading ? result?.error : null
 useEffect(() => {
  const controller = new AbortController()
  void fetch(`/api/leadpulse/score?leadId=${lead.id}`, {signal: controller.signal}).then(leadResponse).then(data => { if (!controller.signal.aborted) setResult({key:readKey,score:data.score,error:null}) }).catch(err => { if (!controller.signal.aborted) setResult({key:readKey,score:null,error:err.message}) })
  return () => controller.abort()
 }, [lead.id, readKey])
 return <aside role="dialog" aria-modal="false" aria-label="Lead score and engagement" className="fixed inset-y-0 right-0 z-50 w-full max-w-lg overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
  <header className="mb-5 flex items-start justify-between"><div><h2 className="text-lg font-semibold">{[lead.first_name,lead.last_name].filter(Boolean).join(' ') || 'Unnamed lead'}</h2><p className="text-sm text-gray-500">{lead.email}</p></div><button aria-label="Close lead details" onClick={close}><X/></button></header>
  {loading ? <p className="flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4 animate-spin"/>Loading saved score…</p> : error ? <div role="alert">{error}<button className={secondary} onClick={() => setRefresh(value => value+1)}>Retry score read</button></div> : score ? <>
   <ScoreBreakdown {...score} onRescore={() => void rescore()} isRescoring={disabled}/>
   <div className="my-4 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-900"><p>{score.provenance?.status === 'captured' ? 'Saved scoring evidence is available.' : 'This older score has no saved input snapshot. Rescore to capture current evidence.'}</p>{score.provenance?.status === 'captured' && <p className="mt-1 text-xs text-gray-500">{String(score.provenance.eventCount)} active events · {String(score.provenance.reportedEventCount)} staff reports · {String(score.provenance.legacyEventCount)} legacy events · {String(score.provenance.userMessageCount)} user messages. Historical values stay as scored.</p>}</div>
   <LeadScoreReview key={score.id} propertyId={propertyId} leadId={lead.id} scoreId={score.id}/>
   {score.workflowOutcomes && <p className="my-3 text-sm text-gray-500">Current follow-up context: {score.workflowOutcomes.sent} sent, {score.workflowOutcomes.failed} failed, {score.workflowOutcomes.pending} pending. These delivery counts do not change the saved score.</p>}
  </> : <div className="my-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"><p className="mb-3 text-sm">This lead has not been scored. Opening it does not calculate a score.</p><button className={button} disabled={disabled} onClick={() => void rescore()}>Calculate score</button></div>}
  <LeadEngagementHistory propertyId={propertyId} leadId={lead.id} changed={() => { setRefresh(value => value+1); changed() }}/>
  <Link href="/dashboard/leads" className="mt-5 block text-sm text-indigo-600 dark:text-indigo-300">Open leads and tour management →</Link>
 </aside>
}
