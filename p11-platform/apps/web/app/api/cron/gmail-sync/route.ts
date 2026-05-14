import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  type GmailConfig,
  syncInbox,
  setupWatch,
  refreshAccessTokenIfNeeded,
} from '@/utils/services/gmail-service'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'
import { serverError, unauthorized, validateCronAuth } from '@/utils/services/api-helpers'

// Vercel CRON - runs every 5 minutes
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/gmail-sync", "schedule": "*/5 * * * *" }] }

interface SyncLog {
  configId: string
  propertyId: string
  googleEmail: string
  status: 'success' | 'failed' | 'skipped'
  newMessages?: number
  updatedThreads?: number
  watchRenewed?: boolean
  tokenHealthChecked?: boolean
  error?: string
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
  last_health_check_at: string | null
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

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/gmail-sync')
  ctx.logStart()

  const authError = validateCronAuth(request)
  if (authError) {
    ctx.logSuccess(401, { reason: 'invalid_cron_secret' })
    return unauthorized(ctx.responseHeaders) // preserve x-request-id etc.
  }

  const run = await startCronJobRun({
    jobName: 'gmail-sync',
    requestId: ctx.requestId,
  })

  try {
    const supabase = createServiceClient()
    const startTime = Date.now()
    const syncLogs: SyncLog[] = []

    // Fetch all email configurations where sync is enabled and token is healthy
    const { data: configs, error: fetchError } = await supabase
      .from('email_configurations')
      .select('*')
      .eq('sync_enabled', true)
      .eq('token_status', 'healthy')
      .order('last_sync_at', { ascending: true, nullsFirst: true })

    if (fetchError) {
      ctx.logError(500, fetchError, { operation: 'fetch_gmail_configs' })
      await finishCronJobRun(run, {
        status: 'failed',
        error: fetchError.message,
        summary: { operation: 'fetch_gmail_configs' },
      })
      return serverError(fetchError, ctx.responseHeaders)
    }

    if (!configs || configs.length === 0) {
      ctx.logSuccess(200, { processed: 0, synced: 0, failed: 0 })
      await finishCronJobRun(run, {
        status: 'success',
        summary: { processed: 0, synced: 0, failed: 0 },
      })
      return NextResponse.json(
        {
          success: true,
          message: 'No active Gmail configurations to sync',
          processed: 0,
          synced: 0,
          failed: 0,
          duration: Date.now() - startTime,
        },
        { headers: ctx.responseHeaders }
      )
    }

    console.log(`[Gmail Sync CRON] Starting sync for ${configs.length} configurations`)

    // Process each configuration
    for (const config of configs as EmailConfigRow[]) {
      const gmailConfig = toGmailConfig(config)
      const log: SyncLog = {
        configId: config.id,
        propertyId: config.property_id || 'unknown',
        googleEmail: config.google_email || config.account_email || 'unknown',
        status: 'success',
      }

      try {
        if (!gmailConfig) {
          log.status = 'skipped'
          log.error = 'Incomplete Gmail configuration'
          syncLogs.push(log)
          continue
        }

        // ====================================================================
        // 1. Token Health Check (if needed)
        // ====================================================================
        const lastHealthCheck = config.last_health_check_at
          ? new Date(config.last_health_check_at)
          : null
        const now = new Date()
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

        if (!lastHealthCheck || lastHealthCheck < oneHourAgo) {
          try {
            await refreshAccessTokenIfNeeded(gmailConfig)
            log.tokenHealthChecked = true

            // Update last health check timestamp
            await supabase
              .from('email_configurations')
              .update({
                last_health_check_at: new Date().toISOString(),
                health_check_error: null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', config.id)

            console.log(
              `[Gmail Sync CRON] Token health check passed for ${config.google_email || config.account_email}`
            )
          } catch (tokenError) {
            console.error(
              `[Gmail Sync CRON] Token health check failed for ${config.google_email || config.account_email}:`,
              tokenError
            )

            const tokenErrorMessage =
              tokenError instanceof Error ? tokenError.message : 'Token health check failed'
            const isRevoked =
              tokenErrorMessage.includes('revoked') ||
              tokenErrorMessage.includes('reconnect')

            await supabase
              .from('email_configurations')
              .update({
                ...(isRevoked ? { token_status: 'revoked' } : {}),
                health_check_error: tokenErrorMessage,
                last_health_check_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', config.id)

            log.status = 'failed'
            log.error = tokenErrorMessage
            syncLogs.push(log)
            continue
          }
        }

        // ====================================================================
        // 2. Check and Renew Watch Subscriptions
        // ====================================================================
        if (config.watch_expiration) {
          const watchExpiration = new Date(config.watch_expiration)
          const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

          if (watchExpiration < oneDayFromNow) {
            try {
              await setupWatch(gmailConfig)
              log.watchRenewed = true
              console.log(
                `[Gmail Sync CRON] Watch subscription renewed for ${config.google_email || config.account_email}`
              )
            } catch (watchError) {
              console.warn(
                `[Gmail Sync CRON] Failed to renew watch for ${config.google_email || config.account_email}:`,
                watchError
              )
              // Don't fail the sync if watch renewal fails, just log it
            }
          }
        } else {
          // No watch set up yet, establish one
          try {
            await setupWatch(gmailConfig)
            log.watchRenewed = true
            console.log(
              `[Gmail Sync CRON] Watch subscription established for ${config.google_email || config.account_email}`
            )
          } catch (watchError) {
            console.warn(
              `[Gmail Sync CRON] Failed to establish watch for ${config.google_email || config.account_email}:`,
              watchError
            )
            // Don't fail the sync if watch setup fails
          }
        }

        // ====================================================================
        // 3. Sync Inbox
        // ====================================================================
        try {
          const syncResult = await syncInbox(gmailConfig)

          log.newMessages = syncResult.newMessages
          log.updatedThreads = syncResult.updatedThreads
          log.status = 'success'

          console.log(
            `[Gmail Sync CRON] Synced inbox for ${config.google_email || config.account_email}: ` +
            `${syncResult.newMessages} new messages, ${syncResult.updatedThreads} updated threads`
          )
        } catch (syncError) {
          console.error(
            `[Gmail Sync CRON] Inbox sync failed for ${config.google_email || config.account_email}:`,
            syncError
          )

          // Check if it's a token error
          if (
            syncError instanceof Error &&
            (syncError.message.includes('401') || syncError.message.includes('revoked'))
          ) {
            await supabase
              .from('email_configurations')
              .update({
                token_status: 'revoked',
                health_check_error: syncError.message,
                updated_at: new Date().toISOString(),
              })
              .eq('id', config.id)

            log.status = 'failed'
            log.error = 'Token revoked or expired'
          } else {
            log.status = 'failed'
            log.error = syncError instanceof Error ? syncError.message : 'Unknown sync error'

            await supabase
              .from('email_configurations')
              .update({
                health_check_error: log.error,
                updated_at: new Date().toISOString(),
              })
              .eq('id', config.id)
          }
        }
      } catch (error) {
        console.error(
          `[Gmail Sync CRON] Unexpected error processing ${config.google_email || config.account_email}:`,
          error
        )

        log.status = 'failed'
        log.error = error instanceof Error ? error.message : 'Unknown error'
      }

      syncLogs.push(log)
    }

    // ========================================================================
    // Summary and Logging
    // ========================================================================
    const successful = syncLogs.filter(l => l.status === 'success').length
    const failed = syncLogs.filter(l => l.status === 'failed').length
    const totalNewMessages = syncLogs.reduce((sum, l) => sum + (l.newMessages || 0), 0)
    const totalUpdatedThreads = syncLogs.reduce((sum, l) => sum + (l.updatedThreads || 0), 0)
    const watchRenewed = syncLogs.filter(l => l.watchRenewed).length
    const healthChecked = syncLogs.filter(l => l.tokenHealthChecked).length

    const duration = Date.now() - startTime

    console.log(
      `[Gmail Sync CRON] Complete: ${successful} successful, ${failed} failed, ` +
      `${totalNewMessages} messages synced, ${watchRenewed} watches renewed, ` +
      `${healthChecked} token health checks performed (${duration}ms)`
    )

    ctx.logSuccess(200, {
      processed: syncLogs.length,
      synced: successful,
      failed,
      totalNewMessages,
      totalUpdatedThreads,
    })

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        processed: syncLogs.length,
        synced: successful,
        failed,
        totalNewMessages,
        totalUpdatedThreads,
        watchRenewed,
        tokenHealthChecks: healthChecked,
      },
    })

    return NextResponse.json(
      {
        success: true,
        processed: syncLogs.length,
        synced: successful,
        failed,
        totalNewMessages,
        totalUpdatedThreads,
        watchRenewed,
        tokenHealthChecks: healthChecked,
        duration,
        results: syncLogs,
      },
      { headers: ctx.responseHeaders }
    )
  } catch (error) {
    ctx.logError(500, error, { operation: 'run_gmail_sync_cron' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: { operation: 'run_gmail_sync_cron' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}
