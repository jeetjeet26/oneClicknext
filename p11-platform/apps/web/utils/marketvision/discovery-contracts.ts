import { z } from 'zod'
import { competitorValues, marketId, publicMarketUrl } from './decision-contracts'
import { PROPERTY_TYPE_VALUES } from '@/utils/property-types'

export const discoveryRequest = z.object({
  propertyId: marketId,
  radiusMiles: z.number().min(0.5).max(25),
  maxCompetitors: z.number().int().min(1).max(50),
}).strict()

export const discoveryMatch = z.object({
  tier: z.enum(['primary', 'related', 'broader']), score: z.number(),
  distance_miles: z.number().nonnegative(), subtype: z.string().nullable(),
  confidence: z.enum(['limited', 'moderate', 'high']), reasons: z.array(z.string()).max(20),
  gaps: z.array(z.string()).max(20), source_ids: z.array(z.string()).max(30), context_hash: z.string().nullable(),
  assessment: z.discriminatedUnion('method', [
    z.object({method: z.literal('website_ai'), property_type: z.enum(PROPERTY_TYPE_VALUES),
      tier: z.enum(['primary', 'related', 'broader']), transaction: z.enum(['for_sale', 'rental', 'care_services', 'unknown']),
      sales_status: z.enum(['active', 'coming_soon', 'sold_out', 'unknown']),
      source_url: z.string().max(2000), quote: z.string().min(12).max(360),
      comparison: z.string().min(1).max(420), pricing: z.string().max(160).nullable()}),
    z.object({method: z.literal('listing')}),
    z.object({method: z.literal('unverified')}),
  ]).optional(),
})
export const discoveryProfile = z.object({summary: z.string(), segments: z.array(z.string()), source_ids: z.array(z.string()), context_hash: z.string().nullable(), warnings: z.array(z.string())})
export const DISCOVERY_GROUPS = {primary: 'Primary competitors', related: 'Related competitors', broader: 'Broader alternatives'} as const
const candidate = z.object({
  match: discoveryMatch.optional(),
  name: z.string().trim().min(1).max(200), address: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(), phone: z.string().nullable().optional(),
  property_type: z.string().optional(), ils_listings: z.record(z.string(), z.string()).optional(),
})
export const discoveryResponse = z.object({success: z.literal(true), data: z.object({
  success: z.literal(true), property_name: z.string(), competitors: z.array(candidate).max(100), profile: discoveryProfile.optional(), warnings: z.array(z.string()).default([]),
})})
export type DiscoveryCandidate = {
  key: string
  match?: z.infer<typeof discoveryMatch>
  values: Omit<z.infer<typeof competitorValues>, 'property_type'> & {
    property_type: z.infer<typeof competitorValues>['property_type'] | null
  }
  sourceUrl: string | null
}
export const DISCOVERY_COMPARISON_PREFIX = 'MarketVision discovery comparison: '
const discoveryValues = competitorValues.extend({property_type: z.enum(PROPERTY_TYPE_VALUES).nullable()})

export function discoveryCandidates(input: z.infer<typeof discoveryResponse>): DiscoveryCandidate[] {
  const seen = new Set<string>()
  return input.data.competitors.flatMap(row => {
    const key = `${row.name.toLowerCase()}|${row.address?.toLowerCase() ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    const sourceUrl = Object.values(row.ils_listings ?? {}).find(publicMarketUrl) ?? null
    const evidence = row.match?.assessment
    const assessment = evidence?.method === 'website_ai' && !publicMarketUrl(evidence.source_url) ? {method: 'unverified' as const} : evidence
    const match = row.match && {...row.match, ...(assessment && {assessment})}
    const website = assessment?.method === 'website_ai' ? assessment : null
    const propertyType = website?.property_type ?? (assessment?.method !== 'unverified' && (!row.match || row.match.subtype) ?
      PROPERTY_TYPE_VALUES.find(value => value === row.property_type) ?? null : null)
    return [{key, sourceUrl, match, values: discoveryValues.parse({
      name: row.name, address: row.address?.slice(0, 2000) ?? null,
      website_url: website?.source_url ?? (row.website_url && publicMarketUrl(row.website_url) ? row.website_url : null),
      phone: row.phone?.slice(0, 100) ?? null, property_type: propertyType,
      units_count: null, year_built: null, amenities: [],
      notes: [`Added from nearby competitor discovery.${sourceUrl ? ` Source: ${sourceUrl}` : ''}`,
        ...(website ? [`${DISCOVERY_COMPARISON_PREFIX}${website.comparison}`, `Website evidence: ${website.source_url}`,
          `Source excerpt: ${website.quote}`, `Offering: ${website.transaction}; market status: ${website.sales_status}.`,
          ...(website.pricing ? [`Advertised price excerpt: ${website.pricing}`] : [])] : []),
        ...(row.match ? [DISCOVERY_GROUPS[row.match.tier], ...row.match.reasons, ...row.match.gaps, `Evidence confidence: ${row.match.confidence}.`, `Community context: ${row.match.context_hash ?? 'saved profile'}. Sources: ${row.match.source_ids.join(', ')}`] : [])].join('\n').slice(0, 10000),
    })}]
  })
}
