import type { CompetitorUnit } from '@/utils/marketvision/records'
import { money } from './CompetitorProfileContent'

export function CompetitorPriceOverview({units, withheld = []}: {units: CompetitorUnit[]; withheld?: string[]}) {
  const priced = units.filter(unit => !withheld.includes(unit.id) && unit.rentMin !== null)
  const groups = [...new Set(priced.map(unit => unit.bedrooms))].sort((a, b) => a - b).map(bedrooms => {
    const plans = priced.filter(unit => unit.bedrooms === bedrooms)
    return {bedrooms, count: plans.length, min: Math.min(...plans.map(unit => unit.rentMin!)), max: Math.max(...plans.map(unit => unit.rentMin!))}
  })
  if (!groups.length) return null
  const ceiling = Math.max(1, ...groups.map(group => group.max))
  return <section aria-label="Floor plan price comparison" className="mx-4 mb-5 rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-slate-900">Pricing at a glance</h3><span className="text-xs text-slate-500">Saved starting rents / month</span></div>
    <div className="space-y-4">{groups.map(group => <div key={group.bedrooms}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-medium text-slate-700">{group.bedrooms === 0 ? 'Studio' : `${group.bedrooms} bedroom`}<span className="ml-2 text-xs font-normal text-slate-500">{group.count} plans</span></span><span className="font-semibold tabular-nums text-indigo-900">{money(group.min)}{group.max !== group.min ? ` – ${money(group.max)}` : ''}</span></div>
      <div aria-hidden="true" className="h-2.5 overflow-hidden rounded-full bg-indigo-100"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{width: `${group.max / ceiling * 100}%`}}/></div>
    </div>)}</div>
    <p className="mt-4 text-xs text-slate-500">Ranges compare starting rents across saved floor plans. Availability and current asking rents may differ.</p>
  </section>
}
