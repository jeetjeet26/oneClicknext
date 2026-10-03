/**
 * Ad Performance Sync Cron
 * Processes all active ad connections (Google Ads + Meta Ads)
 * Called by Vercel cron every 6 hours
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  serverError,
  unauthorized,
  hasValidCronAuth,
} from '@/utils/services/api-helpers'
import { cronStatusFromOutcomes, finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { syncGoogleAdsConnection } from '@/app/api/integrations/google-ads/sync/route'
import { syncMetaAdsConnection } from '@/app/api/integrations/meta-ads/sync/route'
import { createRequestContext } from '@/utils/services/request-context'
import { runSharedExecutorJob } from '@/utils/services/shared-executor'

type SyncAdsResult = { synced: number; accepted?: boolean; jobId?: string; error?: string; retryable?: boolean }

// Provider adapters report failures as values. Throw inside the shared executor
// so its durable job/action records also record failure, then retain the result
// for the per-account summary and continue processing independent accounts.
class ConnectionSyncError extends Error {
  constructor(readonly result: SyncAdsResult) {
    super(result.error || 'Account sync failed')
    this.name = 'ConnectionSyncError'
  }
}

async function runConnectionSync(
  fn: () => Promise<SyncAdsResult>,
  attempts = 2
): Promise<SyncAdsResult> {
  let result = await fn()

  // A partial write needs reconciliation; do not replace its count with a retry's outcome.

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (!result.error || !result.retryable || result.synced > 0) {
      return result
    }

    await new Promise(resolve => setTimeout(resolve, 300 * attempt))
    result = await fn()
  }

  return result
}

export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/cron/sync-ads')
  ctx.logStart()

  if (!hasValidCronAuth(req)) {
    ctx.logSuccess(401, { reason: 'invalid_cron_auth' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'sync-ads',
    requestId: req.headers.get('x-request-id'),
  })

  if (!run) {
    return NextResponse.json(
      { error: 'Sync could not be recorded. No accounts were processed.' },
      { status: 503, headers: ctx.responseHeaders }
    )
  }

  try {
    const supabase = createServiceClient()
    // Fetch all active ad connections
    const { data: connections, error, count } = await supabase
      .from('ad_account_connections')
      .select('id, property_id, org_id, platform, account_id', { count: 'exact' })
      .eq('is_active', true)

    if (error) {
      ctx.logError(500, error, { operation: 'fetch_connections' })
      await finishCronJobRun(run, {
        status: 'failed',
        error: 'Failed to fetch connections',
        summary: { operation: 'fetch_connections' },
      })
      return serverError(error, ctx.responseHeaders)
    }

    if (!connections || count !== connections.length) {
      await finishCronJobRun(run, { status: 'failed', error: 'The complete account inventory could not be confirmed.', summary: { operation: 'fetch_connections' } })
      return NextResponse.json({ error: 'The complete account inventory could not be confirmed. No accounts were queued.' }, { status: 503, headers: ctx.responseHeaders })
    }

    if (!connections || connections.length === 0) {
      await finishCronJobRun(run, {
        status: 'success',
        summary: { totalConnections: 0, totalSynced: 0, failures: 0 },
      })
      ctx.logSuccess(200, { totalConnections: 0, totalSynced: 0, failures: 0 })
      return NextResponse.json(
        { message: 'No connections to sync', synced: 0 },
        { headers: ctx.responseHeaders }
      )
    }

    const results: Array<SyncAdsResult & { platform: string; accountId: string }> = []

    for (const conn of connections) {
      if (!conn.property_id || !conn.org_id) {
        results.push({
          platform: conn.platform,
          accountId: conn.account_id,
          synced: 0,
          error: 'Ad connection is missing property or organization ownership',
          retryable: false,
        })
        continue
      }

      const propertyId = conn.property_id

      const executeConnectionSync = async (): Promise<SyncAdsResult> => {
        switch (conn.platform) {
          case 'google_ads':
            return runConnectionSync(
              () => syncGoogleAdsConnection(conn.id, conn.account_id, propertyId),
              2
            )
          case 'meta_ads':
            return runConnectionSync(
              () => syncMetaAdsConnection(conn.id, conn.account_id, propertyId),
              2
            )
          default:
            return { synced: 0, error: `Unsupported platform: ${conn.platform}`, retryable: false }
        }
      }

      let result: SyncAdsResult
      try {
        result = await runSharedExecutorJob({
          orgId: conn.org_id,
          propertyId,
          domain: 'cron.sync-ads',
          subjectType: 'ad_account_connection',
          subjectId: conn.id,
          dedupeKey: `${run.id}:${conn.id}`,
          payload: {
            platform: conn.platform,
            accountId: conn.account_id,
            triggerSource: 'cron',
          },
          action: {
            actionType: 'queue_ad_import',
            proposalDecisionStatus: 'approved',
            requestPayload: {
              platform: conn.platform,
              accountId: conn.account_id,
            },
            executionPayload: {
              mode: 'durable_import_dispatch',
              triggerSource: 'cron',
            },
            policyReason: 'scheduled_recurring_sync',
          },
          execute: async () => {
            const outcome = await executeConnectionSync()
            if (outcome.error) throw new ConnectionSyncError(outcome)
            return outcome
          },
        })
      } catch (error) {
        result = error instanceof ConnectionSyncError
          ? error.result
          : { synced: 0, error: 'Account sync could not complete. Check server logs.', retryable: false }
        ctx.logError(502, error, { operation: 'sync_ad_account', connectionId: conn.id })
      }

      results.push({
        platform: conn.platform,
        accountId: conn.account_id,
        synced: result.synced,
        accepted: result.accepted,
        jobId: result.jobId,
        error: result.error,
        retryable: result.retryable,
      })
    }

    const totalQueued = results.filter(result => result.accepted).length
    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0)
    const failures = results.filter(r => r.error)
    const retryableFailures = failures.filter(r => r.retryable)
    const permanentFailures = failures.filter(r => !r.retryable)

    const status = cronStatusFromOutcomes({
      succeeded: results.filter(result => !result.error || result.synced > 0).length,
      failed: failures.length,
    })
    const httpStatus = status === 'failed' ? 502 : 200

    await finishCronJobRun(run, {
      status,
      error: failures.length > 0 ? `${failures.length} account sync(s) reported errors` : null,
      summary: {
        totalConnections: connections.length,
        totalSynced,
        totalQueued,
        failures: failures.length,
        retryableFailures: retryableFailures.length,
        permanentFailures: permanentFailures.length,
      },
    })

    ctx.logSuccess(httpStatus, {
      status,
      totalConnections: connections.length,
      totalSynced,
      totalQueued,
      failures: failures.length,
      retryableFailures: retryableFailures.length,
      permanentFailures: permanentFailures.length,
    })
    return NextResponse.json(
      {
        success: status === 'success',
        status,
        message: 'Scheduled import dispatch finished. Saved import jobs track provider results.',
        totalConnections: connections.length,
        totalSynced,
        totalQueued,
        failures: failures.length,
        retryableFailures: retryableFailures.length,
        permanentFailures: permanentFailures.length,
        results,
      },
      { status: httpStatus, headers: ctx.responseHeaders }
    )
  } catch (err) {
    ctx.logError(500, err, { operation: 'run_sync_ads' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Internal server error',
      summary: { operation: 'run_sync_ads' },
    })
    return serverError(err, ctx.responseHeaders)
  }
}
