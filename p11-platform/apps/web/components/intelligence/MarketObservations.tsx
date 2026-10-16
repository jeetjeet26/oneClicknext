import Link from 'next/link'
import type { Portfolio } from '@/utils/intelligence/portfolio'
import { WorkspaceDisclosure } from '@/components/ui/WorkspaceSection'

type Property = Portfolio['properties'][number]
const amount = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  : 'Date not recorded'

export function MarketObservations({ property, client }: { property: Property; client: boolean }) {
  const units = property.market.units
  function observation(unit: (typeof units)[number]) {
    const name = property.market.competitors.find(c => c.id === unit.competitor_id)?.name ?? 'Competitor'
    return <article key={unit.id} className="market-observation">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h4 className="font-semibold">{name}</h4><p className="mt-1 text-sm text-gray-600">{unit.unit_type} · {unit.bedrooms == null ? 'Bedrooms not recorded' : unit.bedrooms === 0 ? 'Studio' : `${unit.bedrooms} bedroom${unit.bedrooms === 1 ? '' : 's'}`}</p></div>
        <p className="text-lg font-semibold tabular-nums">{unit.rent_min === null ? 'Rent unavailable' : amount(unit.rent_min)}{unit.rent_max && unit.rent_max !== unit.rent_min ? `–${amount(unit.rent_max)}` : ''}</p>
      </div>
      <p className="mt-3 text-sm text-gray-600">Observed {date(unit.last_updated_at)} · {unit.available_count == null ? 'Availability not recorded' : `${unit.available_count} available`}</p>
      {unit.move_in_specials && <p className="mt-2 text-sm">{unit.move_in_specials}</p>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">Source and price dates</summary><div className="mt-2 space-y-1 text-gray-600">
        <p>Price effective: {date(unit.evidence?.effective_at)}</p><p>Source captured: {date(unit.evidence?.captured_at)}</p>
        {unit.evidence?.source_url && /^https?:\/\//i.test(unit.evidence.source_url) && <a className="inline-block py-2 underline underline-offset-4" href={unit.evidence.source_url} target="_blank" rel="noopener noreferrer">View original source</a>}
      </div></details>
    </article>
  }
  return <section className="space-y-4" aria-label="Market context">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Market context</h3><p className="mt-1 text-sm text-gray-600">{property.score.market ?? 'Market not recorded'} · Saved asking rents</p></div>{!client && <Link className="console-action" href="/dashboard/marketvision">Compare in MarketVision</Link>}</div>
    <p className="text-sm text-gray-600">Asking rents can change. These observations are not verified leases or a market-wide average.</p>
    {units.length ? <div className="grid gap-3 lg:grid-cols-2">{units.slice(0, 4).map(observation)}</div> : <p className="text-sm text-gray-600">No saved competitor prices for this property.</p>}
    {units.length > 4 && <WorkspaceDisclosure title={`Show ${units.length - 4} more observations (${units.length} total)`}><div className="grid gap-3 lg:grid-cols-2">{units.slice(4).map(observation)}</div></WorkspaceDisclosure>}
    {property.market.limited && <p className="text-sm text-gray-600">Showing a limited recent sample.</p>}
  </section>
}
