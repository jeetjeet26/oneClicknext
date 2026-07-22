import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

/**
 * GET /api/reviewflow/cases?reviewId=... — load the reputation case for a
 * review, including its immutable event timeline and the latest completed
 * analysis. This powers the case workspace drawer.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const reviewId = searchParams.get('reviewId')

    if (!reviewId) {
      return NextResponse.json({ error: 'reviewId is required' }, { status: 400 })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: review } = await supabase
      .from('reviews')
      .select('id, property_id')
      .eq('id', reviewId)
      .maybeSingle()

    if (!review || typeof review.property_id !== 'string') {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, review.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [{ data: caseRow }, { data: analysis }] = await Promise.all([
      supabase
        .from('reputation_cases')
        .select('*')
        .eq('review_id', reviewId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('review_analyses')
        .select('*')
        .eq('review_id', reviewId)
        .eq('status', 'completed')
        .order('analysis_version', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    let events: unknown[] = []
    if (caseRow) {
      const { data: eventRows } = await supabase
        .from('reputation_case_events')
        .select('id, event_type, actor_profile_id, payload, created_at')
        .eq('case_id', caseRow.id)
        .order('created_at', { ascending: true })
      events = eventRows || []
    }

    return NextResponse.json({ case: caseRow || null, events, analysis: analysis || null })
  } catch (error) {
    console.error('ReviewFlow GET /cases error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
