import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'
import { unauthorized, validateCronAuth } from '@/utils/services/api-helpers'
import {
  type CalendarConfig,
  ensureCalendarWatch,
  shouldRenewCalendarWatch,
} from '@/utils/services/google-calendar'

type CalendarConfigRow = {
  id: string
  property_id: string | null
  google_email: string
  calendar_id: string | null
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  working_hours: CalendarConfig['working_hours'] | null
  tour_duration_minutes: number | null
  buffer_minutes: number | null
  timezone: string | null
  token_status: string | null
  watch_channel_id: string | null
  watch_last_message_number: number | null
  watch_resource_id: string | null
  watch_expiration: string | null
}

type RenewLog = {
  propertyId: string
  googleEmail: string
  status: 'success' | 'failed' | 'skipped'
  renewed?: boolean
  reason?: string
  error?: string
}

function toCalendarConfig(config: CalendarConfigRow): CalendarConfig | null {
  if (
    !config.property_id ||
    !config.access_token ||
    !config.refresh_token ||
    !config.token_expires_at
  ) {
    return null
  }

  return {
    id: config.id,
    property_id: config.property_id,
    google_email: config.google_email,
    calendar_id: config.calendar_id || 'primary',
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    token_expires_at: config.token_expires_at,
    working_hours: config.working_hours || {
      mon: { start: '09:00', end: '18:00', enabled: true },
      tue: { start: '09:00', end: '18:00', enabled: true },
      wed: { start: '09:00', end: '18:00', enabled: true },
      thu: { start: '09:00', end: '18:00', enabled: true },
      fri: { start: '09:00', end: '18:00', enabled: true },
      sat: { start: '10:00', end: '16:00', enabled: true },
      sun: { start: '00:00', end: '00:00', enabled: false },
    },
    tour_duration_minutes: config.tour_duration_minutes || 30,
    buffer_minutes: config.buffer_minutes || 15,
    timezone: config.timezone || 'America/Chicago',
    token_status: config.token_status || 'healthy',
    watch_channel_id: config.watch_channel_id,
    watch_last_message_number: config.watch_last_message_number,
    watch_resource_id: config.watch_resource_id,
    watch_expiration: config.watch_expiration,
  }
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/calendar-watch-renew')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'calendar-watch-renew',
    requestId: ctx.requestId,
  })

  try {
    const supabase = createServiceClient()
    const startTime = Date.now()
    const logs: RenewLog[] = []
    const { data: configs, error } = await supabase
      .from('agent_calendars')
      .select('*')
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

    for (const row of (configs || []) as CalendarConfigRow[]) {
      const calendarConfig = toCalendarConfig(row)
      if (!calendarConfig) {
        logs.push({
          propertyId: row.property_id || 'unknown',
          googleEmail: row.google_email,
          status: 'skipped',
          reason: 'incomplete_calendar_config',
        })
        continue
      }

      try {
        const shouldRenew = shouldRenewCalendarWatch(calendarConfig)
        const watch = await ensureCalendarWatch(calendarConfig)
        if (!watch) {
          logs.push({
            propertyId: calendarConfig.property_id,
            googleEmail: calendarConfig.google_email,
            status: 'skipped',
            reason: 'webhook_url_not_configured',
          })
          continue
        }

        logs.push({
          propertyId: calendarConfig.property_id,
          googleEmail: calendarConfig.google_email,
          status: 'success',
          renewed: shouldRenew,
        })
      } catch (watchError) {
        logs.push({
          propertyId: calendarConfig.property_id,
          googleEmail: calendarConfig.google_email,
          status: 'failed',
          error: watchError instanceof Error ? watchError.message : 'Unknown watch renewal error',
        })
      }
    }

    const processed = logs.length
    const successful = logs.filter(log => log.status === 'success').length
    const skipped = logs.filter(log => log.status === 'skipped').length
    const failed = logs.filter(log => log.status === 'failed').length
    const renewed = logs.filter(log => log.renewed).length
    const duration = Date.now() - startTime

    ctx.logSuccess(200, { processed, successful, skipped, failed, renewed })
    await finishCronJobRun(run, {
      status: failed > 0 ? 'failed' : 'success',
      error: failed > 0 ? 'One or more calendar watch renewals failed' : null,
      summary: {
        processed,
        successful,
        skipped,
        failed,
        renewed,
      },
    })

    return NextResponse.json(
      {
        success: failed === 0,
        processed,
        successful,
        skipped,
        failed,
        renewed,
        duration,
        results: logs,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'run_calendar_watch_renew_cron' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'run_calendar_watch_renew_cron' },
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }
}
