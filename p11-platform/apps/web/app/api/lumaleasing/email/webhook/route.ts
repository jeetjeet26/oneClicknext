/**
 * Gmail Push Notification Webhook
 * Receives push notifications from Google Cloud Pub/Sub and delegates inbox
 * synchronization to the shared Gmail service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { type GmailConfig, syncInbox } from '@/utils/services/gmail-service'
import { createRequestContext } from '@/utils/services/request-context'
import {
  getRateLimitKey,
  rateLimitHeaders,
  webhookLimiter,
} from '@/utils/services/rate-limiter'
import { rateLimited } from '@/utils/services/api-helpers'
import { gmailWebhookSchema, validateBody } from '@/utils/services/validation'

interface PubSubMessage {
  message: {
    data: string
    messageId: string
    publishTime: string
  }
  subscription: string
}

interface MessageData {
  emailAddress: string
  historyId: string
}

interface EmailConfigRow {
  id: string
  property_id: string | null
  profile_id: string | null
  provider: string | null
  google_email: string | null
  account_email: string | null
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  sync_enabled: boolean | null
  auto_reply_enabled: boolean | null
  signature_template: string | null
  token_status: string | null
  last_sync_at: string | null
  history_id: string | null
  watch_expiration: string | null
  provider_metadata: Record<string, unknown> | null
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

function decodePubSubData(value: string): MessageData {
  const decodedData = Buffer.from(value, 'base64').toString('utf-8')
  const parsed = JSON.parse(decodedData) as Partial<MessageData>

  if (!parsed.emailAddress || !parsed.historyId) {
    throw new Error('Missing required data fields')
  }

  return {
    emailAddress: parsed.emailAddress,
    historyId: parsed.historyId,
  }
}

function toGmailConfig(config: EmailConfigRow): GmailConfig | null {
  if (
    !config.property_id ||
    !config.profile_id ||
    (!config.google_email && !config.account_email) ||
    !config.access_token ||
    !config.refresh_token ||
    !config.token_expires_at
  ) {
    return null
  }

  return {
    id: config.id,
    property_id: config.property_id,
    profile_id: config.profile_id,
    provider: config.provider === 'microsoft' ? 'microsoft' : 'google',
    google_email: config.google_email || config.account_email || '',
    account_email: config.account_email || config.google_email || '',
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    token_expires_at: config.token_expires_at,
    sync_enabled: config.sync_enabled ?? true,
    auto_reply_enabled: config.auto_reply_enabled ?? false,
    signature_template: config.signature_template ?? null,
    token_status: config.token_status ?? 'healthy',
    last_sync_at: config.last_sync_at ?? null,
    history_id: config.history_id ?? null,
    watch_expiration: config.watch_expiration ?? null,
    provider_metadata: config.provider_metadata ?? {},
  }
}

function shouldSkipHistorySync(
  incomingHistoryId: string,
  currentHistoryId: string | null
): boolean {
  if (!currentHistoryId) {
    return false
  }

  if (incomingHistoryId === currentHistoryId) {
    return true
  }

  try {
    return BigInt(incomingHistoryId) <= BigInt(currentHistoryId)
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/lumaleasing/email/webhook')
  ctx.logStart()

  try {
    const rlKey = getRateLimitKey(request, 'gmail-webhook')
    const rl = webhookLimiter.check(rlKey)
    if (!rl.allowed) {
      ctx.logSuccess(429, { reason: 'rate_limited' })
      return rateLimited({ ...ctx.responseHeaders, ...rateLimitHeaders(rl) })
    }

    const rawBody = await request.json()
    const validation = validateBody(rawBody, gmailWebhookSchema)
    if (!validation.success) {
      ctx.logSuccess(200, {
        reason: 'invalid_webhook_body',
        error: validation.error,
      })
      return acknowledge(ctx.responseHeaders)
    }

    const body = validation.data as PubSubMessage

    if (!body?.message?.data) {
      ctx.logSuccess(200, { reason: 'missing_message_data' })
      return acknowledge(ctx.responseHeaders)
    }

    try {
      const messageData = decodePubSubData(body.message.data)
      const { emailAddress, historyId } = messageData
      const supabase = createServiceClient()
      const { data: emailConfig, error: configError } = await supabase
        .from('email_configurations')
        .select('*')
        .eq('google_email', emailAddress)
        .eq('sync_enabled', true)
        .maybeSingle()

      if (configError || !emailConfig) {
        ctx.logSuccess(200, {
          reason: 'email_config_not_found',
          emailAddress,
        })
        return acknowledge(ctx.responseHeaders)
      }

      const gmailConfig = toGmailConfig(emailConfig as EmailConfigRow)
      if (!gmailConfig) {
        ctx.logSuccess(200, {
          reason: 'incomplete_email_config',
          emailAddress,
        })
        return acknowledge(ctx.responseHeaders)
      }

      if (shouldSkipHistorySync(historyId, gmailConfig.history_id)) {
        ctx.logSuccess(200, {
          reason: 'history_already_processed',
          emailAddress,
          historyId,
          currentHistoryId: gmailConfig.history_id,
        })
        return acknowledge(ctx.responseHeaders)
      }

      const syncResult = await syncInbox(gmailConfig, { historyIdHint: historyId })

      ctx.logSuccess(200, {
        emailAddress,
        historyId,
        newMessages: syncResult.newMessages,
        updatedThreads: syncResult.updatedThreads,
      })

      return acknowledge(ctx.responseHeaders)
    } catch (decodeError) {
      ctx.logSuccess(200, {
        reason: 'invalid_message_payload',
        error: decodeError instanceof Error ? decodeError.message : String(decodeError),
      })
      return acknowledge(ctx.responseHeaders)
    }
  } catch (error) {
    ctx.logError(200, error, { operation: 'gmail_webhook_acknowledge' })
    return acknowledge(ctx.responseHeaders)
  }
}
