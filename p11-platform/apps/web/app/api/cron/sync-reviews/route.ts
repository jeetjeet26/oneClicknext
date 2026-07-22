import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'
import { getAppBaseUrl } from '@/utils/services/runtime-config'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SYNC_REVIEWS_CLAIM_WINDOW_MS = 60 * 60 * 1000

async function fetchWithRetry(url: string, options: RequestInit, maxAttempts = 2): Promise<Response> {
  let lastError: Error | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options)
      return res
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts) {
        const delay = 1000 * attempt
        console.warn(`[Review Sync] Retry ${attempt}/${maxAttempts} after ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

async function claimReviewConnection(connection: { id: string }, claimStartedAtIso: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('review_platform_connections')
    .update({
      last_sync_at: claimStartedAtIso,
      updated_at: claimStartedAtIso,
    })
    .eq('id', connection.id)
    .eq('is_active', true)
    .in('sync_frequency', ['hourly', 'realtime'])
    .or(`last_sync_at.is.null,last_sync_at.lt.${claimStartedAtIso}`)
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  return Boolean(data?.id)
}

// Vercel CRON - runs every hour
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/sync-reviews", "schedule": "0 * * * *" }] }

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/sync-reviews')
  ctx.logStart()

  if (
    process.env.CRON_SECRET &&
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    ctx.logSuccess(401, { reason: 'invalid_cron_auth' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'sync-reviews',
    requestId: request.headers.get('x-request-id'),
  })

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    ctx.logError(500, new Error('CRON_SECRET missing'), { operation: 'validate_env' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: 'CRON_SECRET is required for sync-reviews cron execution',
      summary: { operation: 'validate_env' },
    })
    return NextResponse.json(
      { error: 'CRON_SECRET is required for sync-reviews cron execution' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }

  try {
    // Get all active review platform connections that need syncing
    const oneHourAgo = new Date(Date.now() - SYNC_REVIEWS_CLAIM_WINDOW_MS).toISOString()
    
    const { data: connections, error: fetchError } = await supabase
      .from('review_platform_connections')
      .select(`
        *,
        properties (id, name, org_id)
      `)
      .eq('is_active', true)
      .in('sync_frequency', ['hourly', 'realtime'])
      .or(`last_sync_at.is.null,last_sync_at.lt.${oneHourAgo}`)
      .lt('error_count', 5) // Skip connections with too many errors
      .order('last_sync_at', { ascending: true, nullsFirst: true })
      .limit(20)

    if (fetchError) {
      ctx.logError(500, fetchError, { operation: 'fetch_review_connections' })
      await finishCronJobRun(run, {
        status: 'failed',
        error: fetchError.message,
        summary: { operation: 'fetch_review_connections' },
      })
      return serverError(fetchError, ctx.responseHeaders)
    }

    if (!connections || connections.length === 0) {
      await finishCronJobRun(run, {
        status: 'success',
        summary: { synced: 0, failed: 0, totalImported: 0 },
      })
      ctx.logSuccess(200, { synced: 0, failed: 0, totalImported: 0 })
      return NextResponse.json(
        {
          success: true,
          message: 'No connections to sync',
          synced: 0,
        },
        { headers: ctx.responseHeaders }
      )
    }

    const results: Array<{
      connectionId: string
      propertyId: string
      platform: string
      status: 'success' | 'failed' | 'skipped'
      imported?: number
      error?: string
    }> = []

    for (const connection of connections) {
      try {
        const claimStartedAtIso = new Date().toISOString()
        const claimed = await claimReviewConnection(connection, claimStartedAtIso)
        if (!claimed) {
          results.push({
            connectionId: connection.id,
            propertyId: connection.property_id,
            platform: connection.platform,
            status: 'skipped',
            error: 'Connection already claimed by another sync worker',
          })
          continue
        }

        const syncRes = await fetchWithRetry(`${getAppBaseUrl()}/api/reviewflow/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${cronSecret}`,
            'x-request-id': ctx.requestId,
          },
          body: JSON.stringify({
            propertyId: connection.property_id,
            platform: connection.platform,
            connectionId: connection.id
          })
        })

        const syncData = await syncRes.json()

        if (syncRes.ok) {
          results.push({
            connectionId: connection.id,
            propertyId: connection.property_id,
            platform: connection.platform,
            status: 'success',
            imported: syncData.imported || 0
          })
        } else {
          results.push({
            connectionId: connection.id,
            propertyId: connection.property_id,
            platform: connection.platform,
            status: 'failed',
            error: syncData.error
          })
        }
      } catch (syncError) {
        ctx.logError(500, syncError, {
          operation: 'sync_review_connection',
          connectionId: connection.id,
          platform: connection.platform,
          propertyId: connection.property_id,
        })
        results.push({
          connectionId: connection.id,
          propertyId: connection.property_id,
          platform: connection.platform,
          status: 'failed',
          error: syncError instanceof Error ? syncError.message : 'Unknown error'
        })
      }
    }

    const synced = results.filter(r => r.status === 'success').length
    const failed = results.filter(r => r.status === 'failed').length
    const skipped = results.filter(r => r.status === 'skipped').length
    const totalImported = results.reduce((sum, r) => sum + (r.imported || 0), 0)

    // Honest run status: child connection failures make the run 'partial',
    // and a run with only failures is 'failed'.
    const runStatus: 'success' | 'partial' | 'failed' =
      failed === 0 ? 'success' : synced > 0 ? 'partial' : 'failed'

    await finishCronJobRun(run, {
      status: runStatus,
      error:
        failed > 0
          ? `${failed} connection sync(s) failed: ${results
              .filter(r => r.status === 'failed')
              .map(r => `${r.platform}:${r.connectionId.slice(0, 8)} ${r.error || 'unknown'}`)
              .join('; ')
              .slice(0, 900)}`
          : null,
      summary: {
        synced,
        failed,
        skipped,
        totalImported,
      },
    })

    ctx.logSuccess(200, { synced, failed, skipped, totalImported, runStatus })
    return NextResponse.json(
      {
        success: failed === 0,
        status: runStatus,
        synced,
        failed,
        skipped,
        totalImported,
        results,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'run_sync_reviews' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'CRON job failed',
      summary: { operation: 'run_sync_reviews' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

