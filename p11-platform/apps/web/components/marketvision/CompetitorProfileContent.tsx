'use client'

import Link from 'next/link'
import { currentClaims, type CompetitorProfile } from '@/utils/marketvision/profiles'

export const profileDate = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unknown'
export const money = (value: number | null) => value === null ? 'Not available' : `$${value.toLocaleString()}`
export function safeWebsite(value: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

export function CompetitorProfileContent({ profile, compact = false }: { profile: CompetitorProfile; compact?: boolean }) {
  const old = profile.historicalBrand
  const reviewed = profile.reviewedBrand?.disposition === 'published' && profile.reviewedBrand.sourceCurrent
  const groups = old ? [
    ['Positioning', old.positioning ? [old.positioning] : []], ['Target audience', old.audience ? [old.audience] : []],
    ['Brand voice', [old.voice, old.personality].filter((v): v is string => Boolean(v))],
    ['Differentiators', old.differentiators], ['Amenities highlighted', old.amenities],
    ...(!compact ? [['Services', old.services], ['Lifestyle', old.lifestyles], ['Community events', old.events],
      ['Messaging themes', old.themes], ['Calls to action', old.callsToAction]] : []),
  ] as Array<[string, string[]]> : []
  return <div className="space-y-4 break-words text-sm">
    {profile.scopeNotes.map(note => <p key={note} className="rounded-lg bg-amber-50 p-3 text-amber-900">Scope needs review: {note}</p>)}
    {reviewed && <section className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-slate-900">
      <h4 className="font-semibold">Reviewed brand evidence</h4>
      <p className="text-xs text-slate-600">Reviewed {profileDate(profile.reviewedBrand?.createdAt)} · saved source evidence, not a live website check</p>
      {(compact ? ['positioning', 'audience', 'amenity'].flatMap(category => currentClaims(profile, category)).slice(0, 5) : profile.reviewedBrand!.claims.map(c => c.statement)).map((statement, i) => <p key={i}>{statement}</p>)}
    </section>}
    {old ? <section className="space-y-3">
      <div><h4 className="font-semibold">Historical brand analysis</h4><p className="text-xs text-slate-500">Analyzed {profileDate(old.analyzedAt)} · not verified as current</p></div>
      <dl className="space-y-3">{groups.filter(([, values]) => values.length).map(([label, values]) => <div key={label}>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-1 leading-relaxed">{compact ? values.slice(0, label === 'Amenities highlighted' ? 6 : 3).join(' · ') : values.join(' · ')}{compact && values.length > (label === 'Amenities highlighted' ? 6 : 3) && <span className="text-slate-500"> …</span>}</dd>
      </div>)}</dl>
      {!compact && (old.promotions.length > 0 || old.promotionalMessaging || old.urgency.length > 0) && <div className="rounded-lg bg-amber-50 p-3 text-amber-950"><h5 className="font-semibold">Previously observed offers</h5><p className="mb-2 text-xs">Historical only. Availability and expiry have not been verified.</p>{old.promotions.map((offer, i) => <p key={i}>{offer}</p>)}{old.promotionalMessaging && <p>{old.promotionalMessaging}</p>}{old.urgency.length > 0 && <p>{old.urgency.join(' · ')}</p>}</div>}
    </section> : !reviewed && <p className="text-slate-500">No brand analysis saved yet. Pricing and property details remain available.</p>}
    {profile.amenities.length > 0 && <p><span className="font-semibold">Saved property amenities: </span>{profile.amenities.join(' · ')}</p>}
    {!compact && <Link href={`/dashboard/marketvision?tab=brand-intel&brandCompetitorId=${profile.id}`} className="inline-block text-indigo-700 underline">Review brand evidence and sources</Link>}
  </div>
}
