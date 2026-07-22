import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { hasValidCronAuth } from '@/utils/services/api-helpers'
import { runSharedExecutorJob } from '@/utils/services/shared-executor'
import {
  ReviewIngestionError,
  fetchGoogleReviewsViaApi,
  fetchGoogleReviewsViaScraper,
  fetchYelpReviews,
  fetchYelpReviewsFromUrl,
  persistObservedReviews,
  type ProviderFetchResult,
} from '@/utils/reviewflow/ingestion'
import { ensureCaseForReview } from '@/utils/reviewflow/cases'
import { runBatchAnalysis } from '@/utils/reviewflow/analysis-pipeline'

// Cap on synchronous classification per sync run; the remainder stays
// 'pending' and is drained by analyze-batch. Keeps request time bounded while
// analysis remains awaited (never fire-and-forget).
const SYNC_ANALYSIS_CAP = Number(process.env.REVIEWFLOW_SYNC_ANALYSIS_CAP || 10)

type SyncResult = {
  success: boolean
  inserted: number
  updated: number
  unchanged: number
  imported: number
  analyzed: number
  manualReviewRequired: number
  pendingAnalysis: number
  syncMethod: string
  completeness: string
  note: string | null
  message?: string
}

async function fetchForConnection(
  platform: string,
  connection: {
    place_id: string | null
    yelp_business_id: string | null
    yelp_business_url: string | null
    connection_type: string | null
  },
  method: string | undefined,
  requestId: string | null
): Promise<ProviderFetchResult> {
  const connectionType = method || connection.connection_type || 'api'

  if (platform === 'google') {
    if (!connection.place_id) {
      throw new ReviewIngestionError('Google Place ID not configured', { retryable: false })
    }
    if (connectionType === 'scraper' || connectionType === 'both') {
      try {
        return await fetchGoogleReviewsViaScraper(connection.place_id, requestId)
      } catch (scraperError) {
        if (connectionType === 'both') {
          console.warn('Google scraper failed, falling back to API:', scraperError)
          return await fetchGoogleReviewsViaApi(connection.place_id, requestId)
        }
        throw scraperError
      }
    }
    return await fetchGoogleReviewsViaApi(connection.place_id, requestId)
  }

  if (platform === 'yelp') {
    if (connection.yelp_business_id) {
      return await fetchYelpReviews(connection.yelp_business_id, requestId)
    }
    if (connection.yelp_business_url) {
      return await fetchYelpReviewsFromUrl(connection.yelp_business_url, requestId)
    }
    throw new ReviewIngestionError(
      'Yelp Business ID or URL not configured. Please provide either yelp_business_id or yelp_business_url.',
      { retryable: false }
    )
  }

  throw new ReviewIngestionError(`Unsupported platform: ${platform}`, { retryable: false })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { propertyId, platform, connectionId, method } = body
    const requestId = request.headers.get('x-request-id')

    if (!propertyId || !platform) {
      return NextResponse.json(
        { error: 'propertyId and platform are required' },
        { status: 400 }
      )
    }

    const isCronRequest = hasValidCronAuth(request)

    if (!isCronRequest) {
      const supabaseAuth = await createClient()
      const {
        data: { user },
        error: authError,
      } = await supabaseAuth.auth.getUser()

      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const supabase = createServiceClient()

    // Get the connection details
    let query = supabase
      .from('review_platform_connections')
      .select('*')
      .eq('property_id', propertyId)
      .eq('platform', platform)
      .eq('is_active', true)

    if (connectionId) {
      query = query.eq('id', connectionId)
    }

    const { data: connection, error: connError } = await query.single()

    if (connError || !connection) {
      return NextResponse.json(
        { error: 'No active connection found for this platform' },
        { status: 404 }
      )
    }

    const { data: property } = await supabase
      .from('properties')
      .select('org_id')
      .eq('id', propertyId)
      .single()

    if (!property?.org_id) {
      return NextResponse.json({ error: 'Property is missing org context' }, { status: 409 })
    }

    const executeSync = async (): Promise<SyncResult> => {
      let fetched: ProviderFetchResult
      try {
        fetched = await fetchForConnection(platform, connection, method, requestId)
      } catch (fetchError) {
        // Record connection health before failing the shared job.
        await supabase
          .from('review_platform_connections')
          .update({
            error_count: (connection.error_count || 0) + 1,
            last_error: fetchError instanceof Error ? fetchError.message : 'Unknown error',
            updated_at: new Date().toISOString(),
          })
          .eq('id', connection.id)
        throw fetchError
      }

      const nowIso = new Date().toISOString()

      if (fetched.reviews.length === 0) {
        await supabase
          .from('review_platform_connections')
          .update({
            last_sync_at: nowIso,
            error_count: 0,
            last_error: null,
            updated_at: nowIso,
          })
          .eq('id', connection.id)

        return {
          success: true,
          inserted: 0,
          updated: 0,
          unchanged: 0,
          imported: 0,
          analyzed: 0,
          manualReviewRequired: 0,
          pendingAnalysis: 0,
          syncMethod: fetched.retrievalMethod,
          completeness: fetched.completeness,
          note: fetched.note,
          message: 'No reviews found',
        }
      }

      const persisted = await persistObservedReviews(supabase, {
        propertyId,
        platform,
        reviews: fetched.reviews,
        retrievalMethod: fetched.retrievalMethod,
        completeness: fetched.completeness,
      })

      // Connection stats count only genuinely new reviews.
      await supabase
        .from('review_platform_connections')
        .update({
          last_sync_at: nowIso,
          error_count: 0,
          last_error: null,
          total_reviews_synced: (connection.total_reviews_synced || 0) + persisted.inserted,
          last_review_date: fetched.reviews[0]?.reviewDate || connection.last_review_date,
          updated_at: nowIso,
        })
        .eq('id', connection.id)

      // Every observed review gets a reputation case immediately.
      for (const review of persisted.insertedReviews) {
        await ensureCaseForReview(supabase, review)
      }

      // Awaited, bounded classification; remainder drains via analyze-batch.
      const toAnalyze = persisted.insertedReviews.slice(0, SYNC_ANALYSIS_CAP)
      const analysisSummary =
        toAnalyze.length > 0
          ? await runBatchAnalysis(supabase, toAnalyze)
          : { analyzed: 0, manualReviewRequired: 0, skipped: 0, results: [] }

      return {
        success: true,
        inserted: persisted.inserted,
        updated: persisted.updated,
        unchanged: persisted.unchanged,
        imported: persisted.inserted,
        analyzed: analysisSummary.analyzed,
        manualReviewRequired: analysisSummary.manualReviewRequired,
        pendingAnalysis: Math.max(persisted.inserted - toAnalyze.length, 0),
        syncMethod: fetched.retrievalMethod,
        completeness: fetched.completeness,
        note: fetched.note,
      }
    }

    const result = await runSharedExecutorJob({
      orgId: property.org_id,
      propertyId,
      domain: 'reviewflow.sync',
      subjectType: 'review_platform_connection',
      subjectId: connection.id,
      payload: {
        platform,
        connectionId: connection.id,
        method: method || connection.connection_type || 'api',
        requestId,
        trigger: isCronRequest ? 'cron' : 'operator',
      },
      execute: executeSync,
    })

    return NextResponse.json(result)

  } catch (error) {
    console.error('Sync error:', error)
    if (error instanceof ReviewIngestionError) {
      return NextResponse.json(
        {
          error: error.message,
          retryable: error.retryable,
          source: 'data_engine',
        },
        { status: error.retryable ? 502 : 422 }
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    )
  }
}
