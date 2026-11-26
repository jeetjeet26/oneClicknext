'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Document } from '@/utils/intelligence/contracts'
import { aiRecommendationGeneration } from '@/utils/intelligence/recommendation-contracts'

function defaultPeriod(days = 30) {
  const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  return { start: new Date(Date.parse(end) - (days - 1) * 86400000).toISOString().slice(0, 10), end }
}
const input = 'mt-1 rounded-lg border border-gray-300 bg-white p-2 text-sm'

export function AIRecommendations({ propertyId, propertyName, documents, canManage, onChanged }: {
  propertyId: string; propertyName: string; documents: Document[]; canManage: boolean; onChanged: () => Promise<void>;
}) {
  const reports = documents.flatMap(document => {
    if (document.kind !== 'recommendation' || ['withdrawn', 'dismissed'].includes(document.status)) return []
    const parsed = aiRecommendationGeneration.safeParse((document.payload as Record<string, unknown>).generation)
    return parsed.success ? [{ document, generation: parsed.data }] : []
  }).sort((a, b) => b.generation.generatedAt.localeCompare(a.generation.generatedAt))
  const [period, setPeriod] = useState(defaultPeriod)
  const [preset, setPreset] = useState('30')
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const attempted = useRef(false)
  const mounted = useRef(true)
  const request = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const generate = useCallback(async () => {
    const version = ++request.current
    const current = () => mounted.current && request.current === version
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/intelligence/recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, ...period }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'AI recommendations could not be generated.')
      if (!current()) return
      await onChanged()
      if (!current()) return
      setSelected(body.document.id)
      setNotice(body.reused ? 'The saved analysis already reflects these sources.' : 'AI recommendations updated from the selected community’s evidence.')
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : 'AI recommendations could not be generated.')
    } finally { if (current()) setBusy(false) }
  }, [propertyId, period, onChanged])
  useEffect(() => {
    if (reports.length || !canManage || attempted.current) return
    attempted.current = true
    void generate()
  }, [reports.length, canManage, generate])
  const report = reports.find(item => item.document.id === selected) ?? reports[0]
  const generation = report?.generation
  return <div className="space-y-6">
    <section className="console-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">AI analysis</p>
          <h2 className="mt-1 text-xl font-semibold">Recommendations for {propertyName}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">Prioritized actions based on campaign performance, community knowledge and captured market evidence. Each suggestion explains what to change, why, and how to measure it.</p>
        </div>
        {canManage && <button className="console-action-primary" disabled={busy || !period.start || !period.end || period.start > period.end} onClick={() => void generate()}>{busy ? 'Analyzing community data…' : generation ? 'Refresh AI recommendations' : 'Generate AI recommendations'}</button>}
      </div>
      {canManage && <fieldset disabled={busy} className="mt-5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">Reporting period<select className={input} value={preset} onChange={event => {
          setPreset(event.target.value)
          if (event.target.value !== 'custom') setPeriod(defaultPeriod(Number(event.target.value)))
        }}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 180 days</option><option value="custom">Custom dates</option></select></label>
        <label className="flex flex-col text-sm">Start date<input className={input} type="date" value={period.start} max={period.end} onChange={event => { setPreset('custom'); setPeriod(value => ({ ...value, start: event.target.value })) }} /></label>
        <label className="flex flex-col text-sm">End date<input className={input} type="date" value={period.end} min={period.start} max={defaultPeriod().end} onChange={event => { setPreset('custom'); setPeriod(value => ({ ...value, end: event.target.value })) }} /></label>
      </fieldset>}
      {busy && <p role="status" className="mt-4 text-sm text-gray-600">Comparing campaigns and reviewing the evidence. Your saved analysis remains available below.</p>}
      {error && <p role="alert" className="console-error mt-4">{error}</p>}
      {notice && <p role="status" className="mt-4 text-sm text-emerald-800">{notice}</p>}
      <p className="mt-4 text-xs text-gray-500">Recommendations are proposals. Campaign changes, spending and publishing require approval in the relevant product.</p>
    </section>
    {generation ? <>
      <section className="console-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h3 className="font-semibold">Analysis for {generation.start}–{generation.end}</h3><p className="mt-2 text-sm leading-6">{generation.summary}</p><p className="mt-2 text-xs text-gray-500">Generated {new Date(generation.generatedAt).toLocaleString()} · {generation.sources.length} saved evidence sources</p></div>
          {reports.length > 1 && <label className="flex flex-col text-sm">Saved analyses<select className={input} value={report.document.id} onChange={event => setSelected(event.target.value)}>{reports.map(item => <option key={item.document.id} value={item.document.id}>{item.generation.start}–{item.generation.end} · {new Date(item.generation.generatedAt).toLocaleDateString()}</option>)}</select></label>}
        </div>
        {generation.withheldCount > 0 && <p className="mt-3 text-sm text-gray-600">{generation.withheldCount} additional suggestion{generation.withheldCount === 1 ? ' was' : 's were'} withheld because the evidence did not support it.</p>}
        {!generation.recommendations.length && <p className="mt-4 text-sm">No action met the evidence requirements for this period. Connect or refresh the relevant data sources, then analyze again.</p>}
      </section>
      {generation.recommendations.map((item, index) => <article key={`${report.document.id}:${index}`} className="console-panel p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium"><span className={`rounded-full px-3 py-1 ${item.priority === 'high' ? 'bg-orange-100 text-orange-900' : 'bg-stone-100 text-stone-700'}`}>{item.priority.charAt(0).toUpperCase() + item.priority.slice(1)} priority</span><span className="rounded-full bg-stone-100 px-3 py-1 capitalize">{item.category}</span><span className="text-gray-500">{item.confidence} confidence</span></div>
        <h3 className="mt-3 text-lg font-semibold">{item.title}</h3>
        <p className="mt-3 text-sm leading-6">{item.finding}</p>
        <p className="mt-2 text-sm leading-6 text-gray-600">{item.rationale}</p>
        <div className="mt-5 rounded-xl bg-orange-50 p-4"><h4 className="text-sm font-semibold">Recommended action</h4><p className="mt-2 text-sm leading-6">{item.action}</p><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">{item.steps.map((step, i) => <li key={i}>{step}</li>)}</ol></div>
        <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2"><div><dt className="font-semibold">Measure: {item.targetMetric}</dt><dd className="mt-1 leading-6 text-gray-600">{item.measurement}</dd></div><div><dt className="font-semibold">Expected impact</dt><dd className="mt-1 leading-6 text-gray-600">{item.expectedImpact}</dd></div><div><dt className="font-semibold">Stop or reverse</dt><dd className="mt-1 leading-6 text-gray-600">{item.rollback}</dd></div><div><dt className="font-semibold">Limits of the evidence</dt><dd><ul className="mt-1 list-disc space-y-1 pl-5 leading-6 text-gray-600">{item.limitations.map((limit, i) => <li key={i}>{limit}</li>)}</ul></dd></div></dl>
        <details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Supporting evidence ({item.evidenceIds.length})</summary><ul className="mt-3 space-y-3 text-sm">{item.evidenceIds.map(id => {
          const source = generation.sources.find(value => value.id === id)
          if (!source) return null
          const external = /^https?:\/\//.test(source.reference)
          const href = external ? source.reference : id.startsWith('knowledge:') ? '/dashboard/community' : id.startsWith('market:') ? '/dashboard/marketvision' : '/dashboard/intelligence?section=campaigns'
          return <li key={id}><a href={href} className="underline" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{source.label}</a><p className="mt-1 text-xs text-gray-500">Evidence saved {new Date(source.observedAt).toLocaleString()}</p></li>
        })}</ul></details>
      </article>)}
    </> : !busy && <section className="console-panel p-6"><h3 className="font-semibold">AI recommendations</h3><p className="mt-2 text-sm text-gray-600">{canManage ? 'Generate an analysis of this community’s current evidence to see recommended actions.' : 'No AI analysis has been generated for this community yet.'}</p><Link href="/dashboard/intelligence?section=campaigns" className="mt-4 inline-block text-sm underline">View campaign performance</Link></section>}
  </div>
}
