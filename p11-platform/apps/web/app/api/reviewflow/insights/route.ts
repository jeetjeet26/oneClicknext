import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  computeIssueClusters,
  type ReviewForInsights,
  type AnalysisForInsights,
  type CaseForInsights,
} from '@/utils/reviewflow/insights'

/**
 * GET /api/reviewflow/insights?propertyId=...&days=90
 *
 * Aggregate issue clusters with trend, recurrence, cited evidence, and
 * recommendation-only interventions. Read-only: nothing here executes or
 * schedules anything, and reviewers are never matched to residents/leads.
 */

const DEFAULT_WINDOW_DAYS = 90
const MAX_WINDOW_DAYS = 365

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId is required' }, { status: 400 })
    }

    const daysParam = Number.parseInt(searchParams.get('days') || '', 10)
    const windowDays = Number.isFinite(daysParam)
      ? Math.min(Math.max(daysParam, 7), MAX_WINDOW_DAYS)
      : DEFAULT_WINDOW_DAYS

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const service = createServiceClient()
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

    const [reviewsResult, casesResult] = await Promise.all([
      service
        .from('reviews')
        .select('id, rating, sentiment, review_text, review_date, created_at, is_urgent')
        .eq('property_id', propertyId)
        .gte('created_at', windowStart)
        .order('created_at', { ascending: false })
        .limit(1000),
      service
        .from('reputation_cases')
        .select('id, review_id, status, priority, issue_domains, reopened_count, created_at, resolved_at')
        .eq('property_id', propertyId)
        .gte('created_at', windowStart)
        .limit(1000),
    ])

    if (reviewsResult.error) {
      console.error('ReviewFlow insights reviews query error:', reviewsResult.error)
      return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500 })
    }

    const reviews = (reviewsResult.data || []) as ReviewForInsights[]
    const cases = (casesResult.data || []) as CaseForInsights[]

    const analyses: AnalysisForInsights[] = []
    if (reviews.length > 0) {
      const { data: analysisRows } = await service
        .from('review_analyses')
        .select('review_id, issue_domains, severity, journey_stage, created_at')
        .eq('property_id', propertyId)
        .eq('status', 'completed')
        .in('review_id', reviews.map((r) => r.id))
        .order('created_at', { ascending: false })

      // Keep only the latest completed analysis per review.
      const seen = new Set<string>()
      for (const row of analysisRows || []) {
        if (seen.has(row.review_id)) continue
        seen.add(row.review_id)
        analyses.push(row as AnalysisForInsights)
      }
    }

    const insights = computeIssueClusters({ reviews, analyses, cases, windowDays })

    return NextResponse.json(insights)
  } catch (error) {
    console.error('ReviewFlow GET /insights error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
