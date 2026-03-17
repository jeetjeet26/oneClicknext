/**
 * Google Calendar Status API
 * Returns calendar connection status for a property
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'

type WebhookCapability = {
  mode: 'push_watch' | 'unconfigured'
  ready: boolean
  blockers: string[]
  watch_expires_at: string | null
  watch_ttl_minutes: number | null
  watch_last_message_number: number | null
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getCalendarWebhookCapability(params: {
  connected: boolean
  tokenStatus: string | null
  syncEnabled: boolean | null
  watchExpiration: string | null
  watchChannelId: string | null
  watchResourceId: string | null
  watchLastMessageNumber: number | null
}): WebhookCapability {
  if (!params.connected) {
    return {
      mode: 'unconfigured',
      ready: false,
      blockers: ['missing_calendar_connection'],
      watch_expires_at: null,
      watch_ttl_minutes: null,
      watch_last_message_number: null,
    }
  }

  const blockers: string[] = []
  const nowMs = Date.now()
  const watchExpiresMs = parseIsoTimestamp(params.watchExpiration)
  const watchTtlMinutes =
    watchExpiresMs === null ? null : Math.max(0, Math.floor((watchExpiresMs - nowMs) / (60 * 1000)))

  if (params.syncEnabled !== true) {
    blockers.push('calendar_sync_disabled')
  }
  if (params.tokenStatus !== 'healthy') {
    blockers.push('token_not_healthy')
  }
  if (!params.watchChannelId || !params.watchResourceId) {
    blockers.push('missing_watch_channel')
  }
  if (watchExpiresMs === null) {
    blockers.push('missing_watch_expiration')
  } else if (watchExpiresMs <= nowMs) {
    blockers.push('watch_expired')
  }

  return {
    mode: 'push_watch',
    ready: blockers.length === 0,
    blockers,
    watch_expires_at: watchExpiresMs === null ? null : new Date(watchExpiresMs).toISOString(),
    watch_ttl_minutes: watchTtlMinutes,
    watch_last_message_number: params.watchLastMessageNumber,
  }
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/calendar/status')
  ctx.logStart()

  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      ctx.logSuccess(400, { reason: 'missing_property_id' })
      return badRequest('Property ID required', ctx.responseHeaders)
    }

    // Verify user has access to this property
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    // Get calendar status
    const serviceSupabase = createServiceClient()
    const { data: calendar, error } = await serviceSupabase
      .from('agent_calendars')
      .select('id, google_email, token_status, last_health_check_at, token_expires_at, timezone, sync_enabled, calendar_id, watch_expiration, watch_channel_id, watch_resource_id, watch_last_message_number')
      .eq('property_id', propertyId)
      .eq('sync_enabled', true)
      .maybeSingle()

    if (error || !calendar) {
      ctx.logSuccess(200, { propertyId, connected: false })
      return NextResponse.json(
        {
          connected: false,
          message: 'Google Calendar not connected',
          webhook_capability: getCalendarWebhookCapability({
            connected: false,
            tokenStatus: null,
            syncEnabled: null,
            watchExpiration: null,
            watchChannelId: null,
            watchResourceId: null,
            watchLastMessageNumber: null,
          }),
        },
        { headers: ctx.responseHeaders }
      )
    }

    ctx.logSuccess(200, {
      propertyId,
      connected: true,
      tokenStatus: calendar.token_status,
      webhookReady: getCalendarWebhookCapability({
        connected: true,
        tokenStatus: calendar.token_status,
        syncEnabled: calendar.sync_enabled,
        watchExpiration: calendar.watch_expiration,
        watchChannelId: calendar.watch_channel_id,
        watchResourceId: calendar.watch_resource_id,
        watchLastMessageNumber: calendar.watch_last_message_number,
      }).ready,
    })

    const calendarSyncSummary = {
      total_events: 0,
      synced_events: 0,
      failed_events: 0,
      external_drift_events: 0,
      external_missing_events: 0,
      external_cancelled_events: 0,
      other_events: 0,
      missing_event_bookings: 0,
      degraded:
        calendar.token_status !== 'healthy',
    }

    const { data: calendarEvents } = await serviceSupabase
      .from('calendar_events')
      .select('tour_booking_id, sync_status')
      .eq('agent_calendar_id', calendar.id)
      .limit(1000)

    const eventRows = (calendarEvents || []) as Array<{
      tour_booking_id: string | null
      sync_status: string | null
    }>
    const bookingIdsWithEvent = new Set(
      eventRows
        .map((row) => row.tour_booking_id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
    calendarSyncSummary.total_events = eventRows.length
    for (const row of eventRows) {
      if (row.sync_status === 'synced') {
        calendarSyncSummary.synced_events += 1
      } else if (row.sync_status === 'failed') {
        calendarSyncSummary.failed_events += 1
      } else if (row.sync_status === 'external_drift') {
        calendarSyncSummary.external_drift_events += 1
      } else if (row.sync_status === 'external_missing') {
        calendarSyncSummary.external_missing_events += 1
      } else if (row.sync_status === 'external_cancelled') {
        calendarSyncSummary.external_cancelled_events += 1
      } else {
        calendarSyncSummary.other_events += 1
      }
    }

    const { data: activeBookings } = await serviceSupabase
      .from('tour_bookings')
      .select('id')
      .eq('property_id', propertyId)
      .in('status', ['scheduled', 'confirmed'])
      .limit(1000)

    const activeBookingRows = (activeBookings || []) as Array<{ id: string }>
    calendarSyncSummary.missing_event_bookings = activeBookingRows.filter(
      (booking) => !bookingIdsWithEvent.has(booking.id)
    ).length
    calendarSyncSummary.degraded =
      calendarSyncSummary.degraded ||
      calendarSyncSummary.failed_events > 0 ||
      calendarSyncSummary.external_drift_events > 0 ||
      calendarSyncSummary.external_missing_events > 0 ||
      calendarSyncSummary.external_cancelled_events > 0 ||
      calendarSyncSummary.missing_event_bookings > 0

    return NextResponse.json(
      {
        connected: true,
        email: calendar.google_email,
        token_status: calendar.token_status,
        last_health_check_at: calendar.last_health_check_at,
        token_expires_at: calendar.token_expires_at,
        timezone: calendar.timezone,
        sync_enabled: calendar.sync_enabled,
        calendar_id: calendar.calendar_id,
        webhook_capability: getCalendarWebhookCapability({
          connected: true,
          tokenStatus: calendar.token_status,
          syncEnabled: calendar.sync_enabled,
          watchExpiration: calendar.watch_expiration,
          watchChannelId: calendar.watch_channel_id,
          watchResourceId: calendar.watch_resource_id,
          watchLastMessageNumber: calendar.watch_last_message_number,
        }),
        calendar_sync: calendarSyncSummary,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'google_calendar_status_fetch' })
    return serverError(error, ctx.responseHeaders)
  }
}
