'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Search, ExternalLink, Plus, Check } from 'lucide-react'
import type { DiscoveryCandidate } from '@/utils/marketvision/discovery-contracts'
import { sendMarketDecision } from '@/utils/marketvision/decision-client'

export function CompetitorDiscovery({propertyId, onAdded}: {propertyId: string; onAdded: () => void}) {
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
  async function search(event: React.FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setStatus('Searching nearby businesses…'); setCandidates(null); setSelected([])
    const request = new AbortController(); controller.current = request
    try {
      const response = await fetch('/api/marketvision/discover', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: request.signal, body: JSON.stringify({propertyId, radiusMiles: Number(radius), maxCompetitors: Number(limit)})})
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Nearby search failed. Please retry.')
      if (alive.current) { setCandidates(data.candidates); setStatus(`${data.candidates.length} new matches near ${data.propertyName}. Select the competitors you want to track.`) }
    } catch (e) { if (alive.current) { setError(e instanceof Error ? e.message : 'Nearby search failed.'); setStatus('') } }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  async function addSelected() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    let count = 0
    const failures: string[] = []
    try {
      for (const candidate of candidates ?? []) {
        if (!alive.current) break
        if (!selected.includes(candidate.key) || added.includes(candidate.key)) continue
        try {
          await sendMarketDecision('/api/marketvision/competitors', 'POST', {propertyId, action: 'create', values: candidate.values, units: [], reason: 'Selected from nearby competitor discovery'})
          count++
          if (alive.current) { setAdded(old => [...old, candidate.key]); setSelected(old => old.filter(key => key !== candidate.key)) }
        } catch (e) { failures.push(`${candidate.values.name}: ${e instanceof Error ? e.message : 'Could not add. Retry.'}`) }
      }
      if (alive.current) {
        setStatus(count ? `${count} competitor${count === 1 ? '' : 's'} added. You can now scrape their saved websites.` : 'No competitors added. Review the errors below and retry.')
        setError(failures.join(' '))
        if (count) onAdded()
      }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return <section aria-label="Find nearby competitors" className="overflow-hidden rounded-2xl border border-indigo-200 bg-white">
    <div className="bg-indigo-50 p-5"><div className="flex items-center gap-2 text-indigo-900"><MapPin className="h-5 w-5"/><h3 className="font-semibold">Find your competitive neighborhood</h3></div><p className="mt-2 text-sm text-slate-600">Discover nearby communities through Google Places and available listing sources. Choose which matches to add to this property.</p></div>
    <form onSubmit={search} className="flex flex-wrap items-end gap-3 p-5">
      <label className="text-sm font-medium">Search radius<select disabled={busy} value={radius} onChange={e => setRadius(e.target.value)} className="mt-1 block rounded-lg border p-2.5">{[1,3,5,10,25].map(value => <option key={value} value={value}>{value} miles</option>)}</select></label>
      <label className="text-sm font-medium">Results<select disabled={busy} value={limit} onChange={e => setLimit(e.target.value)} className="mt-1 block rounded-lg border p-2.5">{[10,20,50].map(value => <option key={value}>{value}</option>)}</select></label>
      <button disabled={busy} className="flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Search className="h-4 w-4"/>{busy ? 'Working…' : 'Search nearby'}</button>
    </form>
    {status && <p role="status" className="px-5 pb-4 text-sm text-slate-600">{status}</p>}
    {error && <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {candidates && candidates.length === 0 && <p className="px-5 pb-5 text-sm">No new matches found. Try a wider radius or add a competitor manually.</p>}
    {candidates && candidates.length > 0 && <><div className="grid gap-3 px-5 pb-5 md:grid-cols-2">{candidates.map(candidate => {
      const saved = added.includes(candidate.key)
      return <article key={candidate.key} className={`min-w-0 rounded-xl border p-4 ${saved ? 'border-emerald-200 bg-emerald-50' : selected.includes(candidate.key) ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" disabled={busy || saved} checked={saved || selected.includes(candidate.key)} onChange={e => setSelected(old => e.target.checked ? [...old, candidate.key] : old.filter(key => key !== candidate.key))}/><span className="min-w-0"><span className="block font-semibold">{candidate.values.name}</span><span className="mt-1 block text-sm text-slate-500">{candidate.values.address || 'Address unavailable'}</span></span></label>
        <div className="mt-3 flex flex-wrap gap-3 text-xs">{saved && <span className="flex items-center gap-1 text-emerald-800"><Check className="h-3.5 w-3.5"/>Added</span>}{candidate.values.website_url && <a href={candidate.values.website_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-indigo-700">Website<ExternalLink className="h-3.5 w-3.5"/></a>}{candidate.sourceUrl && <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="text-indigo-700 underline">View listing</a>}</div>
      </article>
    })}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50 px-5 py-4"><button disabled={busy} onClick={() => setSelected(candidates.filter(candidate => !added.includes(candidate.key)).map(candidate => candidate.key))} className="text-sm text-indigo-700 underline">Select all new matches</button><button disabled={busy || !selected.length} onClick={() => void addSelected()} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4"/>Add selected ({selected.length})</button></div></>}
  </section>
}
