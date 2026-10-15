import type { periodMeasures, funnelRates, leaseAttribution, spendingRatios } from '@/utils/intelligence/reporting';

export function ReportingDetail({ measures, rates, attribution, spending }: {
  measures: ReturnType<typeof periodMeasures>;
  rates: ReturnType<typeof funnelRates>;
  attribution: ReturnType<typeof leaseAttribution>;
  spending: ReturnType<typeof spendingRatios>;
}) {
  return <>
    <h3 className="mt-6 font-medium">Activity recorded in this period</h3>
    <p className="mt-2 text-sm text-gray-500">Reviewed source totals, separate from the inquiry cohort below. Sources are not added together. These observations do not establish complete leasing coverage or marketing attribution.</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {measures.filter(m => m.sources.length > 0).map(m => <div key={m.metric} className="rounded-lg border p-4 text-sm">
        <strong>{m.label}</strong>
        {!m.sources.length ? <p className="mt-2 text-gray-500">Source data required</p> : m.sources.map((s, i) => <div key={i} className="mt-2">
          <p>{s.value === null ? 'Conflicting observations — review required' : s.value.toLocaleString()} {s.unit} · {s.source}</p>
          {s.definition && <p className="mt-1 text-xs text-gray-500">{s.definition}</p>}
          <p className="mt-1 text-xs text-gray-500">{m.aggregation === 'snapshot' ? 'Snapshot' : `${s.observedDays} observed days`} · Latest {s.latest}</p>
        </div>)}
      </div>)}
    </div>
    {measures.some(m => !m.sources.length) && <details className="mt-3 text-sm text-gray-500"><summary className="cursor-pointer">Data not yet available ({measures.filter(m => !m.sources.length).length} measures)</summary><p className="mt-2">{measures.filter(m => !m.sources.length).map(m => m.label).join(', ')}. These will appear after source data is reviewed.</p></details>}
    <h3 className="mt-6 font-medium">Inquiry cohort stage ratios</h3>
    <p className="mt-2 text-sm text-gray-500">Leads first recorded in this period, with outcomes recorded through its end. Ratios compare separately recorded stage counts; they are not verified person-by-person transition rates. Recent cohorts have had less time to progress.</p>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">{rates.map(r => <div key={r.label} className="rounded-lg bg-stone-50 p-4 text-sm"><dt>{r.label}</dt><dd className="mt-1 font-medium">{r.ratio === null ? 'Unavailable' : `${(r.ratio * 100).toFixed(1)}%`} <span className="font-normal text-gray-500">({r.outcomes} / {r.starting})</span></dd></div>)}</dl>
    <h3 className="mt-6 font-medium">Recorded spending relative to outcomes</h3>
    <p className="mt-2 text-sm text-gray-500">Period marketing spend divided by recorded inquiry-cohort outcomes. These are descriptive ratios, not attributed acquisition costs. Figures are withheld when marketing dates or measures are incomplete; complete dates do not prove every source is connected.</p>
    <dl className="mt-3 grid gap-3 sm:grid-cols-2">{spending.map(s => <div key={s.label} className="rounded-lg border p-4 text-sm"><dt>Spend per {s.label}</dt><dd>{s.value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(s.value)}</dd></div>)}</dl>
    <h3 className="mt-6 font-medium">Marketing attribution</h3>
    {attribution.map((a, i) => <div key={i} className="mt-3 rounded-lg border p-4 text-sm">
      <strong>{a.source} · {a.model === 'first_touch' ? 'First touch' : 'Last touch'}</strong>
      <p className="mt-2">{a.matched} of {a.total} imported leases linked ({a.coverage === null ? 'Unavailable' : `${(a.coverage * 100).toFixed(1)}%`}). {a.unknown} unknown; {a.conflicting} conflicting.</p>
      <ul className="mt-2">{a.channels.map(c => <li key={c.channel}>{c.channel}: {c.leases} leases</li>)}</ul>
      <p className="mt-2 text-xs text-gray-500">Coverage of this reviewed source export only, not all real-world leases. Attribution describes a recorded connection, not proof of causation. Sources and models are not added together.</p>
    </div>)}
    {!attribution.length && <p className="mt-2 text-sm text-gray-500">Lease attribution and cost per attributed lease are unavailable until leasing outcomes are reconciled with prospect and marketing records. An inquiry source or advertising conversion does not establish a signed lease. Unknown sources remain unknown.</p>}
  </>;
}
