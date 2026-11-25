'use client'

import { DISCOVERY_GROUPS } from '@/utils/marketvision/discovery-contracts'
import { currentClaims, discoveryComparison, rentSummary, type CompetitorProfile, type SubjectProfile } from '@/utils/marketvision/profiles'
import { getPropertyTypeLabel, normalizePropertyType } from '@/utils/property-types'
import { money, profileDate } from './CompetitorProfileContent'
import { SalePriceEvidence } from './MarketSalePricing'

type Plan = { bedrooms: number; rentMin: number | null }

function bedroomLabel(count: number) {
  return count === 0 ? 'Studio' : String(count)
}

function bedroomMix(plans: Plan[]) {
  const counts = [...new Set(plans.map(plan => plan.bedrooms))].sort((a, b) => a - b)
  return counts.map(bedroomLabel).join(', ') || 'Not recorded'
}

function competitiveFit(competitor: CompetitorProfile) {
  const notes = competitor.notes?.split('\n') ?? []
  const tier = Object.values(DISCOVERY_GROUPS).find(group => notes.includes(group))
  return { tier, assessment: discoveryComparison(competitor.notes) }
}

function RentValue({ plans, bedrooms, scopeNeedsReview }: { plans: Plan[]; bedrooms: number; scopeNeedsReview?: boolean }) {
  if (scopeNeedsReview) return <span className="text-slate-500">Withheld pending scope review</span>

  const { mean, priced, total } = rentSummary(plans, bedrooms)
  if (!total) return <span className="text-slate-500">No saved plans</span>

  return <>
    <span className="font-semibold tabular-nums">{money(mean)}</span>
    <span className="block text-xs text-slate-500">{priced} of {total} plans priced</span>
  </>
}

function FitValue({ fit }: { fit: ReturnType<typeof competitiveFit> }) {
  if (!fit.assessment) return <span className="text-slate-600">{fit.tier || 'No discovery assessment saved'}</span>

  return <details>
    <summary className="cursor-pointer font-medium text-slate-700">{fit.tier || 'View assessment'}</summary>
    <p className="mt-2 text-slate-600">{fit.assessment}</p>
  </details>
}

export function CompetitorProfileComparison({ subject, competitors }: { subject: SubjectProfile; competitors: CompetitorProfile[] }) {
  const subjectPlans = subject.units.map(unit => ({ bedrooms: unit.bedrooms, rentMin: unit.rent_min }))
  const rows = competitors.map(competitor => ({
    competitor,
    fit: competitiveFit(competitor),
    plans: (competitor.units ?? []).filter(unit => !competitor.withheldUnitIds?.includes(unit.id)),
  }))
  const showSalePrice = Boolean(subject.forSale || competitors.some(competitor => competitor.salePrice))
  const showFit = rows.some(({ fit }) => fit.tier || fit.assessment)
  const rentalPlans = rows.flatMap(({ competitor, plans }) => competitor.scopeNotes.length || competitor.salePrice ? [] : plans)
  const rentBedrooms = subject.forSale
    ? []
    : [...new Set([...subjectPlans, ...rentalPlans].map(plan => plan.bedrooms))].sort((a, b) => a - b)

  const propertyColumn = 'sticky left-0 z-10 w-44 min-w-36 max-w-44 border-r border-slate-200 p-3 align-top [overflow-wrap:anywhere]'
  const cell = 'p-3 align-top'
  const textCell = `${cell} min-w-44 max-w-64 break-words`

  return <section aria-label="Competitor comparison" className="rounded-xl border border-slate-200 bg-white p-5 text-slate-900">
    <h3 className="text-lg font-semibold">Compare with {subject.name}</h3>
    {!subject.forSale && <p className="mt-1 text-sm text-slate-500">
      {rentBedrooms.length
        ? 'Mean advertised starting rent per saved plan by bedroom count. Your property uses approved prices. Competitor prices may be older and have different lease terms.'
        : 'No saved rent prices are available for this comparison.'}
    </p>}
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600" role="region" aria-label="Property comparison table" tabIndex={0}>
      <table className="w-full border-separate border-spacing-0 text-left text-sm">
        <caption className="sr-only">Saved property details, pricing, and brand evidence for your property and selected competitors</caption>
        <thead className="bg-slate-50">
          <tr>
            <th scope="col" className={`${propertyColumn} bg-slate-50`}>Property</th>
            {showSalePrice && <th scope="col" className={`${cell} min-w-36`}>Advertised starting sale price</th>}
            {rentBedrooms.map(count => <th key={count} scope="col" className={`${cell} min-w-28`}>
              {count === 0 ? 'Studio rent' : `${count}-bed rent`}
            </th>)}
            <th scope="col" className={`${cell} min-w-28`}>Property type</th>
            <th scope="col" className={cell}>Bedrooms</th>
            {showFit && <th scope="col" className={`${cell} min-w-36`}>Competitive fit</th>}
            <th scope="col" className={textCell}>Positioning</th>
            <th scope="col" className={textCell}>Amenities</th>
          </tr>
        </thead>
        <tbody className="[&_tr>*]:border-t [&_tr>*]:border-slate-200">
          <tr className="bg-emerald-50/50">
            <th scope="row" className={`${propertyColumn} bg-emerald-50 font-semibold`}>
              {subject.name}
              <span className="mt-1 block text-xs font-normal text-emerald-800">Your property</span>
            </th>
            {showSalePrice && <td className={`${cell} text-slate-500`}>
              {subject.forSale ? 'No approved sale price in MarketVision' : 'Not applicable'}
            </td>}
            {rentBedrooms.map(count => <td key={count} className={cell}><RentValue plans={subjectPlans} bedrooms={count} /></td>)}
            <td className={cell}>{getPropertyTypeLabel(normalizePropertyType(subject.propertyType))}</td>
            <td className={cell}>{bedroomMix(subjectPlans)}</td>
            {showFit && <td className={`${cell} text-slate-500`}>Reference property</td>}
            <td className={`${cell} text-slate-500`}>See your approved brand profile</td>
            <td className={`${cell} text-slate-500`}>See your property details</td>
          </tr>
          {rows.map(({ competitor, fit, plans }) => {
            const scopeNeedsReview = competitor.scopeNotes.length > 0
            const positioning = currentClaims(competitor, 'positioning')
            const amenities = currentClaims(competitor, 'amenity')
            const historical = competitor.historicalBrand
            const shownAmenities = amenities.length ? amenities : competitor.amenities
            return <tr key={competitor.id} className="group">
              <th scope="row" className={`${propertyColumn} bg-white font-semibold group-hover:bg-slate-50`}>
                {competitor.name}
                {scopeNeedsReview && <span className="mt-1 block text-xs font-normal text-amber-800">Scope needs review</span>}
              </th>
              {showSalePrice && <td className={`${cell} tabular-nums`}><SalePriceEvidence price={competitor.salePrice} /></td>}
              {rentBedrooms.map(count => <td key={count} className={cell}>
                {competitor.salePrice && !scopeNeedsReview
                  ? <span className="text-slate-500">Not applicable</span>
                  : <RentValue plans={plans} bedrooms={count} scopeNeedsReview={scopeNeedsReview} />}
              </td>)}
              <td className={cell}>{getPropertyTypeLabel(normalizePropertyType(competitor.propertyType))}</td>
              <td className={cell}>{scopeNeedsReview ? 'Scope needs review' : bedroomMix(plans)}</td>
              {showFit && <td className={cell}><FitValue fit={fit} /></td>}
              <td className={textCell}>
                {positioning.join(' ') || historical?.positioning || 'Not recorded'}
                {positioning.length > 0
                  ? <span className="mt-1 block text-xs text-slate-500">Reviewed {profileDate(competitor.reviewedBrand?.createdAt)}</span>
                  : historical?.positioning && <span className="mt-1 block text-xs text-slate-500">Historical · {profileDate(historical.analyzedAt)}</span>}
              </td>
              <td className={textCell}>
                {shownAmenities.join(' · ') || historical?.amenities.join(' · ') || 'Not recorded'}
                {!shownAmenities.length && Boolean(historical?.amenities.length) && <span className="mt-1 block text-xs text-slate-500">Historical analysis</span>}
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
  </section>
}
