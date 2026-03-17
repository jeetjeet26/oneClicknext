import { NextRequest, NextResponse } from 'next/server'
import { processPendingCRMSyncs } from '@/utils/services/crm-sync'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import {
  validateCronAuth,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/crm-sync')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'crm-sync',
    requestId: ctx.requestId,
  })

  try {
    const result = await processPendingCRMSyncs()

    ctx.logSuccess(200, {
      processed: result.processed,
      succeeded: result.succeeded,
      scheduledRetries: result.scheduledRetries,
      deadLettered: result.deadLettered,
      skipped: result.skipped,
      failed: result.failed,
    })

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        processed: result.processed,
        succeeded: result.succeeded,
        scheduledRetries: result.scheduledRetries,
        deadLettered: result.deadLettered,
        skipped: result.skipped,
        failed: result.failed,
      },
    })

    return NextResponse.json(
      {
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'process_crm_sync_retries' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'process_crm_sync_retries' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
