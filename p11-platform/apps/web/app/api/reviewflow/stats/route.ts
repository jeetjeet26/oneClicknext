import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

function safeTimestamp(value: string | null | undefined): number {
  if (!value) return 0
  const ts = new Date(value).getTime()
  return Number.isFinite(ts) ? ts : 0
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    
    const propertyId = searchParams.get('propertyId')
    const days = parseInt(searchParams.get('days') || '0')

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

    // Fetch all property reviews; apply optional time window in-memory using
    // review_date (source-of-truth) with created_at fallback.
    const { data: reviews, error: reviewsError } = await supabase
      .from('reviews')
      .select('*')
      .eq('property_id', propertyId)

    if (reviewsError) {
      console.error('Error fetching reviews:', reviewsError)
      return NextResponse.json({ error: reviewsError.message }, { status: 500 })
    }

    const now = Date.now()
    const windowStart = days > 0 ? now - days * 24 * 60 * 60 * 1000 : null
    const scopedReviews = (reviews || []).filter((r) => {
      if (!windowStart) return true
      const reviewTs = r.review_date ? new Date(r.review_date).getTime() : NaN
      const createdTs = r.created_at ? new Date(r.created_at).getTime() : NaN
      const effectiveTs = Number.isFinite(reviewTs) ? reviewTs : createdTs
      return Number.isFinite(effectiveTs) ? effectiveTs >= windowStart : false
    })

    // Get ticket counts
    const { data: tickets } = await supabase
      .from('review_tickets')
      .select('status')
      .eq('property_id', propertyId)

    // Reputation case counts (primary workflow object)
    const { data: cases } = await supabase
      .from('reputation_cases')
      .select('status, priority, sla_due_at')
      .eq('property_id', propertyId)

    // Calculate stats
    const totalReviews = scopedReviews.length
    const avgRating = scopedReviews.length 
      ? scopedReviews.reduce((sum, r) => sum + (r.rating || 0), 0) / scopedReviews.filter(r => r.rating).length 
      : 0

    const sentimentCounts = {
      positive: scopedReviews.filter(r => r.sentiment === 'positive').length || 0,
      neutral: scopedReviews.filter(r => r.sentiment === 'neutral').length || 0,
      negative: scopedReviews.filter(r => r.sentiment === 'negative').length || 0
    }

    const responseCounts = {
      pending: scopedReviews.filter(r => r.response_status === 'pending').length || 0,
      draft_ready: scopedReviews.filter(r => r.response_status === 'draft_ready').length || 0,
      approved: scopedReviews.filter(r => r.response_status === 'approved').length || 0,
      posted: scopedReviews.filter(r => r.response_status === 'posted').length || 0,
      skipped: scopedReviews.filter(r => r.response_status === 'skipped').length || 0
    }

    const platformCounts: Record<string, number> = {}
    scopedReviews.forEach(r => {
      platformCounts[r.platform] = (platformCounts[r.platform] || 0) + 1
    })

    const ticketCounts = {
      open: tickets?.filter(t => t.status === 'open').length || 0,
      in_progress: tickets?.filter(t => t.status === 'in_progress').length || 0,
      resolved: tickets?.filter(t => t.status === 'resolved').length || 0,
      closed: tickets?.filter(t => t.status === 'closed').length || 0
    }

    // Response coverage: posted responses over all reviews eligible for a
    // response (everything not explicitly skipped). Excluding 'pending' from
    // the denominator previously inflated coverage.
    const reviewsNeedingResponse = scopedReviews.filter(r =>
      r.response_status !== 'skipped'
    ).length || 0
    const respondedReviews = scopedReviews.filter(r => r.response_status === 'posted').length || 0
    const responseRate = reviewsNeedingResponse > 0 
      ? Math.round((respondedReviews / reviewsNeedingResponse) * 100) 
      : 0

    // Get top topics
    const topicCounts: Record<string, number> = {}
    scopedReviews.forEach(r => {
      const topics = r.topics as string[] || []
      topics.forEach(topic => {
        topicCounts[topic] = (topicCounts[topic] || 0) + 1
      })
    })
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }))

    // Calculate rating distribution
    const ratingDistribution = [1, 2, 3, 4, 5].map(rating => ({
      rating,
      count: scopedReviews.filter(r => r.rating === rating).length || 0
    }))

    // Recent activity - last 5 reviews
    const recentReviews = [...scopedReviews]
      .sort((a, b) => {
        const bTs = safeTimestamp(b.review_date || b.created_at)
        const aTs = safeTimestamp(a.review_date || a.created_at)
        return bTs - aTs
      })
      .slice(0, 5)
      .map(r => ({
        id: r.id,
        reviewer_name: r.reviewer_name,
        rating: r.rating,
        sentiment: r.sentiment,
        platform: r.platform,
        created_at: r.created_at
      }))

    const nowIso = new Date().toISOString()
    const caseRows = cases || []
    const openStatuses = new Set(['open', 'triaged', 'awaiting_approval', 'ready_to_post', 'remediation'])
    const caseCounts = {
      open: caseRows.filter(c => c.status === 'open').length,
      triaged: caseRows.filter(c => c.status === 'triaged').length,
      awaiting_approval: caseRows.filter(c => c.status === 'awaiting_approval').length,
      ready_to_post: caseRows.filter(c => c.status === 'ready_to_post').length,
      remediation: caseRows.filter(c => c.status === 'remediation').length,
      resolved: caseRows.filter(c => c.status === 'resolved').length,
      dismissed: caseRows.filter(c => c.status === 'dismissed').length,
      slaBreached: caseRows.filter(
        c => openStatuses.has(c.status) && c.sla_due_at !== null && c.sla_due_at < nowIso
      ).length,
    }

    return NextResponse.json({
      stats: {
        totalReviews,
        avgRating: Math.round(avgRating * 10) / 10,
        responseRate,
        sentimentCounts,
        responseCounts,
        platformCounts,
        ticketCounts,
        caseCounts,
        topTopics,
        ratingDistribution,
        recentReviews,
        periodDays: days
      }
    })
  } catch (error) {
    console.error('ReviewFlow GET /stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

