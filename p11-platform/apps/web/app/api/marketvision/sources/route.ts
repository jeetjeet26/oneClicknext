import { after, NextRequest, NextResponse } from 'next/server'
import { sourceRead, sourceRequest, sourceControl, capturedExtraction } from '@/utils/marketvision/source-contracts'
import { requireMarketOperator, MarketStoreError, marketError } from '@/utils/marketvision/decision-store'
import { sourceRpc, sourceExecutionStatus, runSource, requestCapturedExtraction } from '@/utils/marketvision/source-store'
import { runExtraction } from '@/utils/marketvision/extraction-store'
export const maxDuration = 120
const reply = (data: unknown) => NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
function later(id: string, extraction = false) { after(async () => { try { if (extraction) await runExtraction(id); else await runSource(id) } catch { console.error('Saved market source needs recovery', { requestId: id }) } }) }
export async function GET(req: NextRequest) {
  try {
    const parsed = sourceRead.safeParse(Object.fromEntries(req.nextUrl.searchParams))
    if (!parsed.success) throw new MarketStoreError('Choose the property and saved competitor source.', 400)
    const { propertyId, competitorId, requestId, cursor } = parsed.data
    const actor = await requireMarketOperator(propertyId)
    const result = await sourceRpc('read_marketvision_sources', { p_property_id: propertyId, p_actor_id: actor, p_competitor_id: competitorId, p_request_id: requestId ?? null, p_cursor: cursor ?? null })
    return reply({ ...result, execution: sourceExecutionStatus() })
  } catch (e) { return marketError(e) }
}
export async function POST(req: NextRequest) {
  try {
    const parsed = sourceRequest.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new MarketStoreError('Review the saved source, current version and reason for fetching it.', 400)
    const { requestId, propertyId, ...input } = parsed.data
    const actor = await requireMarketOperator(propertyId)
    const result = await sourceRpc('begin_marketvision_source', { p_id: requestId, p_property_id: propertyId, p_actor_id: actor, p_input: input })
    if (result.state === 'queued' && result.requestId === requestId) later(requestId)
    return reply({ result, execution: sourceExecutionStatus() })
  } catch (e) { return marketError(e) }
}
export async function PUT(req: NextRequest) {
  try {
    const parsed = sourceControl.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new MarketStoreError('Review the saved fetch state, decision and reason.', 400)
    const { requestId, propertyId, ...input } = parsed.data
    const actor = await requireMarketOperator(propertyId)
    const result = await sourceRpc('control_marketvision_source', { p_id: requestId, p_property_id: propertyId, p_actor_id: actor, p_input: input })
    if (input.action === 'recover' && result.requestState === 'queued') later(input.sourceId)
    return reply({ result, execution: sourceExecutionStatus() })
  } catch (e) { return marketError(e) }
}
export async function PATCH(req: NextRequest) {
  try {
    const parsed = capturedExtraction.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new MarketStoreError('Review and confirm the retained page scope before requesting extraction.', 400)
    const actor = await requireMarketOperator(parsed.data.propertyId)
    const result = await requestCapturedExtraction(parsed.data, actor)
    if (result.state === 'queued' && result.requestId === parsed.data.requestId) later(parsed.data.requestId, true)
    return reply({ result })
  } catch (e) { return marketError(e) }
}
