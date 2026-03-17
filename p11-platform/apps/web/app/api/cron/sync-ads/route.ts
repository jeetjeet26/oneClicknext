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
} from '@/utils/services/api-helpers'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { syncGoogleAdsConnection } from '@/app/api/integrations/google-ads/sync/route'
import { syncMetaAdsConnection } from '@/app/api/integrations/meta-ads/sync/route'
import { createRequestContext } from '@/utils/services/request-context'

type SyncAdsResult = { synced: number; error?: string; retryable?: boolean }

async function runConnectionSync(
  fn: () => Promise<SyncAdsResult>,
  attempts = 2
): Promise<SyncAdsResult> {
  let result = await fn()

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (!result.error || !result.retryable) {
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

  if (process.env.CRON_SECRET && req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    ctx.logSuccess(401, { reason: 'invalid_cron_auth' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'sync-ads',
    requestId: req.headers.get('x-request-id'),
  })

  const supabase = createServiceClient()

  try {
    // Fetch all active ad connections
    const { data: connections, error } = await supabase
      .from('ad_account_connections')
      .select('id, property_id, platform, account_id')
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

    const results: Array<{ platform: string; accountId: string; synced: number; error?: string; retryable?: boolean }> = []

    for (const conn of connections) {
      let result: SyncAdsResult

      switch (conn.platform) {
        case 'google_ads':
          result = await runConnectionSync(
            () => syncGoogleAdsConnection(conn.id, conn.account_id, conn.property_id),
            2
          )
          break
        case 'meta_ads':
          result = await runConnectionSync(
            () => syncMetaAdsConnection(conn.id, conn.account_id, conn.property_id),
            2
          )
          break
        default:
          result = { synced: 0, error: `Unsupported platform: ${conn.platform}`, retryable: false }
      }

      results.push({
        platform: conn.platform,
        accountId: conn.account_id,
        synced: result.synced,
        error: result.error,
        retryable: result.retryable,
      })
    }

    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0)
    const failures = results.filter(r => r.error)
    const retryableFailures = failures.filter(r => r.retryable)
    const permanentFailures = failures.filter(r => !r.retryable)

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        totalConnections: connections.length,
        totalSynced,
        failures: failures.length,
        retryableFailures: retryableFailures.length,
        permanentFailures: permanentFailures.length,
      },
    })

    ctx.logSuccess(200, {
      totalConnections: connections.length,
      totalSynced,
      failures: failures.length,
      retryableFailures: retryableFailures.length,
      permanentFailures: permanentFailures.length,
    })
    return NextResponse.json(
      {
        success: true,
        totalConnections: connections.length,
        totalSynced,
        failures: failures.length,
        retryableFailures: retryableFailures.length,
        permanentFailures: permanentFailures.length,
        results,
      },
      { headers: ctx.responseHeaders }
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
