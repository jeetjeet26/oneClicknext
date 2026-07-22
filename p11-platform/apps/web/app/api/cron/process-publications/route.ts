import { NextRequest, NextResponse } from 'next/server'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { processDuePublications } from '@/utils/forgestudio/publication-worker'

export const maxDuration = 300

/**
 * Wakes the ForgeStudio publication queue. Hosted cron and the local worker
 * loop both call this — execution semantics live entirely in
 * processDuePublications(), never here.
 */
export async function GET(request: NextRequest) {
  if (!hasValidCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const workerId = `cron:${process.env.VERCEL_REGION || 'local'}:${Date.now()}`
    const run = await processDuePublications({ workerId, limit: 5 })

    return NextResponse.json({
      success: true,
      claimed: run.claimed,
      results: run.results,
    })
  } catch (error) {
    console.error('[cron.process-publications] run failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Worker run failed' },
      { status: 500 }
    )
  }
}
