import { processLumaDelivery } from '@/utils/services/luma-delivery'
/**
 * Workflow Processor API
 * Called by CRON job to process pending workflow actions
 * 
 * This endpoint should be called every 10 minutes by:
 * - Vercel Cron Jobs
 * - Heroku Scheduler
 * - External service like Upstash QStash
 * 
 * Security: Uses CRON_SECRET to prevent unauthorized access
 */

import {
serverError,
unauthorized,
validateCronAuth,
} from '@/utils/services/api-helpers'
import { cronStatusFromOutcomes,confirmCronJobRun,finishCronJobRun,startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'
import { processWorkflows } from '@/utils/services/workflow-processor'
import { NextRequest,NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/workflows/process')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'workflows-process',
    requestId: ctx.requestId,
  })

  const startTime = Date.now()

  try {
    if (!run) throw new Error('Could not save scheduled run')
    const delivery = await processLumaDelivery()
    const result = await processWorkflows()
    result.processed += delivery.processed
    result.succeeded += delivery.succeeded
    result.failed += delivery.failed
    if (delivery.failed) result.errors.push('Some tour confirmations need retry or review')
    const duration = Date.now() - startTime
    const status = cronStatusFromOutcomes(result)
    const httpStatus = status === 'failed' ? 503 : 200

    const logDetails = {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      durationMs: duration,
    }
    if (status === 'success') {
      ctx.logSuccess(httpStatus, logDetails)
    } else {
      ctx.logError(httpStatus, new Error(result.errors.join('; ') || 'Workflow actions failed'), logDetails)
    }

    await confirmCronJobRun(run, {
      status,
      error: result.errors.length ? result.errors.join('; ').slice(0, 2000) : null,
      summary: {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
      },
    })

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
    ctx.logError(500, error, { operation: 'process_workflows' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'process_workflows' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

// Also support POST for webhook-style CRON services
export async function POST(request: NextRequest) {
  return GET(request)
}
