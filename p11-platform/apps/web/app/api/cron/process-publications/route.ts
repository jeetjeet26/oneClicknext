import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { processDuePublications } from '@/utils/forgestudio/publication-worker'
import { createRequestContext } from '@/utils/services/request-context'

export const maxDuration = 300

/**
 * Wakes the ForgeStudio publication queue. Hosted cron and the local worker
 * loop both call this — execution semantics live entirely in
 * processDuePublications(), never here.
 */
export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/process-publications')
  ctx.logStart()

  if (!hasValidCronAuth(request)) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: ctx.responseHeaders }
    )
  }

  try {
    const workerId = `cron:${process.env.VERCEL_REGION || 'local'}:${ctx.requestId}`
    const run = await processDuePublications({ workerId, limit: 5 })

    ctx.logSuccess(200, { claimed: run.claimed })
    return NextResponse.json({
      success: true,
      claimed: run.claimed,
      results: run.results,
    }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'process_due_publications' })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Worker run failed' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
