import { z } from 'zod'
import { competitorValues, marketId, publicMarketUrl } from './decision-contracts'
import { PROPERTY_TYPE_VALUES } from '@/utils/property-types'

export const discoveryRequest = z.object({
  propertyId: marketId,
  radiusMiles: z.number().min(0.5).max(25),
  maxCompetitors: z.number().int().min(1).max(50),
}).strict()

const candidate = z.object({
  name: z.string().trim().min(1).max(200), address: z.string().nullable().optional(),
  website_url: z.string().nullable().optional(), phone: z.string().nullable().optional(),
  property_type: z.string().optional(), ils_listings: z.record(z.string(), z.string()).optional(),
})
export const discoveryResponse = z.object({success: z.literal(true), data: z.object({
  success: z.literal(true), property_name: z.string(), competitors: z.array(candidate).max(100),
})})
export type DiscoveryCandidate = {
  key: string
  values: z.infer<typeof competitorValues>
  sourceUrl: string | null
}
export function discoveryCandidates(input: z.infer<typeof discoveryResponse>): DiscoveryCandidate[] {
  const seen = new Set<string>()
  return input.data.competitors.flatMap(row => {
    const key = `${row.name.toLowerCase()}|${row.address?.toLowerCase() ?? ''}`
    if (seen.has(key)) return []
    seen.add(key)
    const sourceUrl = Object.values(row.ils_listings ?? {}).find(publicMarketUrl) ?? null
    const propertyType = PROPERTY_TYPE_VALUES.find(value => value === row.property_type) ?? 'multifamily'
    return [{key, sourceUrl, values: competitorValues.parse({
      name: row.name, address: row.address?.slice(0, 2000) ?? null,
      website_url: row.website_url && publicMarketUrl(row.website_url) ? row.website_url : null,
      phone: row.phone?.slice(0, 100) ?? null, property_type: propertyType,
      units_count: null, year_built: null, amenities: [],
      notes: `Added from nearby competitor discovery.${sourceUrl ? ` Source: ${sourceUrl}` : ''}`,
    })}]
  })
}
