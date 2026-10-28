'use client'
import { DecisionNote } from '@/components/ui/decision-note'
import { useEffect, useRef, useState } from 'react'
import { scrapeCompetitor } from '@/utils/marketvision/scrape-client'
import { Building2, ExternalLink, Plus, RefreshCw, Search } from 'lucide-react'
import { sendMarketDecision } from '@/utils/marketvision/decision-client'
import { profileText, rentSummary, type CompetitorProfile } from '@/utils/marketvision/profiles'
import { useCompetitorProfiles } from '@/utils/marketvision/use-profiles'
import { CompetitorProfileContent, money, profileDate, safeWebsite } from './CompetitorProfileContent'
import { CompetitorDiscovery } from './CompetitorDiscovery'
import { CompetitorProfileComparison } from './CompetitorProfileComparison'

interface CompetitorListProps {
  propertyId: string | undefined
  onAddClick: () => void
  onEditClick: (competitor: CompetitorProfile) => void
  onViewClick: (competitor: CompetitorProfile) => void
  onRefresh?: () => void
}
export function CompetitorList({propertyId, onAddClick, onEditClick, onViewClick}: CompetitorListProps) {
  const {data, loading, error, refresh} = useCompetitorProfiles(propertyId)
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [compare, setCompare] = useState(false)
  const [decision, setDecision] = useState<CompetitorProfile | null>(null)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [scrapeMessages, setScrapeMessages] = useState<Record<string, string>>({})
  const [scraping, setScraping] = useState(false)
  const scrapeLock = useRef(false)
  const generation = useRef(0)
  useEffect(() => { const current = ++generation.current; return () => { generation.current = current + 1 } }, [propertyId])
  async function scrape(targets: CompetitorProfile[]) {
    if (!propertyId || scrapeLock.current) return
    const current = generation.current
    const scope = propertyId
    scrapeLock.current = true
    setScraping(true)
    try {
      for (const competitor of targets) {
        if (current !== generation.current) break
        const key = `${scope}:${competitor.id}`
        setScrapeMessages(old => ({...old, [key]: 'Requesting scrape…'}))
        let message: string
        try { message = await scrapeCompetitor(scope, competitor.id) }
        catch (e) { message = e instanceof Error ? e.message : 'Scrape could not be confirmed. Retry or review saved work.' }
        if (current === generation.current) setScrapeMessages(old => ({...old, [key]: message}))
      }
    } finally { scrapeLock.current = false; setScraping(false) }
  }
  const competitors = data?.competitors ?? []
  const active = competitors.filter(c => c.isActive)
  const visible = competitors.filter(c => (showInactive || c.isActive) && profileText(c).includes(search.trim().toLowerCase()))
  const comparison = active.filter(c => selected.includes(c.id)).slice(0,4)
  async function toggleActive() {
    if (!decision || !propertyId) return
    setSaving(true); setSaveError(null)
    try {
      await sendMarketDecision('/api/marketvision/competitors', 'PUT', {propertyId, competitorId: decision.id, expectedVersion: decision.version, action: decision.isActive ? 'archive' : 'restore', reason})
      setSelected(old=>old.filter(id=>id!==decision.id)); setDecision(null); setReason(''); refresh()
    } catch (e) {setSaveError(e instanceof Error ? e.message : 'This decision could not be confirmed.')}
    finally {setSaving(false)}
  }
  if (!propertyId) return <p className="rounded-xl border border-slate-200 bg-white p-8">Select a property to view competitors.</p>
  return <section aria-label="Competitor profiles" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold">Your competitive set</h2><p className="mt-1 text-sm text-slate-500">{loading ? 'Loading profiles…' : `${active.length} active competitors · ${competitors.length - active.length} archived`} · pricing, positioning, amenities and saved research</p></div>
      <div className="flex flex-wrap gap-2"><button onClick={() => setDiscoverOpen(v => !v)} aria-expanded={discoverOpen} className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-800">{discoverOpen ? 'Hide nearby search' : 'Find competitors nearby'}</button><button onClick={() => void scrape(active)} disabled={scraping || loading || !!error || !active.length} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40">{scraping ? 'Requesting scrapes…' : 'Scrape all'}</button><button onClick={() => setCompare(v => !v)} disabled={!comparison.length} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40">{compare ? 'Hide comparison' : `Compare selected (${comparison.length}/4)`}</button><button onClick={onAddClick} className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white"><Plus className="h-4 w-4" />Add Competitor</button></div>
    </div>
    {discoverOpen && <CompetitorDiscovery key={propertyId} propertyId={propertyId} onAdded={refresh}/>}
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <label className="relative min-w-48 flex-1"><span className="sr-only">Search competitor profiles</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names, amenities, positioning or saved research…" className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-3 text-sm" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />Show archived</label>
      <button aria-label="Reload competitors" disabled={loading || saving} onClick={refresh} className="rounded-lg border border-slate-200 p-2 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
    </div>
    <p className="text-sm text-slate-500">Scrape now fetches one saved website page, or the Apartments.com listing if no website is saved. Scrape all includes every active competitor, even when filtered. Review fetched pages in the full profile before applying prices. Keep this page open while requests are submitted.</p>
    {(error || saveError) && <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">{error || saveError}</p>}
    {data?.warnings.map(w => <p role="status" key={w} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{w}</p>)}
    {decision && <section aria-label="Review competitor status" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"><p>{decision.isActive ? 'Archive' : 'Restore'} {decision.name}? Saved units and history will be retained.</p><DecisionNote><label className="block text-sm">Note (optional)<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} className="block w-full rounded border p-2" /></label></DecisionNote><button disabled={saving} onClick={toggleActive} className="rounded border px-3 py-2 disabled:opacity-50">{saving ? 'Saving…' : decision.isActive ? 'Archive competitor' : 'Restore competitor'}</button> <button disabled={saving} onClick={() => setDecision(null)}>Cancel</button></section>}
    {compare && data && comparison.length > 0 && <CompetitorProfileComparison subject={data.subject} competitors={comparison} />}
    {loading ? <p role="status" className="p-8 text-center text-slate-500">Loading competitor profiles and saved intelligence…</p> : !error && visible.length === 0 ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-center"><Building2 className="mx-auto mb-3 h-8 w-8 text-slate-400" /><p>{search ? 'No saved profiles match your search.' : 'No competitors in this view.'}</p>{!search && <button onClick={onAddClick} className="mt-3 text-emerald-700 underline">Add a competitor</button>}</div> : <div className="grid items-start gap-5 xl:grid-cols-2">
      {visible.map(c => {
        const rents = rentSummary((c.units ?? []).filter(u => !c.withheldUnitIds?.includes(u.id)))
        const url = safeWebsite(c.websiteUrl)
        return <article key={c.id} aria-label={`${c.name} profile`} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50/60 p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold"><button onClick={() => onViewClick(c)} className="text-left hover:text-emerald-700">{c.name}</button></h3><p className="mt-1 text-sm text-slate-500">{c.address || 'Address not recorded'}</p></div>{!c.isActive ? <span className="rounded-full bg-slate-200 px-2 py-1 text-xs">Archived</span> : <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" aria-label={`Compare ${c.name}`} checked={comparison.some(item=>item.id===c.id)} disabled={!comparison.some(item=>item.id===c.id) && comparison.length >= 4} onChange={e => setSelected(old => e.target.checked ? [...old, c.id] : old.filter(id => id !== c.id))} />Compare</label>}</div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2"><div><p className="text-xl font-semibold">{c.scopeNotes.length ? 'Scope needs review' : money(rents.mean)}</p><p className="text-xs text-slate-500">{c.scopeNotes.length ? 'Prices withheld from comparison' : 'Mean saved starting rent'}</p></div><div><p className="text-xl font-semibold">{rents.priced}<span className="text-sm font-normal text-slate-500"> / {c.units?.length ?? 0}</span></p><p className="text-xs text-slate-500">Plans with usable prices</p></div></div>
          <p className="mt-3 text-xs text-slate-500">Last saved price observation: {profileDate((c.units ?? []).map(u => u.lastUpdatedAt).filter(Boolean).sort().at(-1))}</p>{Boolean(c.withheldUnitIds?.length) && <p className="mt-2 text-xs text-amber-800">Some prices are withheld pending a price-history check. Open the profile to review saved values.</p>}</div>
          <div className="p-5"><CompetitorProfileContent profile={c} compact /></div>
          <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 p-4 text-sm"><button onClick={() => onViewClick(c)} className="rounded-lg bg-emerald-700 px-3 py-2 font-medium text-white">View full profile</button>{c.isActive && <button onClick={() => void scrape([c])} disabled={scraping || saving} className="rounded-lg border border-slate-200 px-3 py-2 disabled:opacity-40">Scrape now</button>}{url && <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-slate-600">Website<ExternalLink className="h-3.5 w-3.5" /></a>}<details className="ml-auto"><summary aria-label={`Actions for ${c.name}`} className="cursor-pointer text-slate-500">Manage</summary><div className="mt-2 flex gap-4"><button onClick={() => onEditClick(c)} className="underline">Edit</button><button disabled={saving} onClick={() => {setDecision(c); setReason('')}} className="underline">{c.isActive ? 'Archive' : 'Restore'}</button></div></details></div>
          {scrapeMessages[`${propertyId}:${c.id}`] && <p role="status" className="border-t px-4 py-3 text-sm">{scrapeMessages[`${propertyId}:${c.id}`]}</p>}
        </article>
      })}
    </div>}
  </section>
}
