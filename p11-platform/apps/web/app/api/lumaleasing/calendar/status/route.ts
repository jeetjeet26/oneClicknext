import {integrationPermissionState} from '@/utils/services/integration-permissions'
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

import { resolveCalendarTimezone } from '@/utils/services/timezone'

type WebhookCapability = {
  mode: 'push_watch' | 'unconfigured' | 'manual_check'
  ready: boolean
  blockers: string[]
  watch_expires_at: string | null
  watch_ttl_minutes: number | null
  watch_last_message_number: number | null
}

type ConnectionState = 'connected' | 'reconnect_required' | 'disconnected' | 'setup_required'

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getCalendarWebhookCapability(params: {
  connected: boolean
  provider?: string | null
  tokenStatus: string | null
  syncEnabled: boolean | null
  watchExpiration: string | null
  watchChannelId: string | null
  watchResourceId: string | null
  watchLastMessageNumber: number | null
}): WebhookCapability {
  if (params.provider === 'microsoft') {
    return { mode: 'manual_check', ready: false, blockers: ['automatic_updates_unavailable', ...(!params.connected ? ['missing_calendar_connection'] : [])],
      watch_expires_at: null, watch_ttl_minutes: null, watch_last_message_number: null }
  }

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

function getConnectionState(params: {
  tokenStatus: string | null
  syncEnabled: boolean | null
  tokenExpiresAt: string | null
}): ConnectionState {
  if (params.syncEnabled !== true || params.tokenStatus === 'disconnected') {
    return 'disconnected'
  }

  const tokenExpiresMs = parseIsoTimestamp(params.tokenExpiresAt)
  if (params.tokenStatus !== 'healthy' || tokenExpiresMs === null || tokenExpiresMs <= Date.now()) {
    return 'reconnect_required'
  }

  return 'connected'
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
      .select('id, scopes, provider_metadata, provider, google_email, account_email, token_status, last_health_check_at, token_expires_at, timezone, sync_enabled, calendar_id, watch_expiration, watch_channel_id, watch_resource_id, watch_last_message_number, properties(settings)')
      .eq('property_id', propertyId)
      .is('retired_at', null)
      .maybeSingle()

    if (error) throw error
    if (!calendar) {
      ctx.logSuccess(200, { propertyId, connected: false })
      return NextResponse.json(
        {
          connected: false,
          state: 'disconnected',
          message: 'Calendar not connected',
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

    const timezone = resolveCalendarTimezone(calendar.properties?.settings, calendar.timezone)
    const connectionState = getConnectionState({
      tokenStatus: calendar.token_status,
      syncEnabled: calendar.sync_enabled,
      tokenExpiresAt: calendar.token_expires_at,
    })
    const permissionState = integrationPermissionState(calendar.provider === 'microsoft' ? 'microsoft' : 'google', 'calendar', calendar.scopes, calendar.provider_metadata)
    const state: ConnectionState = connectionState === 'connected' && permissionState !== 'confirmed' ? 'reconnect_required' : connectionState === 'connected' && !timezone ? 'setup_required' : connectionState


    const reader = serviceSupabase as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:{state:string;summary:Record<string,number|boolean>}|null;error:unknown}>}
    const {data:summaryResult,error:summaryError}=await reader.rpc('read_calendar_sync_summary',{p_property_id:propertyId,p_calendar_id:calendar.id,p_actor_id:user.id})
    if(summaryError||summaryResult?.state!=='ready')throw new Error('Calendar summary could not be loaded')
    const calendarSyncSummary={...summaryResult.summary,degraded:state!=='connected'||summaryResult.summary.degraded===true}

    ctx.logSuccess(200, {
      propertyId,
      connected: state === 'connected',
      state,
      tokenStatus: calendar.token_status,
      webhookReady: getCalendarWebhookCapability({
        connected: state === 'connected',
        provider: calendar.provider,
        tokenStatus: calendar.token_status,
        syncEnabled: calendar.sync_enabled,
        watchExpiration: calendar.watch_expiration,
        watchChannelId: calendar.watch_channel_id,
        watchResourceId: calendar.watch_resource_id,
        watchLastMessageNumber: calendar.watch_last_message_number,
      }).ready,
    })

    return NextResponse.json(
      {
        connected: state === 'connected',
        state,
        provider: calendar.provider || 'google',
        email: calendar.account_email || calendar.google_email,
        account_email: calendar.account_email || calendar.google_email,
        permission_state: permissionState,
        permission_message: permissionState === 'confirmed' ? null : permissionState === 'permissions_incomplete' ? 'Required permissions are missing. Reconnect and grant the requested access.' : 'Saved permissions are unconfirmed. Reconnect this account to verify access.',
        token_status: calendar.token_status,
        last_health_check_at: calendar.last_health_check_at,
        token_expires_at: calendar.token_expires_at,
        timezone,
        timezone_setup_required: !timezone,
        sync_enabled: calendar.sync_enabled,
        calendar_id: calendar.calendar_id,
        webhook_capability: getCalendarWebhookCapability({
          connected: state === 'connected',
          provider: calendar.provider,
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
