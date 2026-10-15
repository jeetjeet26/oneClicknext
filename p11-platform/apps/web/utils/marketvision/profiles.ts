import type { Competitor } from './records'

export interface HistoricalBrand {
  analyzedAt: string | null
  positioning: string | null
  voice: string | null
  personality: string | null
  audience: string | null
  differentiators: string[]
  amenities: string[]
  services: string[]
  lifestyles: string[]
  events: string[]
  promotions: string[]
  promotionalMessaging: string | null
  urgency: string[]
  themes: string[]
  callsToAction: string[]
  pages: number | null
}
export interface ReviewedBrand {
  requestId: string
  disposition: string
  sourceCurrent: boolean
  createdAt: string
  source?: { sourceUrl: string; fetchedAt: string }
  claims: Array<{ category: string; kind: string; statement: string; quote: string }>
}
export interface CompetitorProfile extends Competitor {
  historicalBrand: HistoricalBrand | null
  reviewedBrand: ReviewedBrand | null
  scopeNotes: string[]
}
export interface SubjectProfile {
  name: string
  units: Array<{ id: string; unit_type: string; bedrooms: number; rent_min: number | null; last_updated_at: string | null }>
}
export interface CompetitorProfiles {
  propertyId: string
  competitors: CompetitorProfile[]
  subject: SubjectProfile
  warnings: string[]
  readAt: string
}

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
export function historicalBrand(row: Record<string, unknown>): HistoricalBrand {
  return {
    analyzedAt: text(row.last_analyzed_at), positioning: text(row.positioning_statement),
    voice: text(row.brand_voice), personality: text(row.brand_personality), audience: text(row.target_audience),
    differentiators: strings(row.unique_selling_points), amenities: strings(row.highlighted_amenities),
    services: strings(row.service_offerings), lifestyles: strings(row.lifestyle_focus), events: strings(row.community_events),
    promotions: strings(row.active_specials), promotionalMessaging: text(row.promotional_messaging), urgency: strings(row.urgency_tactics),
    themes: strings(row.key_messaging_themes), callsToAction: strings(row.call_to_action_patterns),
    pages: typeof row.pages_analyzed === 'number' ? row.pages_analyzed : null,
  }
}

export function scopeNotes(competitor: Competitor, brand: HistoricalBrand | null): string[] {
  const notes: string[] = []
  if (/property-management|management-services/i.test(competitor.websiteUrl ?? '') || /property management service/i.test(brand?.positioning ?? '')) {
    notes.push('This source describes a management business. Confirm the specific community before comparing its rents.')
  }
  const locations = new Set((competitor.units ?? []).flatMap(u => {
    const match = u.unitType.match(/^(.{4,})\s+(?:\d+\s?BR|studio)$/i)
    return match ? [match[1].toLowerCase()] : []
  }))
  if (locations.size > 1) notes.push('Saved listings span multiple named locations. Confirm that they belong to one comparable community.')
  return notes
}

export function currentClaims(profile: CompetitorProfile, category: string): string[] {
  const review = profile.reviewedBrand
  return review?.disposition === 'published' && review.sourceCurrent
    ? review.claims.filter(c => c.category === category).map(c => c.statement) : []
}
export function profileText(profile: CompetitorProfile): string {
  return [profile.name, profile.address, ...profile.amenities, ...profile.scopeNotes,
    ...Object.values(profile.historicalBrand ?? {}).flatMap(v => Array.isArray(v) ? v : typeof v === 'string' ? [v] : []),
    ...(profile.reviewedBrand?.claims.flatMap(c => [c.statement, c.quote]) ?? []),
  ].join(' ').toLowerCase()
}
export function rentSummary(units: Array<{ rentMin: number | null; bedrooms: number }> , bedrooms?: number) {
  const selected = bedrooms === undefined ? units : units.filter(u => u.bedrooms === bedrooms)
  const rents = selected.flatMap(u => u.rentMin !== null && Number.isFinite(u.rentMin) ? [u.rentMin] : [])
  return { total: selected.length, priced: rents.length, mean: rents.length ? Math.round(rents.reduce((a,b) => a+b, 0) / rents.length) : null }
}
