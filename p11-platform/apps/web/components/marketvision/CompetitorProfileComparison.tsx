'use client'

import { currentClaims, rentSummary, type CompetitorProfile, type SubjectProfile } from '@/utils/marketvision/profiles'
import { money, profileDate } from './CompetitorProfileContent'

export function CompetitorProfileComparison({ subject, competitors }: { subject: SubjectProfile; competitors: CompetitorProfile[] }) {
  const subjectUnits = subject.units.map(u => ({ bedrooms: u.bedrooms, rentMin: u.rent_min }))
  const bedrooms = [...new Set([...subjectUnits, ...competitors.flatMap(c => c.units ?? [])].map(u => u.bedrooms))].sort((a, b) => a - b)
  return <section aria-label="Competitor comparison" className="rounded-xl border border-slate-200 bg-white p-5 text-slate-900">
    <h3 className="text-lg font-semibold">Compare with {subject.name}</h3>
    <p className="mt-1 text-sm text-slate-500">Mean advertised starting rent per saved plan, grouped by bedroom count. Missing prices stay unknown. Your property uses approved prices; competitor prices may be older and have different lease terms.</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
      <caption className="sr-only">Saved rents and brand positioning for your property and selected competitors</caption>
      <thead><tr className="border-b"><th scope="col" className="p-3">Comparison</th><th scope="col" className="min-w-44 bg-emerald-50 p-3">{subject.name}<span className="block text-xs font-normal">Your property</span></th>{competitors.map(c => <th scope="col" key={c.id} className="min-w-52 p-3">{c.name}{c.scopeNotes.length > 0 && <span className="block text-xs font-normal text-amber-800">Scope needs review</span>}</th>)}</tr></thead>
      <tbody>
        {bedrooms.map(b => <tr key={b} className="border-b"><th scope="row" className="p-3">{b === 0 ? 'Studio' : `${b} bedroom`}</th>{[subjectUnits, ...competitors.map(c => c.scopeNotes.length ? [] : (c.units ?? []).filter(u => !c.conflictedUnitIds?.includes(u.id)))].map((units, i) => { const rents = rentSummary(units, b); return <td key={i} className={`p-3 ${i === 0 ? 'bg-emerald-50/50' : ''}`}><span className="font-semibold">{money(rents.mean)}</span><span className="block text-xs text-slate-500">{i > 0 && competitors[i - 1].scopeNotes.length ? 'Withheld until scope is reviewed' : `${rents.priced} of ${rents.total} plans priced`}</span></td> })}</tr>)}
        {!bedrooms.length && <tr><td colSpan={competitors.length + 2} className="p-3 text-slate-500">No saved prices are available for this comparison.</td></tr>}
        <tr className="border-b"><th scope="row" className="p-3">Positioning</th><td className="p-3 text-slate-500">See your approved brand profile</td>{competitors.map(c => {const claims = currentClaims(c, 'positioning'); return <td key={c.id} className="p-3 align-top">{claims.join(' ') || c.historicalBrand?.positioning || 'Not recorded'}<span className="mt-1 block text-xs text-slate-500">{claims.length ? `Reviewed ${profileDate(c.reviewedBrand?.createdAt)}` : c.historicalBrand ? `Historical · ${profileDate(c.historicalBrand.analyzedAt)}` : ''}</span></td>})}</tr>
        <tr><th scope="row" className="p-3">Amenities</th><td className="p-3 text-slate-500">See your property details</td>{competitors.map(c => <td key={c.id} className="p-3 align-top">{(currentClaims(c, 'amenity').length ? currentClaims(c, 'amenity') : c.amenities.length ? c.amenities : c.historicalBrand?.amenities ?? []).join(' · ') || 'Not recorded'}{!currentClaims(c, 'amenity').length && !c.amenities.length && c.historicalBrand && <span className="block text-xs text-slate-500">Historical analysis</span>}</td>)}</tr>
      </tbody>
    </table></div>
  </section>
}
