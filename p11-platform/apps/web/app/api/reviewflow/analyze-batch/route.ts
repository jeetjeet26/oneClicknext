import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { runBatchAnalysis } from '@/utils/reviewflow/analysis-pipeline'
import { runSharedExecutorJob } from '@/utils/services/shared-executor'

// POST: Analyze all unanalyzed reviews for a property (durable shared job)
export async function POST(request: NextRequest) {
  try {
    const supabaseAuth = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { propertyId, limit = 50 } = body

    if (!propertyId) {
      return NextResponse.json(
        { error: 'propertyId is required' },
        { status: 400 }
      )
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()

    const { data: property } = await supabase
      .from('properties')
      .select('org_id')
      .eq('id', propertyId)
      .single()

    if (!property?.org_id) {
      return NextResponse.json({ error: 'Property is missing org context' }, { status: 409 })
    }

    // Get all reviews without sentiment analysis
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('id, review_text, rating, property_id, reviewer_name, platform')
      .eq('property_id', propertyId)
      .is('sentiment', null)
      .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))

    if (error) {
      console.error('Error fetching reviews:', error)
      return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 })
    }

    if (!reviews || reviews.length === 0) {
      return NextResponse.json({
        success: true,
        analyzed: 0,
        message: 'No unanalyzed reviews found'
      })
    }

    const summary = await runSharedExecutorJob({
      orgId: property.org_id,
      propertyId,
      domain: 'reviewflow.analyze',
      subjectType: 'review_batch',
      requestedBy: user.id,
      payload: { propertyId, reviewCount: reviews.length },
      execute: () => runBatchAnalysis(supabase, reviews, { delayMs: 100 }),
    })

    const responseBody = {
      success: summary.analyzed > 0 && summary.manualReviewRequired === 0,
      analyzed: summary.analyzed,
      errors: summary.skipped,
      providerFailures: summary.manualReviewRequired,
      manualReviewRequired: summary.manualReviewRequired > 0,
      total: reviews.length,
      results: summary.results,
    }

    if (summary.analyzed === 0 && summary.manualReviewRequired > 0) {
      return NextResponse.json(
        {
          ...responseBody,
          error: 'Review analysis unavailable',
        },
        { status: 503 }
      )
    }

    return NextResponse.json(responseBody)

  } catch (error) {
    console.error('Batch analysis error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch analysis failed' },
      { status: 500 }
    )
  }
}
