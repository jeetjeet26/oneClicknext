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

import { NextRequest, NextResponse } from 'next/server'
import { processWorkflows } from '@/utils/services/workflow-processor'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import {
  validateCronAuth,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

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
    const result = await processWorkflows()
    const duration = Date.now() - startTime

    ctx.logSuccess(200, {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      durationMs: duration,
    })

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        processed: result.processed,
        succeeded: result.succeeded,
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

