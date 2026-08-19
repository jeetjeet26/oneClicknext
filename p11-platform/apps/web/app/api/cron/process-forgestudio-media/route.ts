import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'
import { processDueMediaJobs } from '@/utils/forgestudio/media-jobs'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/process-forgestudio-media')
  ctx.logStart()
  if (!hasValidCronAuth(request)) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }

  try {
    const result = await processDueMediaJobs({
      workerId: `forgestudio-media:${process.env.VERCEL_REGION || 'local'}:${ctx.requestId}`,
      limit: 2,
    })
    ctx.logSuccess(200, { claimed: result.claimed })
    return NextResponse.json(
      { success: true, ...result },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'process_forgestudio_media' })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Media worker failed' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
