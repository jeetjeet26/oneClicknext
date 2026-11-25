import type { AdvertisedSalePrice } from '@/utils/marketvision/sale-prices'
import type { CompetitorProfile } from '@/utils/marketvision/profiles'
import { money, profileDate } from './CompetitorProfileContent'

export function SalePriceEvidence({ price }: { price?: AdvertisedSalePrice | null }) {
  if (!price) return <span className="text-slate-500">No advertised sale price captured</span>
  return <div>
    <p className="font-semibold" title={price.quote}>{money(price.amount)}</p>
    <a href={price.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-700 underline">Builder page</a>
    <span className="text-xs text-slate-500"> · Captured {profileDate(price.fetchedAt)}</span>
  </div>
}

export function MarketSalePricing({ competitors }: { competitors: CompetitorProfile[] }) {
  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-xl font-semibold">Advertised starting sale prices</h2>
    <p className="text-sm text-slate-500">Builder prices reflect the saved page on the capture date. Homesite premiums, upgrades and availability can vary.</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr className="border-b"><th scope="col" className="p-3">Competitor</th><th scope="col" className="p-3">Starting sale price</th></tr></thead>
      <tbody>{competitors.filter(c => c.isActive).map(c => <tr key={c.id} className="border-b"><th scope="row" className="p-3 font-medium">{c.name}</th><td className="p-3"><SalePriceEvidence price={c.salePrice} /></td></tr>)}</tbody>
    </table></div>
  </section>
}
