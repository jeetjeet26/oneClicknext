import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'
import {
  CalendarMutationIngestError,
  ingestExternalCalendarMutationsForProperty,
} from '@/utils/services/lumaleasing-calendar-mutations'

type CalendarConfigRow = {
  property_id: string | null
  google_email: string | null
  account_email: string | null
}

type IngestLog = {
  propertyId: string
  googleEmail?: string
  status: 'success' | 'failed' | 'skipped'
  checked?: number
  healthy?: number
  drifted?: number
  missing?: number
  cancelled?: number
  error?: string
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/calendar-ingest')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'lumaleasing-calendar-ingest',
    requestId: ctx.requestId,
  })

  try {
    const { searchParams } = new URL(request.url)
    const targetedPropertyId = searchParams.get('propertyId')
    const logs: IngestLog[] = []
    const startTime = Date.now()

    let propertyTargets: Array<{ propertyId: string; googleEmail?: string }> = []
    if (targetedPropertyId) {
      propertyTargets = [{ propertyId: targetedPropertyId }]
    } else {
      const supabase = createServiceClient()
      const { data: calendarConfigs, error } = await supabase
        .from('agent_calendars')
        .select('property_id, google_email, account_email')
        .eq('sync_enabled', true)
        .eq('token_status', 'healthy')
        .limit(1000)

      if (error) {
        ctx.logError(500, error, { operation: 'fetch_calendar_configs' })
        await finishCronJobRun(run, {
          status: 'failed',
          error: error.message,
          summary: { operation: 'fetch_calendar_configs' },
        })
        return NextResponse.json({ error: error.message }, { status: 500, headers: ctx.responseHeaders })
      }

      propertyTargets = Array.from(
        new Map(
          ((calendarConfigs || []) as CalendarConfigRow[])
            .filter((config): config is CalendarConfigRow & { property_id: string } =>
              typeof config.property_id === 'string' && config.property_id.length > 0
            )
            .map(config => [
              config.property_id,
              {
                propertyId: config.property_id,
                googleEmail: config.google_email || config.account_email || undefined,
              },
            ])
        ).values()
      )
    }

    for (const target of propertyTargets) {
      try {
        const summary = await ingestExternalCalendarMutationsForProperty(target.propertyId)
        logs.push({
          propertyId: target.propertyId,
          googleEmail: target.googleEmail,
          status: 'success',
          checked: summary.checked,
          healthy: summary.healthy,
          drifted: summary.drifted,
          missing: summary.missing,
          cancelled: summary.cancelled,
        })
      } catch (error) {
        if (error instanceof CalendarMutationIngestError) {
          logs.push({
            propertyId: target.propertyId,
            googleEmail: target.googleEmail,
            status: 'skipped',
            error: error.message,
          })
          continue
        }

        logs.push({
          propertyId: target.propertyId,
          googleEmail: target.googleEmail,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown ingestion error',
        })
      }
    }

    const processed = logs.length
    const successful = logs.filter(log => log.status === 'success').length
    const skipped = logs.filter(log => log.status === 'skipped').length
    const failed = logs.filter(log => log.status === 'failed').length
    const checked = logs.reduce((sum, log) => sum + (log.checked || 0), 0)
    const drifted = logs.reduce((sum, log) => sum + (log.drifted || 0), 0)
    const missing = logs.reduce((sum, log) => sum + (log.missing || 0), 0)
    const cancelled = logs.reduce((sum, log) => sum + (log.cancelled || 0), 0)
    const duration = Date.now() - startTime

    ctx.logSuccess(200, {
      processed,
      successful,
      skipped,
      failed,
      checked,
      drifted,
      missing,
      cancelled,
    })

    await finishCronJobRun(run, {
      status: failed > 0 ? 'failed' : 'success',
      error: failed > 0 ? 'One or more calendar ingestion runs failed' : null,
      summary: {
        processed,
        successful,
        skipped,
        failed,
        checked,
        drifted,
        missing,
        cancelled,
      },
    })

    return NextResponse.json(
      {
        success: failed === 0,
        processed,
        successful,
        skipped,
        failed,
        checked,
        drifted,
        missing,
        cancelled,
        duration,
        results: logs,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'run_calendar_ingest_cron' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'run_calendar_ingest_cron' },
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
