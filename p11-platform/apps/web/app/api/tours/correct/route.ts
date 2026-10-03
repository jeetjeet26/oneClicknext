import {NextRequest, NextResponse} from 'next/server'
import {z} from 'zod'
import {createClient} from '@/utils/supabase/server'
import {createServiceClient} from '@/utils/supabase/admin'
import {validatePropertyAccess} from '@/utils/services/auth-guard'
import {findTourForOutcome, correctTourNoShow, correctionFailure} from '@/utils/services/tour-outcomes'
import {adminLimiter, getRateLimitKey, rateLimitHeaders} from '@/utils/services/rate-limiter'
import {badRequest, forbidden, notFound, rateLimited, serverError, unauthorized} from '@/utils/services/api-helpers'
import {createRequestContext} from '@/utils/services/request-context'

const inputSchema = z.object({
  tourId: z.string().uuid(), requestId: z.string().uuid(), reason: z.string().trim().min(1).max(2000),
})
export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/tours/correct')
  ctx.logStart()
  try {
    const limit = adminLimiter.check(getRateLimitKey(request, 'tour-correction'))
    if (!limit.allowed) return rateLimited({...rateLimitHeaders(limit), ...ctx.responseHeaders})
    const auth = await createClient()
    const {data: {user}, error} = await auth.auth.getUser()
    if (error || !user) return unauthorized(ctx.responseHeaders)
    const input = inputSchema.safeParse(await request.json().catch(() => null))
    if (!input.success) return badRequest('A valid tour, request ID and correction reason (up to 2000 characters) are required.', ctx.responseHeaders)
    const db = createServiceClient()
    const tour = await findTourForOutcome(db, input.data.tourId)
    if (!tour?.property_id || !tour.lead_id) return notFound('Tour', ctx.responseHeaders)
    const access = await validatePropertyAccess(user.id, tour.property_id)
    if (!access.authorized) return forbidden(ctx.responseHeaders)
    const result = await correctTourNoShow({...input.data, actorId: user.id,
      propertyId: tour.property_id, leadId: tour.lead_id, source: tour.source}, db)
    const failure = correctionFailure(result)
    if (failure) return NextResponse.json({error: failure.error, code: result.state}, {status: failure.status, headers: ctx.responseHeaders})
    ctx.logSuccess(200, {tourId: tour.id, correctionId: result.correction!.id, replayed: result.state === 'replayed'})
    return NextResponse.json({tour: {id: tour.id, status: 'completed', outcome_notes: result.outcome!.notes,
      completedAt: result.outcome!.outcome_at, correction: result.correction},
      leadStatus: result.leadStatus, followup: result.outcome!.followup_state,
      correction: result.correction, replayed: result.state === 'replayed'}, {headers: {...ctx.responseHeaders, 'Cache-Control': 'no-store'}})
  } catch (error) {
    ctx.logError(500, error, {operation: 'correct_tour_no_show'})
    return serverError(error, ctx.responseHeaders)
  }
}
