import { NextRequest, NextResponse } from 'next/server'
import { validateCronAuth } from '@/utils/services/api-helpers'
import { startCronJobRun, confirmCronJobRun, finishCronJobRun } from '@/utils/services/cron-job-runs'
import { createServiceClient } from '@/utils/supabase/admin'
import { runSource, sourceExecutionStatus } from '@/utils/marketvision/source-store'
export const maxDuration = 90
export async function GET(req: NextRequest) {
  const denied = validateCronAuth(req)
  if (denied) return denied
  if (sourceExecutionStatus().paused) return NextResponse.json({ state: 'paused', processed: 0 })
  const run = await startCronJobRun({ jobName: 'process-market-sources', requestId: req.headers.get('x-request-id') })
  if (!run) return NextResponse.json({ error: 'Could not record the source worker run.' }, { status: 503 })
  try {
    const { data, error } = await createServiceClient().from('marketvision_source_requests').select('id').eq('state', 'queued').order('created_at').limit(2)
    if (error || !data) throw new Error('Source queue unavailable')
    const outcomes: Array<{ requestId: string; state: string }> = []
    for (const row of data) {
      try { const result = await runSource(row.id); outcomes.push({ requestId: row.id, state: String('requestState' in result ? result.requestState : result.state) }) }
      catch { outcomes.push({ requestId: row.id, state: 'unconfirmed' }) }
    }
    const failed = outcomes.filter(row => !['received', 'stopped', 'running'].includes(row.state)).length
    const status = failed ? failed === outcomes.length ? 'failed' : 'partial' : 'success'
    await confirmCronJobRun(run, { status, summary: { processed: outcomes.length, outcomes } })
    return NextResponse.json({ state: status, processed: outcomes.length, outcomes }, { status: status === 'failed' ? 503 : 200 })
  } catch {
    await finishCronJobRun(run, { status: 'failed', error: 'Saved source worker result could not be confirmed' })
    return NextResponse.json({ error: 'Saved source worker result could not be confirmed.' }, { status: 503 })
  }
}
export const POST = GET
