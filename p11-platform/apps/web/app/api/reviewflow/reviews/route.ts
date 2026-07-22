import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { reviewContentFingerprint } from '@/utils/reviewflow/ingestion'
import { ensureCaseForReview } from '@/utils/reviewflow/cases'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
    const propertyId = searchParams.get('propertyId')
    const reviewId = searchParams.get('reviewId')
    const platform = searchParams.get('platform')
    const sentiment = searchParams.get('sentiment')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let query = supabase
      .from('reviews')
      .select(`
        *,
        review_responses (
          id,
          response_text,
          response_type,
          status,
          tone,
          decision_reason,
          superseded_at,
          posting_mode,
          platform_response_id,
          provider_post_url,
          approved_at,
          posted_at,
          created_at
        ),
        review_tickets (
          id,
          title,
          priority,
          status,
          resolution_notes,
          resolved_at,
          created_at
        ),
        reputation_cases (
          id,
          status,
          priority,
          risk_class,
          policy_class,
          journey_stage,
          owner_profile_id,
          sla_due_at,
          remediation_state
        )
      `, { count: 'exact' })
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'review_responses', ascending: false })
      .range(offset, offset + limit - 1)

    if (reviewId) {
      query = query.eq('id', reviewId)
    }
    if (platform) {
      query = query.eq('platform', platform)
    }
    if (sentiment) {
      query = query.eq('sentiment', sentiment)
    }
    if (status) {
      // Supports comma-separated status lists (e.g. "pending,draft_ready").
      const statuses = status.split(',').map((value) => value.trim()).filter(Boolean)
      query = statuses.length > 1
        ? query.in('response_status', statuses)
        : query.eq('response_status', statuses[0] || status)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Error fetching reviews:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ reviews: data, total: count })
  } catch (error) {
    console.error('ReviewFlow GET /reviews error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const {
      propertyId,
      platform,
      platformReviewId,
      reviewerName,
      reviewerAvatarUrl,
      rating,
      reviewText,
      reviewDate,
      rawData
    } = body

    if (!propertyId || !platform || !reviewText) {
      return NextResponse.json(
        { error: 'propertyId, platform, and reviewText are required' },
        { status: 400 }
      )
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const nowIso = new Date().toISOString()
    const fingerprint = reviewContentFingerprint({
      platform,
      reviewerName: reviewerName || null,
      reviewDate: reviewDate || null,
      reviewText,
      rating: typeof rating === 'number' ? rating : null,
    })
    const stableId = platformReviewId || `fp-${fingerprint.slice(0, 24)}`

    // Manual create is replay-safe: existing reviews are content-updated
    // without regressing their workflow state.
    const { data: existing } = await supabase
      .from('reviews')
      .select('id')
      .eq('property_id', propertyId)
      .eq('platform', platform)
      .eq('platform_review_id', stableId)
      .maybeSingle()

    if (existing) {
      const { data, error } = await supabase
        .from('reviews')
        .update({
          reviewer_name: reviewerName,
          reviewer_avatar_url: reviewerAvatarUrl,
          rating,
          review_text: reviewText,
          review_date: reviewDate,
          raw_data: rawData,
          content_fingerprint: fingerprint,
          last_observed_at: nowIso,
          updated_at: nowIso
          // response_status intentionally untouched.
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating review:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ review: data, updated: true })
    }

    const { data, error } = await supabase
      .from('reviews')
      .insert({
        property_id: propertyId,
        platform,
        platform_review_id: stableId,
        reviewer_name: reviewerName,
        reviewer_avatar_url: reviewerAvatarUrl,
        rating,
        review_text: reviewText,
        review_date: reviewDate,
        raw_data: rawData,
        response_status: 'pending',
        retrieval_method: 'manual',
        content_fingerprint: fingerprint,
        last_observed_at: nowIso,
        updated_at: nowIso
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating review:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (data) {
      await ensureCaseForReview(createServiceClient(), {
        id: data.id,
        property_id: data.property_id,
      })
    }

    return NextResponse.json({ review: data })
  } catch (error) {
    console.error('ReviewFlow POST /reviews error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Review ID is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: review } = await supabase
      .from('reviews')
      .select('property_id')
      .eq('id', id)
      .single()
    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }
    if (typeof review.property_id !== 'string') {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }
    const access = await validatePropertyAccess(user.id, review.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const allowedFields = new Set([
      'sentiment',
      'sentiment_score',
      'topics',
      'is_urgent',
      'response_status',
      'auto_respond_eligible',
      'review_text',
      'rating',
      'reviewer_name',
      'reviewer_avatar_url',
      'review_date',
      'raw_data'
    ])
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => allowedFields.has(key))
    )

    const { data, error } = await supabase
      .from('reviews')
      .update({
        ...safeUpdates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating review:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ review: data })
  } catch (error) {
    console.error('ReviewFlow PATCH /reviews error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

