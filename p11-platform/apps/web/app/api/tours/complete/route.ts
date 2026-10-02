/**
 * Tour Completion Endpoint
 * POST - Marks a tour as completed, triggers follow-up workflows and engagement tracking
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { findTourForOutcome, recordTourOutcome, outcomeFailure } from '@/utils/services/tour-outcomes'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { adminLimiter, getRateLimitKey, rateLimitHeaders } from '@/utils/services/rate-limiter'
import { validateBody, tourCompleteSchema } from '@/utils/services/validation'
import { unauthorized, forbidden, badRequest, notFound, serverError, rateLimited } from '@/utils/services/api-helpers'
import { auditLog, getRequestIp } from '@/utils/services/audit-logger'
import { createRequestContext } from '@/utils/services/request-context'

export async function POST(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/tours/complete')
  ctx.logStart()

  try {
    // Rate limit
    const rlKey = getRateLimitKey(req, 'tour-complete')
    const rl = adminLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...rateLimitHeaders(rl), ...ctx.responseHeaders })
    }

    // Auth
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    // Validate input
    const rawBody = await req.json().catch(() => null)
    const validation = validateBody(rawBody, tourCompleteSchema)
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'validation_failed' })
      return badRequest(validation.error, ctx.responseHeaders)
    }

    const { tourId, notes, requestId } = validation.data

    const serviceClient = createServiceClient()

    const tour = await findTourForOutcome(serviceClient, tourId)
    if (!tour) return notFound('Tour', ctx.responseHeaders)

    if (!tour.property_id || !tour.lead_id) {
      ctx.logSuccess(404, { reason: 'tour_relationship_missing', tourId })
      return notFound('Tour', ctx.responseHeaders)
    }

    // Org ownership check — ensure user's org owns this property
    const access = await validatePropertyAccess(user.id, tour.property_id)
    if (!access.authorized) {
      auditLog({
        eventType: 'property_access_denied',
        userId: user.id,
        propertyId: tour.property_id,
        ip: getRequestIp(req),
        resource: 'tours/complete',
      })
      ctx.logSuccess(403, { reason: 'forbidden', propertyId: tour.property_id, tourId })
      return forbidden(ctx.responseHeaders)
    }

    const result = await recordTourOutcome({
      propertyId: tour.property_id, leadId: tour.lead_id, source: tour.source,
      tourId, outcome: 'completed', notes, actorId:user.id,requestId,
    }, serviceClient)
    const failure = outcomeFailure(result)
    if (failure) return NextResponse.json({error: failure.error}, {status: failure.status, headers: ctx.responseHeaders})

    auditLog({
      eventType: 'tour_completed',
      userId: user.id,
      propertyId: tour.property_id,
      ip: getRequestIp(req),
      details: { tourId, leadId: tour.lead_id },
    })

    ctx.logSuccess(200, {
      tourId,
      leadId: tour.lead_id,
      propertyId: tour.property_id,
    })

    return NextResponse.json(
      {
        success: true,
        replayed: result.state === 'replayed' || result.state === 'legacy',
        followup: result.outcome!.followup_state,
        leadStatus: result.leadStatus,
        tour: {
          id: tourId,
          status: 'completed',
          completedAt: result.outcome!.outcome_at,
        },
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'complete_tour' })
    return serverError(error, ctx.responseHeaders)
  }
}
