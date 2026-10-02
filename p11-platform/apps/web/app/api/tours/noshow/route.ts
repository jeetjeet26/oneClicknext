/**
 * Tour No-Show Processing API Route
 * POST - Record no-shows and queue eligible follow-ups (called by CRON)
 * GET - Get no-show statistics for a property
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { processTourNoShows, getNoShowStats } from '@/utils/services/tour-noshow'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { confirmCronJobRun, finishCronJobRun, startCronJobRun, cronStatusFromOutcomes } from '@/utils/services/cron-job-runs'
import {
  badRequest,
  forbidden,
  hasValidCronAuth,
  serverError,
  unauthorized,
  validateCronAuth,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

/**
 * POST - Record tour no-shows with bounded recovery; this route never sends messages
 * Called by CRON job hourly
 */
export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/tours/noshow')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'tours-noshow',
    requestId: ctx.requestId,
  })

  try {
    if (!run) throw new Error('Unable to record no-show job start')
    const startTime = Date.now()
    
    const result = await processTourNoShows()
    
    const duration = Date.now() - startTime
    console.log(`[TourNoShow] Completed in ${duration}ms`)

    const unresolved = result.needsTimezone + result.needsSetup + result.deferred + (result.needsReview ?? 0) + (result.backlog ?? 0)
    const status = cronStatusFromOutcomes({succeeded: result.markedNoShow,
      failed: result.failed + unresolved, errors: result.errors})
    await confirmCronJobRun(run, {status, summary: {...result}})
    const httpStatus = status === 'failed' ? 503 : 200
    ctx.logSuccess(httpStatus, {processed: result.processed, failed: result.failed, durationMs: duration, status})

    return NextResponse.json(
      {
        success: status === 'success',
        status,
        ...result,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
      },
      { status: httpStatus, headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'process_tour_noshows' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'process_tour_noshows' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

/**
 * GET - Get no-show statistics for dashboard
 */
export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/tours/noshow')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    // Allow unauthenticated only for valid cron-auth callers.
    const isCronRequest = hasValidCronAuth(request)
    
    if ((authError || !user) && !isCronRequest) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    // Get property ID from query params
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID is required', ctx.responseHeaders)
    }

    if (user) {
      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
        return forbidden(ctx.responseHeaders)
      }
    }

    const stats = await getNoShowStats(propertyId)

    ctx.logSuccess(200, {
      propertyId,
      totalNoShows: stats.totalNoShows,
    })

    return NextResponse.json(
      {
        success: true,
        stats,
        timestamp: new Date().toISOString(),
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'fetch_tour_noshow_stats' })
    return serverError(error, ctx.responseHeaders)
  }
}

