'use client'

import Link from 'next/link'
import { Sparkles, Users, MessageCircle, Gem, Leaf, Gift, CheckCircle2, ArrowUpRight, Building2, type LucideIcon } from 'lucide-react'
import { currentClaims, type CompetitorProfile } from '@/utils/marketvision/profiles'

export const profileDate = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Date unknown'
export const money = (value: number | null) => value === null ? 'Not available' : `$${value.toLocaleString()}`
export function safeWebsite(value: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

export function readableBrandText(value: string | null | undefined): string {
  if (!value) return ''
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) return parsed.join(' · ') } catch { /* Plain text is already readable. */ }
  return value
}

function Chips({values, tone = 'slate'}: {values: string[]; tone?: 'slate' | 'violet' | 'emerald'}) {
  const colors = {slate: 'bg-white text-slate-700 ring-slate-200', violet: 'bg-violet-50 text-violet-800 ring-violet-200', emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200'}
  return <ul className="flex flex-wrap gap-2">{values.map((value, index) => <li key={index} className={`max-w-full rounded-xl px-3 py-1.5 text-xs leading-relaxed ring-1 ring-inset ${colors[tone]}`}>{value}</li>)}</ul>
}
function BrandTile({title, icon: Icon, children, tone = 'slate'}: {title: string; icon: LucideIcon; children: React.ReactNode; tone?: 'slate' | 'violet' | 'emerald'}) {
  const colors = {slate: 'border-slate-200 bg-slate-50/70 text-slate-600', violet: 'border-violet-200 bg-violet-50/50 text-violet-700', emerald: 'border-emerald-200 bg-emerald-50/50 text-emerald-700'}
  return <section className={`min-w-0 rounded-2xl border p-4 ${colors[tone]}`}><h5 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider"><Icon className="h-4 w-4 shrink-0"/>{title}</h5><div className="text-sm leading-relaxed text-slate-800">{children}</div></section>
}

export function CompetitorProfileContent({ profile, compact = false }: { profile: CompetitorProfile; compact?: boolean }) {
  const old = profile.historicalBrand
  const reviewed = profile.reviewedBrand?.disposition === 'published' && profile.reviewedBrand.sourceCurrent
  const voice = old ? [old.voice, readableBrandText(old.personality)].filter((v): v is string => Boolean(v)).flatMap(v => v.split(' · ')) : []
  return <div className="space-y-5 break-words text-sm">
    {profile.scopeNotes.map(note => <p key={note} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">Scope needs review: {note}</p>)}
    {reviewed && <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
      <h4 className="flex items-center gap-2 font-semibold text-emerald-900"><CheckCircle2 className="h-4 w-4"/>Reviewed brand evidence</h4>
      <p className="mt-1 text-xs text-slate-500">Reviewed {profileDate(profile.reviewedBrand?.createdAt)} · saved source evidence, not a live website check</p>
      <ul className="mt-4 grid gap-3">{(compact ? ['positioning', 'audience', 'amenity'].flatMap(category => currentClaims(profile, category)).slice(0, 3) : profile.reviewedBrand!.claims.map(c => c.statement)).map((statement, i) => <li key={i} className="flex gap-3 rounded-xl border border-emerald-100 bg-white p-3 text-slate-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"/>{statement}</li>)}</ul>
    </section>}
    {old ? <section aria-label="Historical brand analysis" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="flex items-center gap-2 font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-violet-600"/>Brand snapshot</h4><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{profileDate(old.analyzedAt)}</span></div>
      <p className="text-xs text-slate-500">Historical brand analysis · not verified as current</p>
      {old.positioning && <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-950 via-indigo-900 to-violet-800 p-5 text-white"><div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full border-[20px] border-white/5"/><h5 className="relative mb-2 text-xs font-semibold uppercase tracking-widest text-indigo-200">Positioning</h5><p className={`relative leading-relaxed ${compact ? 'text-sm' : 'text-base font-medium'}`}>{old.positioning}</p></section>}
      <div className={`grid gap-3 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {old.audience && <BrandTile title="Target audience" icon={Users} tone="violet"><p>{old.audience}</p></BrandTile>}
        {voice.length > 0 && <BrandTile title="Brand voice" icon={MessageCircle} tone="violet"><Chips values={voice} tone="violet"/></BrandTile>}
      </div>
      {old.differentiators.length > 0 && <BrandTile title="What sets them apart" icon={Gem}><ul className={`grid gap-3 ${compact ? '' : 'sm:grid-cols-2'}`}>{(compact ? old.differentiators.slice(0, 3) : old.differentiators).map((item, i) => <li key={i} className="flex items-start gap-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-xs font-semibold text-indigo-700">{i + 1}</span><span>{item}</span></li>)}</ul></BrandTile>}
      {old.amenities.length > 0 && <BrandTile title="Amenities highlighted" icon={Leaf} tone="emerald"><Chips values={compact ? old.amenities.slice(0, 6) : old.amenities} tone="emerald"/>{compact && old.amenities.length > 6 && <p className="mt-2 text-xs text-emerald-700">+{old.amenities.length - 6} more in the full profile</p>}</BrandTile>}
      {!compact && <>
        <div className="grid gap-3 sm:grid-cols-2">{old.services.length > 0 && <BrandTile title="Services" icon={Building2}><Chips values={old.services}/></BrandTile>}{old.lifestyles.length > 0 && <BrandTile title="Lifestyle" icon={Leaf} tone="emerald"><Chips values={old.lifestyles} tone="emerald"/></BrandTile>}</div>
        {(old.themes.length > 0 || old.callsToAction.length > 0 || old.events.length > 0) && <details className="rounded-2xl border border-slate-200 p-4"><summary className="cursor-pointer font-medium text-slate-700">Messaging & community activity</summary><div className="mt-4 grid gap-4">{[['Messaging themes', old.themes], ['Calls to action', old.callsToAction], ['Community events', old.events]].map(([label, values]) => (values as string[]).length > 0 && <div key={label as string}><h5 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h5><Chips values={values as string[]}/></div>)}</div></details>}
        {(old.promotions.length > 0 || old.promotionalMessaging || old.urgency.length > 0) && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><h5 className="flex items-center gap-2 font-semibold"><Gift className="h-4 w-4"/>Previously observed offers</h5><p className="mb-3 mt-1 text-xs text-amber-800">Historical only. Availability and expiry have not been verified.</p><ul className="space-y-2">{old.promotions.map((offer, i) => <li key={i} className="rounded-lg bg-white/70 p-3">{offer}</li>)}</ul>{old.promotionalMessaging && <p className="mt-3">{old.promotionalMessaging}</p>}{old.urgency.length > 0 && <div className="mt-3"><Chips values={old.urgency}/></div>}</section>}
      </>}
    </section> : !reviewed && <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center"><Sparkles className="mx-auto mb-2 h-6 w-6 text-slate-400"/><p className="text-slate-600">No brand analysis saved yet.</p><p className="mt-1 text-xs text-slate-500">Pricing and property details remain available.</p></div>}
    {profile.amenities.length > 0 && <BrandTile title="Saved property amenities" icon={Leaf}><Chips values={profile.amenities}/></BrandTile>}
    {!compact && <Link href={`/dashboard/marketvision?tab=brand-intel&brandCompetitorId=${profile.id}`} className="inline-flex items-center gap-1.5 font-medium text-indigo-700">Review brand evidence and sources<ArrowUpRight className="h-4 w-4"/></Link>}
  </div>
}
