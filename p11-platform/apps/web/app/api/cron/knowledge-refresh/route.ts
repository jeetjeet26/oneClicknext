import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  badRequest,
  forbidden,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { finishCronJobRun, startCronJobRun } from '@/utils/services/cron-job-runs'
import { createRequestContext } from '@/utils/services/request-context'

/**
 * Knowledge Refresh CRON Job
 * Phase 4: Automated Knowledge Refresh
 * 
 * This endpoint re-scrapes community websites and updates the knowledge base.
 * Should be called by Vercel CRON or similar scheduler (weekly recommended).
 * 
 * Vercel CRON config (vercel.json):
 * {
 *   "crons": [{
 *     "path": "/api/cron/knowledge-refresh",
 *     "schedule": "0 3 * * 0"  // Every Sunday at 3 AM
 *   }]
 * }
 */

const MAX_PROPERTIES_PER_RUN = 10 // Limit to avoid timeout
const DAYS_STALE_THRESHOLD = 7 // Consider knowledge stale after 7 days

function getIngestUrls(source: { source_url?: string | null; extracted_data?: unknown }): string[] {
  const extractedData =
    source.extracted_data && typeof source.extracted_data === 'object' && !Array.isArray(source.extracted_data)
      ? (source.extracted_data as Record<string, unknown>)
      : {}

  const urlsFromExtractedData = Array.isArray(extractedData.ingested_urls)
    ? extractedData.ingested_urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    : []

  const fallbackUrl = typeof source.source_url === 'string' && source.source_url.trim().length > 0
    ? [source.source_url]
    : []

  return Array.from(new Set([...urlsFromExtractedData, ...fallbackUrl]))
}

export async function GET(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/knowledge-refresh')
  ctx.logStart()

  if (
    process.env.CRON_SECRET &&
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    ctx.logSuccess(401, { reason: 'invalid_cron_auth' })
    return unauthorized(ctx.responseHeaders)
  }

  const run = await startCronJobRun({
    jobName: 'knowledge-refresh',
    requestId: request.headers.get('x-request-id'),
  })

  try {
    const internalApiKey = process.env.INTERNAL_API_KEY
    if (!internalApiKey) {
      ctx.logError(500, new Error('INTERNAL_API_KEY missing'), { operation: 'validate_env' })
      await finishCronJobRun(run, {
        status: 'failed',
        error: 'INTERNAL_API_KEY is required for knowledge refresh',
        summary: { operation: 'validate_env' },
      })
      return NextResponse.json(
        { error: 'INTERNAL_API_KEY is required for knowledge refresh' },
        { status: 500, headers: ctx.responseHeaders }
      )
    }

    const adminClient = createAdminClient()

    // Find properties with stale website knowledge
    const staleThreshold = new Date()
    staleThreshold.setDate(staleThreshold.getDate() - DAYS_STALE_THRESHOLD)

    // Get knowledge sources that are website type and haven't been synced recently
    const { data: staleSources, error: sourceError } = await adminClient
      .from('knowledge_sources')
      .select(`
        id,
        property_id,
        source_url,
        extracted_data,
        last_synced_at,
        properties!inner (
          id,
          name
        )
      `)
      .eq('source_type', 'website')
      .or(`last_synced_at.is.null,last_synced_at.lt.${staleThreshold.toISOString()}`)
      .limit(MAX_PROPERTIES_PER_RUN)

    if (sourceError) {
      ctx.logError(500, sourceError, { operation: 'fetch_stale_sources' })
      await finishCronJobRun(run, {
        status: 'failed',
        error: 'Failed to fetch stale sources',
        summary: { operation: 'fetch_stale_sources' },
      })
      return serverError(sourceError, ctx.responseHeaders)
    }

    if (!staleSources || staleSources.length === 0) {
      await finishCronJobRun(run, {
        status: 'success',
        summary: { processed: 0, successful: 0, failed: 0 },
      })
      ctx.logSuccess(200, { processed: 0, successful: 0, failed: 0 })
      return NextResponse.json(
        {
          success: true,
          message: 'No stale knowledge sources to refresh',
          processed: 0,
        },
        { headers: ctx.responseHeaders }
      )
    }

    const results: Array<{
      propertyId: string
      propertyName: string
      success: boolean
      error?: string
      changes?: string[]
    }> = []

    // Process each stale source
    for (const source of staleSources) {
      try {
        const refreshUrls = getIngestUrls(source)
        if (refreshUrls.length === 0) {
          const props = Array.isArray(source.properties) ? source.properties[0] : source.properties
          results.push({
            propertyId: source.property_id ?? 'unknown',
            propertyName: props?.name ?? 'Unknown',
            success: false,
            error: 'No source URL configured',
          })
          continue
        }

        // Call the website scrape endpoint
        const scrapeResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/onboarding/scrape-website`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${internalApiKey}`,
            ...(request.headers.get('cookie')
              ? { cookie: request.headers.get('cookie') as string }
              : {}),
          },
          body: JSON.stringify({
            propertyId: source.property_id,
            urls: refreshUrls,
            isRefresh: true, // Flag to indicate this is a refresh, not initial scrape
          }),
        })

        if (!scrapeResponse.ok) {
          const errorData = await scrapeResponse.json()
          const props = Array.isArray(source.properties) ? source.properties[0] : source.properties
          results.push({
            propertyId: source.property_id ?? 'unknown',
            propertyName: props?.name ?? 'Unknown',
            success: false,
            error: errorData.error || 'Scrape failed',
          })
          continue
        }

        const scrapeResult = await scrapeResponse.json()

        // Update the knowledge source record
        await adminClient
          .from('knowledge_sources')
          .update({
            last_synced_at: new Date().toISOString(),
            status: 'completed',
            documents_created: scrapeResult.documentsCreated || 0,
            processing_notes: `Refreshed ${refreshUrls.length} URL(s) at ${new Date().toISOString()}`,
          })
          .eq('id', source.id)

        const props = Array.isArray(source.properties) ? source.properties[0] : source.properties
        results.push({
          propertyId: source.property_id ?? 'unknown',
          propertyName: props?.name ?? 'Unknown',
          success: true,
          changes: scrapeResult.changes || [],
        })

        // If there were significant changes, we could notify the user
        // This would be a good place to add notification logic
        if (scrapeResult.changes && scrapeResult.changes.length > 0) {
          // TODO: Send notification about changes
          ctx.logSuccess(200, {
            operation: 'knowledge_refresh_changes_detected',
            propertyId: source.property_id ?? 'unknown',
            changes: scrapeResult.changes.length,
          })
        }

      } catch (error) {
        ctx.logError(500, error, {
          operation: 'knowledge_refresh_property',
          propertyId: source.property_id ?? 'unknown',
        })
        const props = Array.isArray(source.properties) ? source.properties[0] : source.properties
        results.push({
          propertyId: source.property_id ?? 'unknown',
          propertyName: props?.name ?? 'Unknown',
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    await finishCronJobRun(run, {
      status: 'success',
      summary: {
        processed: results.length,
        successful,
        failed,
      },
    })

    ctx.logSuccess(200, { processed: results.length, successful, failed })
    return NextResponse.json(
      {
        success: true,
        processed: results.length,
        successful,
        failed,
        results,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'run_knowledge_refresh' })
    await finishCronJobRun(run, {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Server error',
      summary: { operation: 'run_knowledge_refresh' },
    })
    return serverError(error, ctx.responseHeaders)
  }
}

// POST endpoint for manual trigger
export async function POST(request: NextRequest) {
  const ctx = createRequestContext(request, '/api/cron/knowledge-refresh')
  ctx.logStart()
  try {
    const { propertyId } = await request.json()

    if (!propertyId) {
      // If no propertyId, run the full CRON job
      return GET(request)
    }

    const supabaseAuth = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      ctx.logSuccess(403, { reason: 'forbidden_property_access', propertyId, userId: user.id })
      return forbidden(ctx.responseHeaders)
    }

    // Otherwise, refresh just one property
    const adminClient = createAdminClient()

    const { data: source, error } = await adminClient
      .from('knowledge_sources')
      .select('*')
      .eq('property_id', propertyId)
      .eq('source_type', 'website')
      .single()

    if (error || !source) {
      ctx.logSuccess(404, { reason: 'website_source_not_found', propertyId })
      return NextResponse.json(
        { error: 'No website knowledge source found for this property' },
        { status: 404, headers: ctx.responseHeaders }
      )
    }

    if (!source.source_url) {
      const refreshUrls = getIngestUrls(source)
      if (refreshUrls.length === 0) {
        ctx.logSuccess(400, { reason: 'missing_source_url', propertyId })
        return badRequest('No website URL configured for this property', ctx.responseHeaders)
      }
    }

    const refreshUrls = getIngestUrls(source)

    // Trigger scrape
    const scrapeResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/onboarding/scrape-website`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('cookie')
          ? { cookie: request.headers.get('cookie') as string }
          : {}),
      },
      body: JSON.stringify({
        propertyId,
        urls: refreshUrls,
        isRefresh: true,
      }),
    })

    const result = await scrapeResponse.json()

    if (!scrapeResponse.ok) {
      ctx.logSuccess(scrapeResponse.status, {
        reason: 'scrape_refresh_failed',
        propertyId,
      })
      return NextResponse.json(
        { error: result.error || 'Refresh failed' },
        { status: scrapeResponse.status, headers: ctx.responseHeaders }
      )
    }

    // Update source record
    await adminClient
      .from('knowledge_sources')
      .update({
        last_synced_at: new Date().toISOString(),
        status: 'completed',
      })
      .eq('id', source.id)

    ctx.logSuccess(200, { propertyId, operation: 'manual_refresh' })
    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      { headers: ctx.responseHeaders }
    )

  } catch (error) {
    ctx.logError(500, error, { operation: 'manual_knowledge_refresh' })
    return serverError(error, ctx.responseHeaders)
  }
}

