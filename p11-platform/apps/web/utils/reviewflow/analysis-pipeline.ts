/**
 * ReviewFlow analysis pipeline.
 *
 * One code path for classifying a review, persisting versioned intelligence,
 * updating the review row, maintaining its reputation case, and (until fully
 * migrated to cases) keeping the escalation ticket surface consistent.
 * Used by analyze, analyze-batch, sync, and import so behavior cannot drift.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'
import { ReviewAiError, analyzeReview, type ReviewAnalysisResult } from '@/utils/reviewflow/ai'
import { REVIEWFLOW_FAST_MODEL } from '@/utils/reviewflow/models'
import {
  applyAnalysisToCase,
  ensureCaseForReview,
  persistFailedAnalysis,
  persistReviewAnalysis,
} from '@/utils/reviewflow/cases'

type ServiceClient = ReturnType<typeof createServiceClient>

export type ReviewForAnalysis = {
  id: string
  property_id: string | null
  review_text: string | null
  rating: number | null
  reviewer_name: string | null
  platform?: string | null
}

export type AnalysisOutcome =
  | { status: 'analyzed'; analysis: ReviewAnalysisResult; analysisId: string | null }
  | { status: 'manual_review_required'; error: string }
  | { status: 'skipped'; reason: string }

/**
 * Analyze one review end to end. Failures are persisted as failed analysis
 * versions and surface as 'manual_review_required' — never silent.
 */
export async function runReviewAnalysis(
  supabase: ServiceClient,
  review: ReviewForAnalysis
): Promise<AnalysisOutcome> {
  if (!review.property_id) {
    return { status: 'skipped', reason: 'missing_property_id' }
  }
  if (!review.review_text || !review.review_text.trim()) {
    return { status: 'skipped', reason: 'empty_review_text' }
  }

  let analysis: ReviewAnalysisResult
  try {
    analysis = await analyzeReview({
      reviewText: review.review_text,
      rating: review.rating,
      platform: review.platform ?? null,
      reviewerName: review.reviewer_name,
    })
  } catch (error) {
    const message =
      error instanceof ReviewAiError
        ? `${error.kind}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'Unknown analysis failure'

    await persistFailedAnalysis(supabase, review, {
      model: REVIEWFLOW_FAST_MODEL,
      errorMessage: message,
    })
    await ensureCaseForReview(supabase, review)
    return { status: 'manual_review_required', error: message }
  }

  const analysisId = await persistReviewAnalysis(supabase, review, analysis)

  const ratingValue = review.rating ?? 0
  const autoRespondEligible =
    analysis.sentiment === 'positive' &&
    ratingValue >= 4 &&
    analysis.policy.autoActionEligible

  const { error: updateError } = await supabase
    .from('reviews')
    .update({
      sentiment: analysis.sentiment,
      sentiment_score: analysis.sentimentScore,
      topics: analysis.topics as unknown as Json,
      is_urgent: analysis.isUrgent,
      auto_respond_eligible: autoRespondEligible,
      updated_at: new Date().toISOString(),
    })
    .eq('id', review.id)

  if (updateError) {
    console.error('[reviewflow_analysis] failed to update review with analysis', {
      reviewId: review.id,
      error: updateError,
    })
  }

  await applyAnalysisToCase(supabase, review, analysis, analysisId)

  // Escalation tickets remain in place until the ticket surface is fully
  // migrated to reputation cases. Posting audits no longer use tickets.
  if (analysis.sentiment === 'negative' || analysis.isUrgent) {
    const { error: ticketError } = await supabase.from('review_tickets').upsert(
      {
        review_id: review.id,
        property_id: review.property_id,
        title: analysis.isUrgent
          ? `🚨 URGENT: Review from ${review.reviewer_name || 'Anonymous'}`
          : `Negative review from ${review.reviewer_name || 'Anonymous'}`,
        description: analysis.summary,
        priority: analysis.isUrgent
          ? 'urgent'
          : analysis.sentimentScore < -0.5
            ? 'high'
            : 'medium',
        status: 'open',
      },
      { onConflict: 'review_id' }
    )
    if (ticketError) {
      console.error('[reviewflow_analysis] failed to upsert escalation ticket', {
        reviewId: review.id,
        error: ticketError,
      })
    }
  }

  return { status: 'analyzed', analysis, analysisId }
}

export type BatchAnalysisSummary = {
  analyzed: number
  manualReviewRequired: number
  skipped: number
  results: Array<{
    id: string
    status: AnalysisOutcome['status']
    sentiment?: string
    score?: number
    error?: string
  }>
}

/** Analyze a batch of reviews sequentially (rate-limit friendly). */
export async function runBatchAnalysis(
  supabase: ServiceClient,
  reviews: ReviewForAnalysis[],
  options: { delayMs?: number } = {}
): Promise<BatchAnalysisSummary> {
  const summary: BatchAnalysisSummary = {
    analyzed: 0,
    manualReviewRequired: 0,
    skipped: 0,
    results: [],
  }

  for (const review of reviews) {
    const outcome = await runReviewAnalysis(supabase, review)
    if (outcome.status === 'analyzed') {
      summary.analyzed++
      summary.results.push({
        id: review.id,
        status: 'analyzed',
        sentiment: outcome.analysis.sentiment,
        score: outcome.analysis.sentimentScore,
      })
    } else if (outcome.status === 'manual_review_required') {
      summary.manualReviewRequired++
      summary.results.push({ id: review.id, status: outcome.status, error: outcome.error })
    } else {
      summary.skipped++
      summary.results.push({ id: review.id, status: outcome.status, error: outcome.reason })
    }

    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    }
  }

  return summary
}
