import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { ReviewAiError, analyzeReview } from '@/utils/reviewflow/ai'
import { runReviewAnalysis } from '@/utils/reviewflow/analysis-pipeline'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()

  const { reviewId, reviewText, rating, propertyId } = body

  const adHocText: string = typeof reviewText === 'string' ? reviewText : ''
  const adHocRating: number | null = typeof rating === 'number' ? rating : null
  const adHocPropertyId: string | null = typeof propertyId === 'string' ? propertyId : null

  if (!reviewId && (!adHocText || !adHocPropertyId)) {
    return NextResponse.json(
      { error: 'reviewId or (reviewText and propertyId) is required' },
      { status: 400 }
    )
  }

  // Persisted-review path: full pipeline (versioned analysis, case update,
  // escalation surface) via the shared analysis pipeline.
  if (reviewId) {
    const { data: review, error } = await supabase
      .from('reviews')
      .select('id, review_text, rating, property_id, reviewer_name, platform')
      .eq('id', reviewId)
      .single()

    if (error || !review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    if (typeof review.property_id !== 'string') {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, review.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!review.review_text) {
      return NextResponse.json({ error: 'Review text is required' }, { status: 400 })
    }

    const service = createServiceClient()
    const outcome = await runReviewAnalysis(service, review)

    if (outcome.status === 'manual_review_required') {
      return NextResponse.json(
        {
          error: 'Review analysis unavailable',
          details: outcome.error,
          manualReviewRequired: true,
        },
        { status: 503 }
      )
    }

    if (outcome.status === 'skipped') {
      return NextResponse.json(
        { error: `Review cannot be analyzed: ${outcome.reason}` },
        { status: 400 }
      )
    }

    const { analysis } = outcome
    return NextResponse.json({
      analysis: {
        sentiment: analysis.sentiment,
        sentimentScore: analysis.sentimentScore,
        topics: analysis.topics,
        isUrgent: analysis.isUrgent,
        summary: analysis.summary,
        journeyStage: analysis.journeyStage,
        issueDomains: analysis.issueDomains,
        severity: analysis.severity,
        riskClass: analysis.riskClass,
        policyClass: analysis.policyClass,
        confidence: analysis.confidence,
        recommendedAction: analysis.recommendedAction,
        evidence: analysis.evidence,
        requiresHumanReview: analysis.policy.requiresHumanReview,
      },
      provenance: analysis.provenance,
      analysisId: outcome.analysisId,
    })
  }

  // Ad-hoc path: classify text without persisting anything.
  const access = await validatePropertyAccess(user.id, adHocPropertyId as string)
  if (!access.authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!adHocText) {
    return NextResponse.json({ error: 'Review text is required' }, { status: 400 })
  }

  try {
    const analysis = await analyzeReview({ reviewText: adHocText, rating: adHocRating })
    return NextResponse.json({
      analysis: {
        sentiment: analysis.sentiment,
        sentimentScore: analysis.sentimentScore,
        topics: analysis.topics,
        isUrgent: analysis.isUrgent,
        summary: analysis.summary,
        journeyStage: analysis.journeyStage,
        issueDomains: analysis.issueDomains,
        severity: analysis.severity,
        riskClass: analysis.riskClass,
        policyClass: analysis.policyClass,
        confidence: analysis.confidence,
        recommendedAction: analysis.recommendedAction,
        evidence: analysis.evidence,
        requiresHumanReview: analysis.policy.requiresHumanReview,
      },
      provenance: analysis.provenance,
    })
  } catch (error) {
    const details =
      error instanceof ReviewAiError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown error'
    return NextResponse.json(
      {
        error: 'Review analysis unavailable',
        details,
        manualReviewRequired: true,
      },
      { status: 503 }
    )
  }
}
