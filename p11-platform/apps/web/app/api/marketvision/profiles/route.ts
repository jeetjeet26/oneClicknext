import { NextRequest, NextResponse } from 'next/server'
import { marketId } from '@/utils/marketvision/decision-contracts'
import { requireMarketOperator, marketError, MarketStoreError } from '@/utils/marketvision/decision-store'
import { readCompetitorProfiles } from '@/utils/marketvision/profile-store'

export async function GET(request: NextRequest) {
  try {
    const id = marketId.safeParse(request.nextUrl.searchParams.get('propertyId'))
    if (!id.success) throw new MarketStoreError('Select a property.', 400)
    const actor = await requireMarketOperator(id.data)
    const data = await readCompetitorProfiles(id.data, actor)
    if (await requireMarketOperator(id.data) !== actor) throw new MarketStoreError('Your session changed. Reload this property.', 403)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return marketError(error) }
}
