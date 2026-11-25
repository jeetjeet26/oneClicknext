import { createServiceClient } from '@/utils/supabase/admin'
import { marketRpc, MarketStoreError } from './decision-store'
import { BriefSources } from './saved-brief'
import { formatCompetitor } from './records'
import { conflictedPriceUnits } from './analysis'
import { historicalBrand, scopeNotes, type ReviewedBrand, type CompetitorProfiles } from './profiles'
import { isForSaleResidentialType } from '@/utils/property-types'
import { advertisedSalePrice } from './sale-prices'
import { z } from 'zod'
import { readSavedResearchProfiles } from './research-profile-store'
import { communityModel } from '@/utils/community-model'

const columns = 'competitor_id,last_analyzed_at,positioning_statement,brand_voice,brand_personality,target_audience,unique_selling_points,highlighted_amenities,service_offerings,lifestyle_focus,community_events,active_specials,promotional_messaging,urgency_tactics,key_messaging_themes,call_to_action_patterns,pages_analyzed,raw_extraction'
const saleSources = z.object({
  propertyType: z.string().nullable(), transaction: z.string().nullable(),
  sources: z.array(z.object({competitorId: z.string(), text: z.string(), sourceUrl: z.string(), fetchedAt: z.string(), websiteUrl: z.string()})),
})

export async function readCompetitorProfiles(propertyId: string, actor: string): Promise<CompetitorProfiles> {
  const args = { p_property_id: propertyId, p_actor_id: actor }
  const records = await marketRpc('read_marketvision_competitors', { ...args, p_active_only: false })
  const competitors = (records.competitors as Record<string, unknown>[]).map(formatCompetitor)
  if (competitors.some(c => c.propertyId !== propertyId)) throw new MarketStoreError('Competitor scope could not be confirmed.')
  const db = createServiceClient()
  const warnings: string[] = []
  const brands = new Map<string, ReturnType<typeof historicalBrand>>()
  const reviews = new Map<string, ReviewedBrand | null>()
  const [brandResult, reviewResult, subjectResult, saleResult] = await Promise.allSettled([
    (async () => {
      // Each competitor has at most one historical analysis. Batches stay below the REST cap.
      for (let offset = 0; offset < competitors.length; offset += 100) {
        const ids = competitors.slice(offset, offset + 100).map(c => c.id)
        const { data, error } = await db.from('competitor_brand_intelligence').select(columns).in('competitor_id', ids)
        if (error) throw error
        for (const row of data ?? []) if (row.competitor_id && ids.includes(row.competitor_id)) {
          const brand=historicalBrand(row)
          brands.set(row.competitor_id,brand)
          if(!brand)warnings.push('A historical brand snapshot was withheld because its retained pages contain website errors instead of community evidence.')
        }
      }
    })(),
    (async () => {
      let cursor: string | null = null
      const seen = new Set<string>()
      do {
        const page = await marketRpc('read_marketvision_brand', { ...args, p_view: 'current', p_competitor_id: null, p_request_id: null, p_cursor: cursor })
        for (const entry of page.items as Array<{ competitorId: string; review: ReviewedBrand | null }>) reviews.set(entry.competitorId, entry.review)
        cursor = page.nextCursor as string | null
        if (cursor && seen.has(cursor)) throw new Error('Repeated brand page')
        if (cursor) seen.add(cursor)
      } while (cursor)
    })(),
    marketRpc('marketvision_brief_sources', { ...args, p_days: 30 }).then(data => BriefSources.parse(data)),
    marketRpc('read_marketvision_sale_sources', args).then(data => saleSources.parse(data)),
  ])
  if (brandResult.status === 'rejected') { brands.clear(); warnings.push('Historical analysis could not be loaded. Reload to try again.') }
  if (reviewResult.status === 'rejected') { reviews.clear(); warnings.push('Current brand reviews could not be loaded. Historical analysis is shown separately.') }
  if (subjectResult.status === 'rejected') warnings.push('Approved subject prices and price-integrity checks could not be loaded. Price comparisons are withheld until a reload succeeds.')
  if (saleResult.status === 'rejected' && competitors.some(c => isForSaleResidentialType(c.propertyType))) warnings.push('Advertised sale prices could not be loaded. Reload to try again.')
  const conflicts = subjectResult.status === 'fulfilled' ? conflictedPriceUnits(subjectResult.value, true) : new Set(competitors.flatMap(c => (c.units ?? []).map(u => u.id)))
  const sale = saleResult.status === 'fulfilled' ? saleResult.value : null
  const forSale = sale?.transaction ? sale.transaction === 'for_sale' : isForSaleResidentialType(sale?.propertyType)
  const saleByCompetitor = new Map(sale?.sources.map(source => [source.competitorId, source]))
  let research=new Map<string,import('./research-contracts').ResearchProfile>()
  try { research=await readSavedResearchProfiles(propertyId,sale?communityModel({property_type:sale.propertyType,operating_model:sale.transaction}).transaction:null,competitors) } catch { warnings.push('Saved web research could not be loaded. Reload to try again.') }
  return {
    propertyId, readAt: new Date().toISOString(), warnings,
    subject: { forSale, propertyType: sale?.propertyType ?? null, ...(subjectResult.status === 'fulfilled' ? { name: subjectResult.value.propertyName, units: subjectResult.value.subjectUnits } : { name: 'Your property', units: [] }) },
    competitors: competitors.map(c => {
      const brand = brands.get(c.id) ?? null
      const source = saleByCompetitor.get(c.id)
      const salePrice = source && source.websiteUrl === c.websiteUrl && isForSaleResidentialType(c.propertyType) ? advertisedSalePrice(source) : null
      return { ...c, salePrice, research:research.get(c.id)??null, historicalBrand: brand, reviewedBrand: reviews.get(c.id) ?? null, scopeNotes: scopeNotes(c, brand), withheldUnitIds: (c.units ?? []).filter(u => conflicts.has(u.id)).map(u => u.id) }
    }),
  }
}
