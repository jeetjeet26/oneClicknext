import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
    const propertyId = searchParams.get('propertyId')
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
        )
      `)
      .eq('property_id', propertyId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (platform) {
      query = query.eq('platform', platform)
    }
    if (sentiment) {
      query = query.eq('sentiment', sentiment)
    }
    if (status) {
      query = query.eq('response_status', status)
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

    const { data, error } = await supabase
      .from('reviews')
      .upsert({
        property_id: propertyId,
        platform,
        platform_review_id: platformReviewId,
        reviewer_name: reviewerName,
        reviewer_avatar_url: reviewerAvatarUrl,
        rating,
        review_text: reviewText,
        review_date: reviewDate,
        raw_data: rawData,
        response_status: 'pending',
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'property_id,platform,platform_review_id'
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating review:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
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

