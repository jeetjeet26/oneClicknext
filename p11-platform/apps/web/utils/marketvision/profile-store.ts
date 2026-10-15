import { createServiceClient } from '@/utils/supabase/admin'
import { marketRpc, MarketStoreError } from './decision-store'
import { BriefSources } from './saved-brief'
import { formatCompetitor } from './records'
import { historicalBrand, scopeNotes, type ReviewedBrand, type CompetitorProfiles } from './profiles'

const columns = 'competitor_id,last_analyzed_at,positioning_statement,brand_voice,brand_personality,target_audience,unique_selling_points,highlighted_amenities,service_offerings,lifestyle_focus,community_events,active_specials,promotional_messaging,urgency_tactics,key_messaging_themes,call_to_action_patterns,pages_analyzed'

export async function readCompetitorProfiles(propertyId: string, actor: string): Promise<CompetitorProfiles> {
  const args = { p_property_id: propertyId, p_actor_id: actor }
  const records = await marketRpc('read_marketvision_competitors', { ...args, p_active_only: false })
  const competitors = (records.competitors as Record<string, unknown>[]).map(formatCompetitor)
  if (competitors.some(c => c.propertyId !== propertyId)) throw new MarketStoreError('Competitor scope could not be confirmed.')
  const db = createServiceClient()
  const warnings: string[] = []
  const brands = new Map<string, ReturnType<typeof historicalBrand>>()
  const reviews = new Map<string, ReviewedBrand | null>()
  const [brandResult, reviewResult, subjectResult] = await Promise.allSettled([
    (async () => {
      // Each competitor has at most one historical analysis. Batches stay below the REST cap.
      for (let offset = 0; offset < competitors.length; offset += 100) {
        const ids = competitors.slice(offset, offset + 100).map(c => c.id)
        const { data, error } = await db.from('competitor_brand_intelligence').select(columns).in('competitor_id', ids)
        if (error) throw error
        for (const row of data ?? []) if (row.competitor_id && ids.includes(row.competitor_id)) brands.set(row.competitor_id, historicalBrand(row))
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
  ])
  if (brandResult.status === 'rejected') { brands.clear(); warnings.push('Historical analysis could not be loaded. Reload to try again.') }
  if (reviewResult.status === 'rejected') { reviews.clear(); warnings.push('Current brand reviews could not be loaded. Historical analysis is shown separately.') }
  if (subjectResult.status === 'rejected') warnings.push('Your property’s approved prices could not be loaded. The comparison shows them as unavailable.')
  return {
    propertyId, readAt: new Date().toISOString(), warnings,
    subject: subjectResult.status === 'fulfilled' ? { name: subjectResult.value.propertyName, units: subjectResult.value.subjectUnits } : { name: 'Your property', units: [] },
    competitors: competitors.map(c => {
      const brand = brands.get(c.id) ?? null
      return { ...c, historicalBrand: brand, reviewedBrand: reviews.get(c.id) ?? null, scopeNotes: scopeNotes(c, brand) }
    }),
  }
}
