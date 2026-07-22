/**
 * ReviewFlow ingestion.
 *
 * Typed client for the Data Engine review endpoints plus replay-safe
 * persistence of observed reviews:
 * - Stable identity: provider review IDs when available, deterministic
 *   content fingerprints otherwise (never Date.now/random).
 * - Upserts never regress workflow state (response_status untouched on
 *   update) and inserted/updated/unchanged are reported separately.
 * - Every observation records retrieval method, completeness, and timestamp.
 */

import { createHash } from 'crypto'
import { z } from 'zod'
import type { Json, TablesInsert } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { getDataEngineUrl } from '@/utils/services/runtime-config'

type ServiceClient = ReturnType<typeof createServiceClient>

export class ReviewIngestionError extends Error {
  readonly retryable: boolean
  readonly statusCode: number | null

  constructor(message: string, options: { retryable: boolean; statusCode?: number | null }) {
    super(message)
    this.name = 'ReviewIngestionError'
    this.retryable = options.retryable
    this.statusCode = options.statusCode ?? null
  }
}

// ---------------------------------------------------------------------------
// Data Engine contract (mirrored by pydantic models in routers/reviews.py)
// ---------------------------------------------------------------------------

const observedReviewSchema = z.object({
  platform_review_id: z.string().nullable().optional(),
  reviewer_name: z.string().nullable().optional(),
  reviewer_avatar_url: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  review_text: z.string().nullable().optional(),
  review_date: z.string().nullable().optional(),
})

const reviewsResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable().optional(),
  reviews: z.array(observedReviewSchema).default([]),
  retrieval_method: z.string().nullable().optional(),
  completeness: z.enum(['complete', 'sample', 'degraded', 'unknown']).nullable().optional(),
  note: z.string().nullable().optional(),
})

export type ObservedReview = {
  platformReviewId: string | null
  reviewerName: string
  reviewerAvatarUrl: string | null
  rating: number | null
  reviewText: string
  reviewDate: string | null
}

export type ProviderFetchResult = {
  reviews: ObservedReview[]
  retrievalMethod: 'provider_api' | 'scraper'
  completeness: 'complete' | 'sample' | 'degraded' | 'unknown'
  note: string | null
}

const DATA_ENGINE_TIMEOUT_MS = Number(process.env.DATA_ENGINE_TIMEOUT_MS || 45000)

function dataEngineHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = process.env.DATA_ENGINE_API_KEY
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  return headers
}

async function callDataEngine(
  path: string,
  body: Record<string, unknown>,
  requestId?: string | null
): Promise<z.infer<typeof reviewsResponseSchema>> {
  const url = `${getDataEngineUrl()}${path}`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        ...dataEngineHeaders(),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DATA_ENGINE_TIMEOUT_MS),
    })
  } catch (error) {
    throw new ReviewIngestionError(
      `Data Engine unreachable at ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { retryable: true }
    )
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload.detail === 'string'
        ? payload.detail
        : payload && typeof payload.error === 'string'
          ? payload.error
          : `Data Engine error ${response.status} at ${path}`
    throw new ReviewIngestionError(message, {
      retryable: response.status >= 500 || response.status === 429,
      statusCode: response.status,
    })
  }

  const parsed = reviewsResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new ReviewIngestionError(
      `Data Engine response at ${path} failed contract validation: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
      { retryable: false, statusCode: response.status }
    )
  }

  if (!parsed.data.success) {
    throw new ReviewIngestionError(parsed.data.error || `Data Engine reported failure at ${path}`, {
      retryable: false,
      statusCode: response.status,
    })
  }

  return parsed.data
}

function toObservedReviews(raw: z.infer<typeof reviewsResponseSchema>['reviews']): ObservedReview[] {
  return raw
    .map((review) => ({
      platformReviewId: review.platform_review_id?.trim() || null,
      reviewerName: review.reviewer_name?.trim() || 'Anonymous',
      reviewerAvatarUrl: review.reviewer_avatar_url || null,
      rating:
        typeof review.rating === 'number' && review.rating >= 1 && review.rating <= 5
          ? Math.round(review.rating)
          : null,
      reviewText: review.review_text?.trim() || '',
      reviewDate: review.review_date || null,
    }))
    .filter((review) => review.reviewText.length > 0)
}

function normalizeResult(
  data: z.infer<typeof reviewsResponseSchema>,
  fallbackMethod: 'provider_api' | 'scraper'
): ProviderFetchResult {
  return {
    reviews: toObservedReviews(data.reviews),
    retrievalMethod: data.retrieval_method === 'scraper' ? 'scraper' : fallbackMethod,
    completeness: data.completeness ?? 'unknown',
    note: data.note ?? null,
  }
}

export async function fetchGoogleReviewsViaApi(
  placeId: string,
  requestId?: string | null
): Promise<ProviderFetchResult> {
  const data = await callDataEngine(
    '/scraper/google-reviews',
    { place_id: placeId, max_reviews: 50 },
    requestId
  )
  return normalizeResult(data, 'provider_api')
}

export async function fetchGoogleReviewsViaScraper(
  placeId: string,
  requestId?: string | null
): Promise<ProviderFetchResult> {
  const data = await callDataEngine(
    '/scraper/google-reviews/full',
    { place_id: placeId, max_reviews: 100 },
    requestId
  )
  return normalizeResult(data, 'scraper')
}

export async function fetchYelpReviews(
  businessId: string,
  requestId?: string | null
): Promise<ProviderFetchResult> {
  const data = await callDataEngine(
    '/scraper/yelp-reviews',
    { business_id: businessId },
    requestId
  )
  return normalizeResult(data, 'provider_api')
}

export async function fetchYelpReviewsFromUrl(
  url: string,
  requestId?: string | null
): Promise<ProviderFetchResult> {
  const data = await callDataEngine('/scraper/yelp-reviews/from-url', { url }, requestId)
  return normalizeResult(data, 'provider_api')
}

// ---------------------------------------------------------------------------
// Stable identity + replay-safe persistence
// ---------------------------------------------------------------------------

/** Deterministic content fingerprint for identity + change detection. */
export function reviewContentFingerprint(input: {
  platform: string
  reviewerName: string | null
  reviewDate: string | null
  reviewText: string
  rating: number | null
}): string {
  const canonical = [
    input.platform,
    (input.reviewerName || '').trim().toLowerCase(),
    (input.reviewDate || '').slice(0, 10),
    (input.reviewText || '').trim(),
    String(input.rating ?? ''),
  ].join('\u241f')
  return createHash('sha256').update(canonical).digest('hex')
}

export type PersistObservedReviewsResult = {
  inserted: number
  updated: number
  unchanged: number
  insertedReviews: Array<{
    id: string
    property_id: string | null
    review_text: string | null
    rating: number | null
    reviewer_name: string | null
    platform: string
  }>
}

/**
 * Persist observed reviews without regressing workflow state:
 * - New rows are inserted with response_status 'pending'.
 * - Existing rows are content-updated only when the fingerprint changed;
 *   response_status/sentiment fields are never touched on update.
 * - Unchanged rows only get last_observed_at bumped.
 */
export async function persistObservedReviews(
  supabase: ServiceClient,
  input: {
    propertyId: string
    platform: string
    reviews: ObservedReview[]
    retrievalMethod: 'provider_api' | 'scraper' | 'manual' | 'csv_import'
    completeness: 'complete' | 'sample' | 'degraded' | 'unknown'
  }
): Promise<PersistObservedReviewsResult> {
  const nowIso = new Date().toISOString()

  const normalized = input.reviews.map((review) => {
    const fingerprint = reviewContentFingerprint({
      platform: input.platform,
      reviewerName: review.reviewerName,
      reviewDate: review.reviewDate,
      reviewText: review.reviewText,
      rating: review.rating,
    })
    return {
      ...review,
      fingerprint,
      platformReviewId: review.platformReviewId || `fp-${fingerprint.slice(0, 24)}`,
    }
  })

  // Deduplicate within the batch by stable identity.
  const byId = new Map<string, (typeof normalized)[number]>()
  for (const review of normalized) {
    if (!byId.has(review.platformReviewId)) byId.set(review.platformReviewId, review)
  }
  const batch = Array.from(byId.values())
  if (batch.length === 0) {
    return { inserted: 0, updated: 0, unchanged: 0, insertedReviews: [] }
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('reviews')
    .select('id, platform_review_id, content_fingerprint')
    .eq('property_id', input.propertyId)
    .eq('platform', input.platform)
    .in(
      'platform_review_id',
      batch.map((review) => review.platformReviewId)
    )

  if (existingError) {
    throw new ReviewIngestionError(`Failed to load existing reviews: ${existingError.message}`, {
      retryable: true,
    })
  }

  const existingById = new Map(
    (existingRows || []).map((row) => [row.platform_review_id, row])
  )

  const toInsert: TablesInsert<'reviews'>[] = []
  const toUpdate: Array<{ id: string; review: (typeof batch)[number] }> = []
  const unchangedIds: string[] = []

  for (const review of batch) {
    const existing = existingById.get(review.platformReviewId)
    if (!existing) {
      toInsert.push({
        property_id: input.propertyId,
        platform: input.platform,
        platform_review_id: review.platformReviewId,
        reviewer_name: review.reviewerName,
        reviewer_avatar_url: review.reviewerAvatarUrl,
        rating: review.rating,
        review_text: review.reviewText,
        review_date: review.reviewDate,
        response_status: 'pending',
        content_fingerprint: review.fingerprint,
        retrieval_method: input.retrievalMethod,
        source_completeness: input.completeness,
        last_observed_at: nowIso,
        updated_at: nowIso,
      })
    } else if (existing.content_fingerprint === review.fingerprint) {
      unchangedIds.push(existing.id)
    } else {
      toUpdate.push({ id: existing.id, review })
    }
  }

  const insertedReviews: PersistObservedReviewsResult['insertedReviews'] = []
  if (toInsert.length > 0) {
    const { data: insertedRows, error: insertError } = await supabase
      .from('reviews')
      .insert(toInsert)
      .select('id, property_id, review_text, rating, reviewer_name, platform')

    if (insertError) {
      throw new ReviewIngestionError(`Failed to insert reviews: ${insertError.message}`, {
        retryable: true,
      })
    }
    insertedReviews.push(...(insertedRows || []))
  }

  let updated = 0
  for (const { id, review } of toUpdate) {
    const { error: updateError } = await supabase
      .from('reviews')
      .update({
        reviewer_name: review.reviewerName,
        reviewer_avatar_url: review.reviewerAvatarUrl,
        rating: review.rating,
        review_text: review.reviewText,
        review_date: review.reviewDate,
        content_fingerprint: review.fingerprint,
        retrieval_method: input.retrievalMethod,
        source_completeness: input.completeness,
        last_observed_at: nowIso,
        updated_at: nowIso,
        // response_status intentionally untouched: never regress workflow state.
      })
      .eq('id', id)
    if (updateError) {
      console.error('[reviewflow_ingestion] failed to update review', { id, error: updateError })
    } else {
      updated++
    }
  }

  if (unchangedIds.length > 0) {
    const { error: touchError } = await supabase
      .from('reviews')
      .update({ last_observed_at: nowIso })
      .in('id', unchangedIds)
    if (touchError) {
      console.error('[reviewflow_ingestion] failed to touch unchanged reviews', {
        error: touchError,
      })
    }
  }

  return {
    inserted: insertedReviews.length,
    updated,
    unchanged: unchangedIds.length,
    insertedReviews,
  }
}

export function toJsonSummary(result: PersistObservedReviewsResult): Json {
  return {
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
  } as Json
}
