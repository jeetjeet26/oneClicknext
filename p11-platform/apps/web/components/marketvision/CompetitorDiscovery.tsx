'use client'

import { useEffect, useRef, useState } from 'react'
import { getPropertyTypeLabel } from '@/utils/property-types'
import { MapPin, Search, ExternalLink, Plus, Check } from 'lucide-react'
import { DISCOVERY_GROUPS, type DiscoveryCandidate } from '@/utils/marketvision/discovery-contracts'
import { sendMarketDecision } from '@/utils/marketvision/decision-client'

const transactionLabels = {for_sale: 'For sale', rental: 'Rental', care_services: 'Care services', unknown: 'Transaction unverified'}
const marketStatusLabels = {active: 'Actively marketed', coming_soon: 'Coming soon', sold_out: 'Sold out', unknown: 'Availability unverified'}

export function CompetitorDiscovery(props: {propertyId: string; onAdded: () => void}) {
  return <DiscoveryContent key={props.propertyId} {...props}/>
}

function DiscoveryContent({propertyId, onAdded}: {propertyId: string; onAdded: () => void}) {
  const [group, setGroup] = useState('all')
  const [visibleCount, setVisibleCount] = useState(20)
  const [summary, setSummary] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [radius, setRadius] = useState('3')
  const [limit, setLimit] = useState('20')
  const [candidates, setCandidates] = useState<DiscoveryCandidate[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [added, setAdded] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const controller = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const lock = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort() } }, [])
  const filtered = (candidates ?? []).filter(candidate => group === 'all' || candidate.match?.tier === group)
  const visible = filtered.slice(0, visibleCount)

  const selectedCandidates = (candidates ?? [])
    .filter(candidate => candidate.values.property_type && selected.includes(candidate.key) && !added.includes(candidate.key))
  const selectable = visible.filter(candidate => candidate.values.property_type && !added.includes(candidate.key))

  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setStatus('Finding nearby communities and analyzing their websites…'); setCandidates(null); setSelected([]); setAdded([]); setSummary(''); setWarnings([]); setGroup('all'); setVisibleCount(Number(limit))
    const request = new AbortController(); controller.current = request
    try {
      const response = await fetch('/api/marketvision/discover', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: request.signal, body: JSON.stringify({propertyId, radiusMiles: Number(radius), maxCompetitors: Number(limit)})})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Nearby search failed. Please retry.')
      if (alive.current && !request.signal.aborted) {
        const results: DiscoveryCandidate[] = data.candidates
        const recommended = results.filter(candidate => candidate.match?.tier === 'primary' && candidate.match.assessment?.method === 'website_ai').slice(0, 4)
        setSummary(data.profile?.summary ?? 'Saved community profile')
        setWarnings(data.warnings ?? [])
        setCandidates(results)
        setSelected(recommended.map(candidate => candidate.key))
        setStatus(recommended.length ? `${recommended.length} strongest ${recommended.length === 1 ? 'match is' : 'matches are'} selected. Review the analysis and save the competitors you want to track.` : `${results.length} matches near ${data.propertyName}. See how each compares and where the evidence is limited.`)
      }
    } catch (e) { if (alive.current && !request.signal.aborted) { setError(e instanceof Error ? e.message : 'Nearby search failed.'); setStatus('') } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function addSelected() {
    if (lock.current || !selectedCandidates.length) return
    lock.current = true; setBusy(true); setError('')
    let count = 0
    const failures: string[] = []
    try {
      for (const candidate of selectedCandidates) {
        if (!alive.current) break
        const propertyType = candidate.values.property_type
        if (!propertyType) continue
        try {
          await sendMarketDecision('/api/marketvision/competitors', 'POST', {propertyId, action: 'create', values: {...candidate.values, property_type: propertyType}, units: [], reason: 'Selected from nearby competitor discovery'})
          count++
          if (alive.current) { setAdded(old => [...old, candidate.key]); setSelected(old => old.filter(key => key !== candidate.key)) }
        } catch (e) { failures.push(`${candidate.values.name}: ${e instanceof Error ? e.message : 'Could not add. Retry.'}`) }
      }
      if (alive.current) {
        setStatus(count ? `${count} competitor${count === 1 ? '' : 's'} added. Open a saved competitor to review its sources.` : 'No competitors added. Review the errors below and retry.')
        setError(failures.join(' '))
        if (count) onAdded()
      }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return <section aria-label="Find nearby competitors" className="overflow-hidden rounded-2xl border border-indigo-200 bg-white">
    <div className="bg-indigo-50 p-5"><div className="flex items-center gap-2 text-indigo-900"><MapPin className="h-5 w-5"/><h3 className="font-semibold">Find your competitive neighborhood</h3></div><p className="mt-2 text-sm text-slate-600">MarketVision compares nearby communities with your property and shows the evidence behind each match.</p></div>
    <form onSubmit={search} className="flex flex-wrap items-end gap-3 p-5">
      <label className="text-sm font-medium">Search radius<select disabled={busy} value={radius} onChange={e => setRadius(e.target.value)} className="mt-1 block rounded-lg border p-2.5">{[1,3,5,10,25].map(value => <option key={value} value={value}>{value} miles</option>)}</select></label>
      <label className="text-sm font-medium">Results to show<select disabled={busy} value={limit} onChange={e => setLimit(e.target.value)} className="mt-1 block rounded-lg border p-2.5">{[10,20,50].map(value => <option key={value}>{value}</option>)}</select></label>
      <button disabled={busy} className="flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Search className="h-4 w-4"/>{busy ? 'Working…' : 'Search nearby'}</button>
    </form>
    {summary && <div className="px-5 pb-4 text-sm"><p><strong>Searching based on</strong> {summary}</p><a className="text-indigo-700 underline" href={`/dashboard/community?propertyId=${encodeURIComponent(propertyId)}&section=facts`}>Review community knowledge</a></div>}
    {warnings.length > 0 && <ul className="mx-5 mb-4 list-disc rounded-lg bg-amber-50 p-4 pl-8 text-sm text-amber-900">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    {status && <p role="status" className="px-5 pb-4 text-sm text-slate-600">{status}</p>}
    {error && <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {candidates && candidates.length === 0 && <p className="px-5 pb-5 text-sm">No new matches found. Try a wider radius or add a competitor manually.</p>}
    {candidates && candidates.length > 0 && <><div className="flex flex-wrap items-center gap-3 px-5 pb-4"><label className="text-sm">Competitor relevance<select className="mt-1 block max-w-full rounded-lg border p-2 sm:ml-2 sm:mt-0 sm:inline-block" value={group} onChange={e => {setGroup(e.target.value); setVisibleCount(Number(limit))}}><option value="all">All matches ({candidates.length})</option>{Object.entries(DISCOVERY_GROUPS).map(([key,label]) => <option key={key} value={key}>{label} ({candidates.filter(c => c.match?.tier === key).length})</option>)}</select></label><span className="text-sm text-slate-500">Showing {visible.length} of {filtered.length}</span></div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-y bg-slate-50 px-5 py-3">
      <button disabled={busy || !selectable.some(candidate => !selected.includes(candidate.key))} onClick={() => setSelected(old => [...new Set([...old, ...selectable.map(candidate => candidate.key)])])} className="text-sm text-indigo-700 underline disabled:opacity-50">Select visible matches with a known type</button>
      <button disabled={busy || !selectedCandidates.length} onClick={() => void addSelected()} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4"/>Add selected ({selectedCandidates.length})</button>
    </div>
    <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">{visible.map(candidate => {
      const saved = added.includes(candidate.key)
      const assessment = candidate.match?.assessment
      const website = assessment?.method === 'website_ai' ? assessment : null
      const propertyType = candidate.values.property_type
      return <article key={candidate.key} className={`min-w-0 rounded-xl border p-4 ${saved ? 'border-emerald-200 bg-emerald-50' : selected.includes(candidate.key) ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" disabled={busy || saved || !propertyType} checked={saved || selected.includes(candidate.key)} onChange={e => {
          const checked = e.currentTarget.checked
          setSelected(old => checked ? [...old, candidate.key] : old.filter(key => key !== candidate.key))
        }}/><span className="min-w-0"><span className="block font-semibold">{candidate.values.name}</span><span className="mt-1 block text-sm text-slate-500">{candidate.values.address || 'Address unavailable'}</span></span></label>
        <div className="mt-3 space-y-2 text-sm">
          {candidate.match && <p className="font-medium text-indigo-800">{DISCOVERY_GROUPS[candidate.match.tier]} · {candidate.match.distance_miles.toFixed(1)} miles</p>}
          <p className="font-medium">{propertyType ? getPropertyTypeLabel(propertyType) : 'Community type unverified'}{website && ` · ${transactionLabels[website.transaction]} · ${marketStatusLabels[website.sales_status]}`}</p>
          {website ? <>
            <p>{website.comparison}</p>
            {website.pricing && <p>Advertised price: {website.pricing}</p>}
            <details className="text-slate-600"><summary className="cursor-pointer">Website evidence</summary><blockquote className="my-2 break-words border-l pl-3">{website.quote}</blockquote><a href={website.source_url} target="_blank" rel="noreferrer" className="text-indigo-700 underline">Open evidence page</a></details>
          </> : <>
            {candidate.match?.reasons.map(reason => <p key={reason}>{reason}</p>)}
            <p className="text-amber-800">{propertyType ? 'Type inferred from the listing. Website evidence is unavailable.' : 'Sources did not establish a housing type for this match.'}</p>
          </>}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">{saved && <span className="flex items-center gap-1 text-emerald-800"><Check className="h-3.5 w-3.5"/>Added</span>}{candidate.values.website_url && <a href={candidate.values.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-700">Website<ExternalLink className="h-3.5 w-3.5"/></a>}{candidate.sourceUrl && <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">View listing</a>}</div>
      </article>
    })}</div>
      {!visible.length && <p className="px-5 pb-4 text-sm">No candidates in this group were found in this search.</p>}
      {visible.length < filtered.length && <button className="mx-5 mb-4 text-sm text-indigo-700 underline" onClick={() => setVisibleCount(count => count + Number(limit))}>Show more matches ({filtered.length - visible.length} remaining)</button>}
    </>}
  </section>
}
