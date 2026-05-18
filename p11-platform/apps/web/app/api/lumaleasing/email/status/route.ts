/**
 * Gmail Status API
 * Returns email connection status for a property
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { badRequest, forbidden, serverError, unauthorized } from '@/utils/services/api-helpers'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { createRequestContext } from '@/utils/services/request-context'

type ThreadStatusSummary = {
  total_threads: number
  awaiting_internal_reply: number
  awaiting_internal_reply_overdue: number
  awaiting_lead_reply: number
  active: number
  other: number
  latest_thread_activity_at: string | null
}

type PendingThreadPreview = {
  id: string
  status: string | null
  subject: string | null
  last_message_at: string | null
  message_count: number | null
  lead_id: string | null
  overdue: boolean
  overdue_days: number | null
}

type WebhookCapability = {
  mode: 'push_watch' | 'unconfigured'
  ready: boolean
  blockers: string[]
  watch_expires_at: string | null
  watch_ttl_minutes: number | null
  history_id: string | null
}

type ConnectionState = 'connected' | 'reconnect_required' | 'disconnected'

const INTERNAL_REPLY_OVERDUE_DAYS = 2
const MS_PER_DAY = 24 * 60 * 60 * 1000

function getOverdueDays(lastMessageAt: string | null, nowMs: number): number | null {
  if (!lastMessageAt) {
    return null
  }

  const lastMessageMs = new Date(lastMessageAt).getTime()
  if (!Number.isFinite(lastMessageMs)) {
    return null
  }

  const deltaMs = nowMs - lastMessageMs
  if (deltaMs < INTERNAL_REPLY_OVERDUE_DAYS * MS_PER_DAY) {
    return null
  }

  return Math.max(INTERNAL_REPLY_OVERDUE_DAYS, Math.floor(deltaMs / MS_PER_DAY))
}

function summarizeThreadStatuses(
  rows: Array<{ status: string | null; last_message_at: string | null }>
): ThreadStatusSummary {
  const nowMs = Date.now()
  let awaitingInternalReply = 0
  let awaitingInternalReplyOverdue = 0
  let awaitingLeadReply = 0
  let active = 0
  let other = 0
  let latestThreadActivityAt: string | null = null

  for (const row of rows) {
    if (!latestThreadActivityAt && row.last_message_at) {
      latestThreadActivityAt = row.last_message_at
    }

    if (row.status === 'awaiting_internal_reply') {
      awaitingInternalReply += 1
      if (getOverdueDays(row.last_message_at, nowMs) !== null) {
        awaitingInternalReplyOverdue += 1
      }
    } else if (row.status === 'awaiting_lead_reply') {
      awaitingLeadReply += 1
    } else if (row.status === 'active') {
      active += 1
    } else {
      other += 1
    }
  }

  return {
    total_threads: rows.length,
    awaiting_internal_reply: awaitingInternalReply,
    awaiting_internal_reply_overdue: awaitingInternalReplyOverdue,
    awaiting_lead_reply: awaitingLeadReply,
    active,
    other,
    latest_thread_activity_at: latestThreadActivityAt,
  }
}

function parseIsoTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getEmailWebhookCapability(params: {
  connected: boolean
  tokenStatus: string | null
  syncEnabled: boolean | null
  historyId: string | null
  watchExpiration: string | null
}): WebhookCapability {
  if (!params.connected) {
    return {
      mode: 'unconfigured',
      ready: false,
      blockers: ['missing_email_connection'],
      watch_expires_at: null,
      watch_ttl_minutes: null,
      history_id: null,
    }
  }

  const blockers: string[] = []
  const nowMs = Date.now()
  const watchExpiresMs = parseIsoTimestamp(params.watchExpiration)
  const watchTtlMinutes =
    watchExpiresMs === null ? null : Math.max(0, Math.floor((watchExpiresMs - nowMs) / (60 * 1000)))

  if (params.syncEnabled !== true) {
    blockers.push('email_sync_disabled')
  }
  if (params.tokenStatus !== 'healthy') {
    blockers.push('token_not_healthy')
  }
  if (!params.historyId) {
    blockers.push('missing_history_cursor')
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
    history_id: params.historyId,
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
  if (params.tokenStatus !== 'healthy' || (tokenExpiresMs !== null && tokenExpiresMs <= Date.now())) {
    return 'reconnect_required'
  }

  return 'connected'
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/email/status')
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

    // Get email status
    const serviceSupabase = createServiceClient()
    const { data: emailConfig, error } = await serviceSupabase
      .from('email_configurations')
      .select('id, provider, google_email, account_email, token_status, last_health_check_at, token_expires_at, sync_enabled, auto_reply_enabled, last_sync_at, history_id, watch_expiration')
      .eq('property_id', propertyId)
      .maybeSingle()

    if (error || !emailConfig) {
      ctx.logSuccess(200, { propertyId, connected: false })
      return NextResponse.json(
        {
          connected: false,
          state: 'disconnected',
          message: 'Gmail not connected',
          webhook_capability: getEmailWebhookCapability({
            connected: false,
            tokenStatus: null,
            syncEnabled: null,
            historyId: null,
            watchExpiration: null,
          }),
        },
        { headers: ctx.responseHeaders }
      )
    }

    const state = getConnectionState({
      tokenStatus: emailConfig.token_status,
      syncEnabled: emailConfig.sync_enabled,
      tokenExpiresAt: emailConfig.token_expires_at,
    })

    const { data: threadRows, error: threadError } = await serviceSupabase
      .from('email_threads')
      .select('status, last_message_at')
      .eq('email_configuration_id', emailConfig.id)
      .order('last_message_at', { ascending: false })
      .limit(500)

    const { data: pendingThreadRows, error: pendingThreadError } = await serviceSupabase
      .from('email_threads')
      .select('id, status, subject, last_message_at, message_count, lead_id')
      .eq('email_configuration_id', emailConfig.id)
      .in('status', ['awaiting_internal_reply', 'awaiting_lead_reply'])
      .order('last_message_at', { ascending: false })
      .limit(10)

    const threadLifecycle = threadError
      ? {
          total_threads: 0,
          awaiting_internal_reply: 0,
          awaiting_internal_reply_overdue: 0,
          awaiting_lead_reply: 0,
          active: 0,
          other: 0,
          latest_thread_activity_at: null,
        }
      : summarizeThreadStatuses(
          (threadRows || []) as Array<{ status: string | null; last_message_at: string | null }>
        )

    const pendingThreads = pendingThreadError
      ? []
      : ((pendingThreadRows || []) as Array<Omit<PendingThreadPreview, 'overdue' | 'overdue_days'>>).map(
          (thread) => {
            const overdueDays =
              thread.status === 'awaiting_internal_reply'
                ? getOverdueDays(thread.last_message_at, Date.now())
                : null

            return {
              ...thread,
              overdue: overdueDays !== null,
              overdue_days: overdueDays,
            }
          }
        )

    ctx.logSuccess(200, {
      propertyId,
      connected: state === 'connected',
      state,
      tokenStatus: emailConfig.token_status,
      webhookReady: getEmailWebhookCapability({
        connected: true,
        tokenStatus: emailConfig.token_status,
        syncEnabled: emailConfig.sync_enabled,
        historyId: emailConfig.history_id,
        watchExpiration: emailConfig.watch_expiration,
      }).ready,
      awaitingInternalReply: threadLifecycle.awaiting_internal_reply,
      overdueInternalReply: threadLifecycle.awaiting_internal_reply_overdue,
      awaitingLeadReply: threadLifecycle.awaiting_lead_reply,
      pendingPreviewCount: pendingThreads.length,
    })

    return NextResponse.json(
      {
        connected: state === 'connected',
        state,
        provider: emailConfig.provider || 'google',
        email: emailConfig.account_email || emailConfig.google_email,
        account_email: emailConfig.account_email || emailConfig.google_email,
        token_status: emailConfig.token_status,
        last_health_check_at: emailConfig.last_health_check_at,
        last_sync_at: emailConfig.last_sync_at,
        sync_enabled: emailConfig.sync_enabled,
        auto_reply_enabled: emailConfig.auto_reply_enabled,
        webhook_capability: getEmailWebhookCapability({
          connected: true,
          tokenStatus: emailConfig.token_status,
          syncEnabled: emailConfig.sync_enabled,
          historyId: emailConfig.history_id,
          watchExpiration: emailConfig.watch_expiration,
        }),
        thread_lifecycle: threadLifecycle,
        pending_threads_preview: pendingThreads,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'gmail_status_fetch' })
    return serverError(error, ctx.responseHeaders)
  }
}
