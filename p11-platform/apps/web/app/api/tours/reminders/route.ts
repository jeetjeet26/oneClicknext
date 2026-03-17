/**
 * Tour Reminders API Route
 * POST - Process pending tour reminders (called by CRON)
 * GET - Get pending reminder counts (for dashboard)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { processTourReminders, getPendingRemindersCount } from '@/utils/services/tour-reminders'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
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
 * POST - Process all pending tour reminders
 * Called by CRON job every 15-30 minutes
 */
export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/tours/reminders')
  ctx.logStart()
  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret', method: 'POST' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'tours-reminders',
    requestId: ctx.requestId,
  })

  try {
    const startTime = Date.now()
    
    const result = await processTourReminders()
    
    const duration = Date.now() - startTime
    ctx.logSuccess(200, {
      method: 'POST',
      durationMs: duration,
      ...result,
    })

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        processed: result.processed,
        reminders24h: result.reminders24h,
        reminders1h: result.reminders1h,
        failed: result.failed,
      },
    })

    return NextResponse.json(
      {
        success: true,
        ...result,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'process_tour_reminders' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'process_tour_reminders' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

/**
 * GET - Get count of pending reminders
 * Used by dashboard to show upcoming reminder notifications
 */
export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/tours/reminders')
  ctx.logStart()
  try {
    // Optionally verify auth for dashboard access
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    // Allow unauthenticated only for valid cron-auth callers.
    const isCronRequest = hasValidCronAuth(request)
    
    if (!user && !isCronRequest) {
      ctx.logSuccess(401, { reason: 'unauthorized', method: 'GET' })
      return unauthorized(ctx.responseHeaders)
    }

    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (user) {
      if (!propertyId) {
        ctx.logSuccess(400, { reason: 'missing_property_id', method: 'GET' })
        return badRequest('Property ID is required', ctx.responseHeaders)
      }

      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        ctx.logSuccess(403, { reason: 'forbidden', method: 'GET', propertyId, userId: user.id })
        return forbidden(ctx.responseHeaders)
      }
    }

    const counts = await getPendingRemindersCount(user ? propertyId || undefined : undefined)

    ctx.logSuccess(200, {
      method: 'GET',
      isCronRequest,
      propertyId: propertyId || null,
    })

    return NextResponse.json(
      {
        success: true,
        pending: counts,
        timestamp: new Date().toISOString(),
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'get_pending_tour_reminders' })
    return serverError(error, ctx.responseHeaders)
  }
}

