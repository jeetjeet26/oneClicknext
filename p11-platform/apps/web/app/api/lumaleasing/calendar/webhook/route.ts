import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { createRequestContext } from '@/utils/services/request-context'
import {
  getRateLimitKey,
  rateLimitHeaders,
  webhookLimiter,
} from '@/utils/services/rate-limiter'
import { rateLimited } from '@/utils/services/api-helpers'
import { ingestExternalCalendarMutationsForProperty } from '@/utils/services/lumaleasing-calendar-mutations'

type AgentCalendarWatchRow = {
  id: string
  property_id: string | null
  sync_enabled: boolean | null
  token_status: string | null
  watch_last_message_number: number | null
}

function acknowledge(
  headers: Record<string, string>,
  details: Record<string, unknown> = {}
) {
  return NextResponse.json(
    {
      success: true,
      ...details,
    },
    {
      status: 200,
      headers,
    }
  )
}

function parseWatchExpiration(value: string | null): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed.toISOString()
}

function parseMessageNumber(value: string | null): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.floor(parsed)
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/calendar/webhook')
  ctx.logStart()

  try {
    const rlKey = getRateLimitKey(request, 'calendar-webhook')
    const rl = webhookLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...ctx.responseHeaders, ...rateLimitHeaders(rl) })
    }

    const channelId = request.headers.get('x-goog-channel-id')
    const resourceId = request.headers.get('x-goog-resource-id')
    const resourceState = request.headers.get('x-goog-resource-state')
    const messageNumber = parseMessageNumber(request.headers.get('x-goog-message-number'))
    const watchExpiration = parseWatchExpiration(request.headers.get('x-goog-channel-expiration'))

    if (!channelId || !resourceId || !resourceState) {
      ctx.logSuccess(200, { reason: 'missing_watch_headers' })
      return acknowledge(ctx.responseHeaders)
    }

    const supabase = createServiceClient()
    const { data: calendarConfig, error: calendarConfigError } = await supabase
      .from('agent_calendars')
      .select('id, property_id, sync_enabled, token_status, watch_last_message_number')
      .eq('watch_channel_id', channelId)
      .eq('watch_resource_id', resourceId)
      .maybeSingle()

    if (calendarConfigError || !calendarConfig) {
      ctx.logSuccess(200, {
        reason: 'calendar_watch_not_found',
        resourceState,
      })
      return acknowledge(ctx.responseHeaders)
    }

    const watchConfig = calendarConfig as AgentCalendarWatchRow
    if (!watchConfig.property_id || watchConfig.sync_enabled === false) {
      ctx.logSuccess(200, {
        reason: 'calendar_watch_inactive',
        resourceState,
      })
      return acknowledge(ctx.responseHeaders)
    }

    if (
      messageNumber !== null &&
      watchConfig.watch_last_message_number !== null &&
      messageNumber <= watchConfig.watch_last_message_number
    ) {
      ctx.logSuccess(200, {
        reason: 'stale_message_number',
        propertyId: watchConfig.property_id,
        resourceState,
        messageNumber,
        watchLastMessageNumber: watchConfig.watch_last_message_number,
      })
      return acknowledge(ctx.responseHeaders)
    }

    const watchMetadataUpdate: Record<string, string | number> = {
      updated_at: new Date().toISOString(),
    }
    if (watchExpiration) {
      watchMetadataUpdate.watch_expiration = watchExpiration
    }
    if (messageNumber !== null) {
      watchMetadataUpdate.watch_last_message_number = messageNumber
    }

    if (watchExpiration || messageNumber !== null) {
      await supabase
        .from('agent_calendars')
        .update(watchMetadataUpdate)
        .eq('id', watchConfig.id)
    }

    if (resourceState === 'sync') {
      ctx.logSuccess(200, {
        propertyId: watchConfig.property_id,
        resourceState,
        initialSync: true,
      })
      return acknowledge(ctx.responseHeaders)
    }

    if (watchConfig.token_status !== 'healthy') {
      ctx.logSuccess(200, {
        reason: 'calendar_not_healthy',
        propertyId: watchConfig.property_id,
        resourceState,
      })
      return acknowledge(ctx.responseHeaders)
    }

    const summary = await ingestExternalCalendarMutationsForProperty(watchConfig.property_id)

    ctx.logSuccess(200, {
      propertyId: watchConfig.property_id,
      resourceState,
      checked: summary.checked,
      drifted: summary.drifted,
      missing: summary.missing,
      cancelled: summary.cancelled,
    })

    return acknowledge(ctx.responseHeaders, {
      propertyId: watchConfig.property_id,
      resourceState,
      checked: summary.checked,
      drifted: summary.drifted,
      missing: summary.missing,
      cancelled: summary.cancelled,
    })
  } catch (error) {
    ctx.logError(200, error, { operation: 'calendar_webhook_acknowledge' })
    return acknowledge(ctx.responseHeaders)
  }
}
