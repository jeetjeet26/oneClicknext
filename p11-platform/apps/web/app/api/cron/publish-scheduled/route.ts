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

const SCHEDULED_PUBLISH_LEASE_MS = 10 * 60 * 1000

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3
): Promise<Response> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, init)
      if (res.ok || res.status < 500) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise(resolve => setTimeout(resolve, 300 * (i + 1)))
  }
  throw lastError instanceof Error ? lastError : new Error('Fetch failed')
}

async function claimScheduledDraft(
  draft: { id: string },
  nowIso: string,
  leaseCutoffIso: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('content_drafts')
    .update({
      updated_at: nowIso,
    })
    .eq('id', draft.id)
    .eq('status', 'scheduled')
    .lte('scheduled_for', nowIso)
    .or(`updated_at.is.null,updated_at.lt.${leaseCutoffIso}`)
    .select('id')
    .maybeSingle()

  if (error) {
    throw error
  }

  return Boolean(data?.id)
}

// Vercel CRON - runs every 15 minutes
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/publish-scheduled", "schedule": "*/15 * * * *" }] }

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/publish-scheduled')
  ctx.logStart()

  if (
    process.env.CRON_SECRET &&
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    ctx.logSuccess(401, { reason: 'invalid_cron_auth' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'publish-scheduled',
    requestId: request.headers.get('x-request-id'),
  })

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    ctx.logError(500, new Error('CRON_SECRET missing'), { operation: 'validate_env' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: 'CRON_SECRET is required for publish-scheduled cron execution',
      summary: { operation: 'validate_env' },
    })
    return NextResponse.json(
      { error: 'CRON_SECRET is required for publish-scheduled cron execution' },
      { status: 500, headers: ctx.responseHeaders }
    )
  }

  try {
    const now = new Date().toISOString()
    const leaseCutoffIso = new Date(Date.now() - SCHEDULED_PUBLISH_LEASE_MS).toISOString()
    
    // Get all scheduled posts that are due
    const { data: scheduledPosts, error: fetchError } = await supabase
      .from('content_drafts')
      .select(`
        *,
        social_connections:properties!content_drafts_property_id_fkey (
          id,
          name,
          social_connections (
            id,
            platform,
            is_active,
            page_access_token,
            account_id,
            page_id
          )
        )
      `)
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .or(`updated_at.is.null,updated_at.lt.${leaseCutoffIso}`)
      .order('scheduled_for', { ascending: true })
      .limit(50)

    if (fetchError) {
      ctx.logError(500, fetchError, { operation: 'fetch_scheduled_posts' })
      await finishCronJobRun(run, {
        status: 'failed',
        error: fetchError.message,
        summary: { operation: 'fetch_scheduled_posts' },
      })
      return serverError(fetchError, ctx.responseHeaders)
    }

    if (!scheduledPosts || scheduledPosts.length === 0) {
      await finishCronJobRun(run, {
        status: 'success',
        summary: { processed: 0, published: 0, failed: 0 },
      })
      ctx.logSuccess(200, { processed: 0, published: 0, failed: 0, retrying: 0 })
      return NextResponse.json(
        {
          success: true,
          message: 'No posts to publish',
          processed: 0,
        },
        { headers: ctx.responseHeaders }
      )
    }

    const results: Array<{
      draftId: string
      status: 'published' | 'failed' | 'retrying' | 'skipped'
      error?: string
    }> = []

    for (const draft of scheduledPosts) {
      try {
        const claimNowIso = new Date().toISOString()
        const claimed = await claimScheduledDraft(draft, claimNowIso, leaseCutoffIso)
        if (!claimed) {
          results.push({
            draftId: draft.id,
            status: 'skipped',
            error: 'Draft already claimed by another publish worker',
          })
          continue
        }

        // Get active social connections for the property
        const { data: connections, error: connError } = await supabase
          .from('social_connections')
          .select('*')
          .eq('property_id', draft.property_id)
          .eq('is_active', true)
          .eq('platform', draft.platform)

        if (connError || !connections || connections.length === 0) {
          // No active connection for this platform - mark as failed
          await supabase
            .from('content_drafts')
            .update({
              status: 'failed',
              rejection_reason: 'No active social connection for platform',
              updated_at: new Date().toISOString()
            })
            .eq('id', draft.id)

          results.push({
            draftId: draft.id,
            status: 'failed',
            error: 'No active social connection'
          })
          continue
        }

        // Publish to each connection
        const publishRes = await fetchWithRetry(`${getAppBaseUrl()}/api/forgestudio/social/publish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({
            draftId: draft.id,
            connectionIds: connections.map(c => c.id)
          })
        }, 3)

        const publishBody = await publishRes.json().catch(() => ({}))

        if (publishRes.ok && publishBody?.success) {
          results.push({
            draftId: draft.id,
            status: 'published'
          })
        } else {
          const permanentFailureCount = typeof publishBody?.permanentFailureCount === 'number'
            ? publishBody.permanentFailureCount
            : 0
          const retryableFailureCount = typeof publishBody?.retryableFailureCount === 'number'
            ? publishBody.retryableFailureCount
            : (publishRes.status >= 500 ? 1 : 0)
          const errorMessage =
            publishBody?.error ||
            publishBody?.results?.find?.((item: { success?: boolean; error?: string }) => item.success === false)?.error ||
            'Publishing failed'

          if (permanentFailureCount > 0 || (!publishRes.ok && publishRes.status < 500)) {
            await supabase
              .from('content_drafts')
              .update({
                status: 'failed',
                rejection_reason: errorMessage,
                updated_at: new Date().toISOString()
              })
              .eq('id', draft.id)

            results.push({
              draftId: draft.id,
              status: 'failed',
              error: errorMessage
            })
          } else if (retryableFailureCount > 0) {
            await supabase
              .from('content_drafts')
              .update({
                rejection_reason: errorMessage,
                updated_at: new Date().toISOString()
              })
              .eq('id', draft.id)

            results.push({
              draftId: draft.id,
              status: 'retrying',
              error: errorMessage
            })
          } else {
            await supabase
              .from('content_drafts')
              .update({
                status: 'failed',
                rejection_reason: errorMessage,
                updated_at: new Date().toISOString()
              })
              .eq('id', draft.id)

            results.push({
              draftId: draft.id,
              status: 'failed',
              error: errorMessage
            })
          }
        }
      } catch (publishError) {
        ctx.logError(500, publishError, {
          operation: 'publish_scheduled_draft',
          draftId: draft.id,
          propertyId: draft.property_id,
          platform: draft.platform,
        })
        
        await supabase
          .from('content_drafts')
          .update({
            status: 'failed',
            rejection_reason: publishError instanceof Error ? publishError.message : 'Unknown error',
            updated_at: new Date().toISOString()
          })
          .eq('id', draft.id)

        results.push({
          draftId: draft.id,
          status: 'failed',
          error: publishError instanceof Error ? publishError.message : 'Unknown error'
        })
      }
    }

    const published = results.filter(r => r.status === 'published').length
    const failed = results.filter(r => r.status === 'failed').length
    const retrying = results.filter(r => r.status === 'retrying').length
    const skipped = results.filter(r => r.status === 'skipped').length

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        processed: results.length,
        published,
        failed,
        retrying,
        skipped,
      },
    })

    ctx.logSuccess(200, { processed: results.length, published, failed, retrying, skipped })
    return NextResponse.json(
      {
        success: true,
        processed: results.length,
        published,
        failed,
        retrying,
        skipped,
        results,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'run_publish_scheduled' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'CRON job failed',
      summary: { operation: 'run_publish_scheduled' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

