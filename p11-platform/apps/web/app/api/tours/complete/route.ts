/**
 * Tour Completion Endpoint
 * POST - Marks a tour as completed, triggers follow-up workflows and engagement tracking
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { startWorkflow } from '@/utils/services/workflow-processor'
import { trackEngagementEvent } from '@/utils/services/engagement-tracker'
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
    const rawBody = await req.json()
    const validation = validateBody(rawBody, tourCompleteSchema)
    if (!validation.success) {
      ctx.logSuccess(400, { reason: 'validation_failed' })
      return badRequest(validation.error, ctx.responseHeaders)
    }

    const { tourId, notes } = validation.data

    const serviceClient = createServiceClient()

    // Get the tour with lead and property info
    const { data: tour, error: tourError } = await serviceClient
      .from('tour_bookings')
      .select('id, lead_id, property_id, status, scheduled_date, scheduled_time')
      .eq('id', tourId)
      .single()

    if (tourError || !tour) return notFound('Tour')

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

    if (tour.status === 'completed') {
      ctx.logSuccess(400, { reason: 'already_completed', tourId })
      return badRequest('Tour already completed', ctx.responseHeaders)
    }

    const now = new Date().toISOString()

    // Mark tour as completed
    await serviceClient
      .from('tour_bookings')
      .update({
        status: 'completed',
        completed_at: now,
        completion_notes: notes || null,
      })
      .eq('id', tourId)

    // Update lead status
    await serviceClient
      .from('leads')
      .update({
        status: 'toured',
        last_contacted_at: now,
      })
      .eq('id', tour.lead_id)

    // Create activity on lead
    await serviceClient.from('lead_activities').insert({
      lead_id: tour.lead_id,
      type: 'tour_completed',
      description: `Tour completed on ${tour.scheduled_date}`,
      metadata: { tour_id: tourId, notes },
    })

    // Track tour_completed engagement event (non-blocking)
    trackEngagementEvent({
      leadId: tour.lead_id,
      propertyId: tour.property_id,
      eventType: 'tour_completed',
      metadata: { tour_id: tourId },
    }).catch(e => console.error('[Tour Complete] Engagement tracking failed:', e))

    // Start tour_completed follow-up workflow (non-blocking)
    startWorkflow(tour.lead_id, tour.property_id, 'tour_completed').catch(e =>
      console.error('[Tour Complete] Workflow start failed:', e)
    )

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
        tour: {
          id: tourId,
          status: 'completed',
          completedAt: now,
        },
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'complete_tour' })
    return serverError(error, ctx.responseHeaders)
  }
}
