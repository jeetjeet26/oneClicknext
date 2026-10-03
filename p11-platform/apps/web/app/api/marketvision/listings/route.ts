import { NextRequest, NextResponse } from 'next/server'
import { listingDecision, listingRead } from '@/utils/marketvision/listing-contracts'
import { requireMarketOperator, marketRpc, MarketStoreError, marketError } from '@/utils/marketvision/decision-store'

const reply = (data: unknown) => NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
export async function GET(req: NextRequest) {
  try {
    const parsed = listingRead.safeParse(Object.fromEntries(req.nextUrl.searchParams))
    if (!parsed.success) throw new MarketStoreError('Choose the property and competitor.', 400)
    const { propertyId, competitorId } = parsed.data
    const actor = await requireMarketOperator(propertyId)
    const result = await marketRpc('read_marketvision_competitors', { p_property_id: propertyId, p_actor_id: actor, p_active_only: false })
    const record = (result.competitors as Record<string, unknown>[]).find(c => c.id === competitorId)
    if (!record) throw new MarketStoreError('This competitor is unavailable in the selected property.', 404)
    const listings = record.ils_listings as Record<string, unknown> | null
    return reply({ listing: { competitorId, version: record.version, isActive: record.is_active, url: typeof listings?.apartments_com === 'string' ? listings.apartments_com : null } })
  } catch (e) { return marketError(e) }
}
export async function PUT(req: NextRequest) {
  try {
    const parsed = listingDecision.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new MarketStoreError('Review the complete listing URL, saved version and reason.', 400)
    const { requestId, propertyId, ...input } = parsed.data
    const actor = await requireMarketOperator(propertyId)
    const result = await marketRpc('save_marketvision_listing', { p_id: requestId, p_property_id: propertyId, p_actor_id: actor, p_input: input })
    return reply({ result })
  } catch (e) { return marketError(e) }
}
