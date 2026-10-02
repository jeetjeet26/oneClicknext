'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { sendMarketDecision } from '@/utils/marketvision/decision-client'
import { publicMarketUrl } from '@/utils/marketvision/decision-contracts'

type Source = 'website' | 'apartments_com'
type SourceRow = { id: string; state: string; source: Source; reason: string; createdAt: string }
type CompetitorSource = { version: number; isActive: boolean; website: string | null; apartments_com: string | null }
type Receipt = { fetchedAt?: string; finalUrl?: string; statusCode?: number; text?: string; textTruncated?: boolean; bodyHash?: string; title?: string }
type SavedSource = { id: string; state: string; version: number; input: { source: Source; reason: string }; source_snapshot: { sourceUrl: string }; receipt: Receipt | null; sourceChanged: boolean; error_code: string | null }
const stateLabels: Record<string, string> = { queued: 'Waiting to fetch', running: 'Fetching page', received: 'Page retained', held: 'Needs attention', stopped: 'Stopped' }
const issueLabels: Record<string, string> = {
  http_error: 'The website did not return a successful page. You can review it directly and use the pasted-source workflow.',
  unsupported_content: 'This response was not a supported public text or HTML page.', unsupported_encoding: 'The page encoding could not be retained safely.',
  insufficient_text: 'This page did not contain enough readable text. JavaScript-only content may need manual intake.',
  challenge_page: 'The site returned a browser challenge instead of a usable source page.', unsafe_source: 'This saved address did not pass the public website checks.',
  fetch_unconfirmed: 'The fetch outcome is unconfirmed. This request will not repeat the fetch. Inspect its status or stop it before creating another reviewed request.',
  source_or_access_changed: 'The source or requesting account changed. Review the current property before requesting another page.',
}
const names: Record<Source, string> = { website: 'Competitor website', apartments_com: 'Apartments.com listing' }
export function CompetitorSourcePanel({ propertyId, competitorId, onExtractionReady, onBrandReady, openRequestId }: {
  propertyId: string; competitorId: string; openRequestId?: string; onExtractionReady: (id: string) => void; onBrandReady?: (id: string) => void
}) {
  const [rows, setRows] = useState<SourceRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [competitor, setCompetitor] = useState<CompetitorSource | null>(null)
  const [selected, setSelected] = useState<SavedSource | null>(null)
  const [source, setSource] = useState<Source>('website')
  const [requestReason, setRequestReason] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [paused, setPaused] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readReady, setReadReady] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const load = useCallback(async (id?: string, after?: string) => {
    const current = ++generation.current
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/marketvision/sources?${new URLSearchParams({ propertyId, competitorId, ...(id ? { requestId: id } : {}), ...(after ? { cursor: after } : {}) })}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Saved page requests could not be loaded.')
      if (generation.current !== current) return
      setPaused(data.execution.paused)
      setReadReady(true)
      if (id) { setSelected(data.request); setConfirmed(false) }
      else { setRows(old => after ? [...old, ...data.requests] : data.requests); setCursor(data.nextCursor); setCompetitor(data.competitor) }
    } catch (e) {
      if (generation.current !== current) return
      setError(e instanceof Error ? e.message : 'Saved page requests could not be loaded.')
      setReadReady(false)
    } finally { if (generation.current === current) setBusy(false) }
  }, [propertyId, competitorId])
  useEffect(() => { void load(openRequestId); return invalidate }, [load, invalidate, openRequestId])
  const selectedId = selected?.id, selectedState = selected?.state
  useEffect(() => {
    if (paused || !selectedId || !['queued', 'running'].includes(selectedState || '')) return
    let count = 0
    const timer = setInterval(() => { if (++count > 12) { clearInterval(timer); return } void load(selectedId) }, 5000)
    return () => clearInterval(timer)
  }, [paused, selectedId, selectedState, load])

  async function request(e: React.FormEvent) {
    e.preventDefault()
    if (!competitor) return
    setBusy(true); setError(''); setMessage('')
    try {
      const data = await sendMarketDecision('/api/marketvision/sources', 'POST', { propertyId, competitorId, expectedVersion: competitor.version, source, reason: requestReason }, ['queued', 'running', 'received', 'held', 'stopped', 'busy'])
      setMessage(data.result.state === 'busy' ? 'A saved fetch is already open for this source. Review it below.' : ['received', 'held', 'stopped'].includes(data.result.state) ? 'This exact request already exists. Its saved outcome is shown below.' : 'Source request saved. Fetching does not apply prices.')
      await load(data.result.requestId)
    } catch (e) { setError(e instanceof Error ? e.message : 'The source request could not be confirmed.') }
    finally { setBusy(false) }
  }
  async function control(action: 'stop' | 'recover') {
    if (!selected) return
    setBusy(true); setError(''); setMessage('')
    try {
      await sendMarketDecision('/api/marketvision/sources', 'PUT', { propertyId, sourceId: selected.id, expectedVersion: selected.version, action, reason })
      setReason('')
      setMessage(action === 'stop' ? 'Source use stopped. A late fetch receipt may still be retained.' : 'Saved source state recovered. An already-started fetch will not be repeated.')
      await load(selected.id)
    } catch (e) { setError(e instanceof Error ? e.message : 'The source decision could not be confirmed.') }
    finally { setBusy(false) }
  }
  async function extract() {
    if (!selected) return
    setBusy(true); setError(''); setMessage('')
    try {
      const data = await sendMarketDecision('/api/marketvision/sources', 'PATCH', { propertyId, competitorId, sourceId: selected.id, expectedVersion: selected.version, confirmedScope: confirmed, reason }, ['queued', 'running', 'result_ready', 'preview_ready', 'held', 'stopped', 'completed', 'busy'])
      setMessage(data.result.state === 'busy' ? 'An earlier extraction is open. Its saved review is shown below.' : 'Extraction request saved from this exact retained page. Pricing changes require a separate approval below.')
      onExtractionReady(data.result.requestId)
    } catch (e) { setError(e instanceof Error ? e.message : 'Extraction acceptance could not be confirmed.') }
    finally { setBusy(false) }
  }
  async function requestBrand() {
    if (!selected || !onBrandReady) return
    const current = generation.current
    setBusy(true); setError(''); setMessage('')
    try {
      const data = await sendMarketDecision('/api/marketvision/brand-evidence', 'POST', { propertyId, competitorId, sourceId: selected.id, sourceVersion: selected.version, confirmedSourceScope: confirmed, reason }, ['queued','running','result_ready','preview_ready','held','stopped','completed','busy'])
      if (current !== generation.current) return
      onBrandReady(data.result.requestId)
    } catch(e) { setError(e instanceof Error ? e.message : 'The brand request could not be confirmed.') }
    finally { setBusy(false) }
  }
  const open = selected && !['received', 'stopped'].includes(selected.state)
  return <section aria-label="Retained public sources" className="space-y-3 rounded-xl border p-4 text-sm">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Fetch a source page</h3><button disabled={busy} onClick={() => load(selected?.id)} className="underline">Reload source status</button></div>
    <p className="text-gray-500">Keep one public page and its retrieval details before requesting a pricing or brand review. This reads static page text; it may omit content loaded by scripts or on other pages.</p>
    {paused && <p className="text-amber-700">External fetching is paused. Requests can be saved for later.</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" className="text-emerald-700">{message}</p>}
    {!selected && <><form aria-label="New page request" onSubmit={request}><fieldset disabled={busy || !readReady || !competitor?.isActive} className="min-w-0 space-y-3">
      <label className="block">Saved source<select value={source} onChange={e => setSource(e.target.value as Source)} className="mt-1 block w-full rounded border p-2"><option value="website">Competitor website</option><option value="apartments_com">Apartments.com listing</option></select></label>
      <p className="break-all">{competitor?.[source] || 'Save this source URL in the competitor details before requesting a page.'}</p>
      <label className="block">Reason for page request<textarea required minLength={3} maxLength={2000} value={requestReason} onChange={e => setRequestReason(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <button type="submit" disabled={!competitor?.[source]} className="rounded border px-3 py-2 disabled:opacity-50">Save page request</button>
    </fieldset></form><div className="space-y-2 border-t pt-3"><h4 className="font-medium">Saved page requests</h4>{rows.map(row => <button key={row.id} disabled={busy} onClick={() => { setReason(''); void load(row.id) }} className="block w-full rounded border p-2 text-left"><span className="font-medium">{stateLabels[row.state]} · {names[row.source]}</span><span className="block">{row.reason}</span><span className="text-xs text-gray-500">{new Date(row.createdAt).toLocaleString()}</span></button>)}{readReady && !rows.length && <p>No saved page requests yet.</p>}{cursor && <button disabled={busy} onClick={() => load(undefined, cursor)} className="underline">Load more page requests</button>}</div></>}
    {selected && <article aria-label="Current page request" className="space-y-3">
      <div className="flex flex-wrap justify-between gap-2"><h4 className="font-medium">{stateLabels[selected.state]}</h4><button disabled={busy} onClick={() => { setSelected(null); setReason(''); setMessage(''); void load() }} className="underline">Back to page requests</button></div>
      <p>{selected.input.reason}</p><p className="break-all">Requested: {selected.source_snapshot.sourceUrl}</p>
      {selected.error_code && <p className="text-amber-700">{issueLabels[selected.error_code] || 'This source needs review before it can be used.'}</p>}
      {selected.receipt && <details className="space-y-2 rounded border p-2"><summary>Retained page evidence</summary><p>Fetch receipt: {selected.receipt.fetchedAt ? new Date(selected.receipt.fetchedAt).toLocaleString() : 'Time unknown'}{selected.receipt.statusCode ? ` · HTTP ${selected.receipt.statusCode}` : ''}</p>{selected.receipt.finalUrl && <p className="break-all">Final page: {publicMarketUrl(selected.receipt.finalUrl) ? <a className="underline" href={selected.receipt.finalUrl} target="_blank" rel="noreferrer">{selected.receipt.finalUrl}</a> : selected.receipt.finalUrl}</p>}{selected.receipt.bodyHash && <p className="break-all text-xs">Retained page hash: {selected.receipt.bodyHash}</p>}<p>One static page only. Price effective date is unknown.</p>{selected.receipt.textTruncated && <p className="text-amber-700">The extraction text is limited to the first 50,000 characters. The complete fetched page remains retained within the fetch size limit.</p>}{selected.receipt.text && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{selected.receipt.text}</pre>}</details>}
      {selected.state === 'received' && <><p>Page retained. Fetching this page did not change competitor prices.</p>{selected.sourceChanged && <p role="alert" className="text-amber-700">Competitor source details changed after this request. Fetch the current source before requesting extraction.</p>}<label className="flex items-start gap-2"><input type="checkbox" disabled={busy || !readReady || selected.sourceChanged} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I reviewed this retained page and its limited coverage, including any shortened text. Use this exact source for the requested review.</span></label></>}
      {(open || selected.state === 'received') && <label className="block">Reason for source decision<textarea minLength={3} maxLength={2000} value={reason} disabled={busy || !readReady} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>}
      <div className="flex flex-wrap gap-2">{open && <><button disabled={busy || !readReady || reason.trim().length < 3} onClick={() => control('recover')} className="rounded border px-3 py-2">Recover page request</button><button disabled={busy || !readReady || reason.trim().length < 3} onClick={() => control('stop')} className="rounded border px-3 py-2">Stop page request</button></>}{selected.state === 'received' && onBrandReady && <button disabled={busy || !readReady || !confirmed || selected.sourceChanged || reason.trim().length < 3} onClick={requestBrand} className="rounded border px-3 py-2 disabled:opacity-50">Request brand analysis from retained page</button>}{selected.state === 'received' && <button disabled={busy || !readReady || !confirmed || selected.sourceChanged || reason.trim().length < 3} onClick={extract} className="rounded border px-3 py-2 disabled:opacity-50">Request extraction from retained page</button>}</div>
    </article>}
    {busy && <p>Loading or saving source…</p>}
  </section>
}
