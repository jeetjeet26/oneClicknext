import {loadDiscoveryContext} from '@/utils/marketvision/discovery-context'
import {BrainError} from '@/utils/community-brain/contracts'
import { NextRequest, NextResponse } from 'next/server'
import { requireMarketOperator, MarketStoreError, marketError } from '@/utils/marketvision/decision-store'
import { discoveryRequest, discoveryResponse, discoveryCandidates } from '@/utils/marketvision/discovery-contracts'
import { getDataEngineHeaders, getDataEngineUrl } from '@/utils/services/runtime-config'

export const maxDuration = 120
export async function POST(req: NextRequest) {
  try {
    const parsed = discoveryRequest.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new MarketStoreError('Choose a property, a radius of 0.5–25 miles and up to 50 results.', 400)
    const {propertyId, radiusMiles, maxCompetitors} = parsed.data
    const actor = await requireMarketOperator(propertyId)
    if (process.env.OUTBOUND_DELIVERY_PAUSED === 'true') throw new MarketStoreError('External discovery is paused. Try again after external fetching is enabled.', 409)
    const knowledge = await loadDiscoveryContext(actor, propertyId)
    let response: Response
    try {
      response = await fetch(`${getDataEngineUrl()}/scraper/discover`, {
        method: 'POST', headers: getDataEngineHeaders(), cache: 'no-store',
        signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({property_id: propertyId, radius_miles: radiusMiles, max_competitors: maxCompetitors, auto_add: false, community_context: knowledge.context}),
      })
    } catch { throw new MarketStoreError('Nearby search is unavailable or took too long. Check the discovery service and try again.', 503) }
    const raw = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = raw?.detail
      const known = ['Property has no address', 'Property not found', 'Google Places is not configured', 'Community location could not be verified. Check its street address.', 'Nearby search sources are unavailable. Try again later.']
      throw new MarketStoreError(known.includes(detail) ? detail : 'Nearby search could not complete. Check the discovery service and Google Maps connection.', 503)
    }
    const result = discoveryResponse.safeParse(raw)
    if (!result.success) throw new MarketStoreError('Nearby search returned an incomplete response. Please retry.', 502)
    return NextResponse.json({propertyName: result.data.data.property_name, candidates: discoveryCandidates(result.data), profile: result.data.data.profile, warnings: [...knowledge.warnings, ...result.data.data.warnings]}, {headers: {'Cache-Control': 'private, no-store'}})
  } catch (error) { return marketError(error instanceof BrainError ? new MarketStoreError(error.message, error.status) : error) }
}
