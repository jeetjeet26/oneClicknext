import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { syncRecentPublicationMetrics } from '@/utils/forgestudio/engagement-sync'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/sync-forgestudio-metrics')
  ctx.logStart()
  if (!hasValidCronAuth(request)) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }
  try {
    const result = await syncRecentPublicationMetrics({ limit: 50 })
    ctx.logSuccess(200, result)
    return NextResponse.json(
      { success: true, ...result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'sync_forgestudio_metrics' })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Metric sync failed' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
