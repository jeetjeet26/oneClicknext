/**
 * LeadPulse Insights API
 * Aggregated scoring insights and analytics
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import {
  forbidden,
  notFound,
  serverError,
  unauthorized,
} from '@/utils/services/api-helpers'
import { createRequestContext } from '@/utils/services/request-context'

export interface ScoreDistribution {
  bucket: string
  count: number
  percentage: number
  avgScore: number
}

export interface ScoreInsights {
  totalLeads: number
  scoredLeads: number
  avgScore: number
  distribution: ScoreDistribution[]
  topFactors: {
    positive: { factor: string; count: number }[]
    negative: { factor: string; count: number }[]
  }
  recentTrend: {
    date: string
    avgScore: number
    hotLeads: number
  }[]
}

export async function GET(req: NextRequest) {
  const ctx = createRequestContext(req, '/api/leadpulse/insights')
  ctx.logStart()

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      ctx.logSuccess(401, { reason: 'unauthorized' })
      return unauthorized(ctx.responseHeaders)
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const days = parseInt(searchParams.get('days') || '30')

    if (propertyId) {
      const access = await validatePropertyAccess(user.id, propertyId)
      if (!access.authorized) {
        ctx.logSuccess(403, { reason: 'forbidden', propertyId })
        return forbidden(ctx.responseHeaders)
      }
    }

    // Get user's profile to check org access
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (!profile) {
      ctx.logSuccess(404, { reason: 'profile_not_found' })
      return notFound('Profile', ctx.responseHeaders)
    }

    if (!profile.org_id) {
      ctx.logSuccess(404, { reason: 'org_not_found' })
      return notFound('Organization', ctx.responseHeaders)
    }

    // Build base query for leads
    let leadsQuery = supabase
      .from('leads')
      .select('id, score, score_bucket, property_id, properties!inner(org_id)', { count: 'exact' })
      .eq('properties.org_id', profile.org_id)

    if (propertyId) {
      leadsQuery = leadsQuery.eq('property_id', propertyId)
    }

    const { data: leads, count: totalLeads } = await leadsQuery

    if (!leads || totalLeads === 0) {
      ctx.logSuccess(200, { propertyId: propertyId || null, totalLeads: 0 })
      return NextResponse.json(
        {
          insights: {
            totalLeads: 0,
            scoredLeads: 0,
            avgScore: 0,
            distribution: [],
            topFactors: { positive: [], negative: [] },
            recentTrend: [],
          }
        },
        { headers: ctx.responseHeaders }
      )
    }

    // Calculate distribution
    const scoredLeads = leads.filter(l => l.score !== null)
    const avgScore = scoredLeads.length > 0
      ? Math.round(scoredLeads.reduce((sum, l) => sum + (l.score || 0), 0) / scoredLeads.length)
      : 0

    const buckets = ['hot', 'warm', 'cold', 'unqualified']
    const distribution: ScoreDistribution[] = buckets.map(bucket => {
      const bucketLeads = scoredLeads.filter(l => l.score_bucket === bucket)
      return {
        bucket,
        count: bucketLeads.length,
        percentage: scoredLeads.length > 0 
          ? Math.round((bucketLeads.length / scoredLeads.length) * 100) 
          : 0,
        avgScore: bucketLeads.length > 0
          ? Math.round(bucketLeads.reduce((sum, l) => sum + (l.score || 0), 0) / bucketLeads.length)
          : 0,
      }
    })

    // Get recent scores for factor analysis
    let scoresQuery = supabase
      .from('lead_scores')
      .select(`
        factors,
        scored_at,
        total_score,
        score_bucket,
        leads!inner(property_id, properties!inner(org_id))
      `)
      .eq('leads.properties.org_id', profile.org_id)
      .gte('scored_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('scored_at', { ascending: false })
      .limit(500)

    if (propertyId) {
      scoresQuery = scoresQuery.eq('leads.property_id', propertyId)
    }

    const { data: recentScores } = await scoresQuery

    // Analyze top factors
    const factorCounts: Record<string, { positive: number; negative: number }> = {}
    
    if (recentScores) {
      for (const score of recentScores) {
        const factors = (score.factors as { factor: string; type: string }[]) || []
        for (const f of factors) {
          if (!factorCounts[f.factor]) {
            factorCounts[f.factor] = { positive: 0, negative: 0 }
          }
          if (f.type === 'positive') {
            factorCounts[f.factor].positive++
          } else if (f.type === 'negative') {
            factorCounts[f.factor].negative++
          }
        }
      }
    }

    const topFactors = {
      positive: Object.entries(factorCounts)
        .map(([factor, counts]) => ({ factor, count: counts.positive }))
        .filter(f => f.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      negative: Object.entries(factorCounts)
        .map(([factor, counts]) => ({ factor, count: counts.negative }))
        .filter(f => f.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    }

    // Calculate daily trend
    const trendMap = new Map<string, { scores: number[]; hotCount: number }>()
    
    if (recentScores) {
      for (const score of recentScores) {
        const date = new Date(score.scored_at as string).toISOString().split('T')[0]
        if (!trendMap.has(date)) {
          trendMap.set(date, { scores: [], hotCount: 0 })
        }
        const dayData = trendMap.get(date)!
        dayData.scores.push(score.total_score as number)
        if (score.score_bucket === 'hot') {
          dayData.hotCount++
        }
      }
    }

    const recentTrend = Array.from(trendMap.entries())
      .map(([date, data]) => ({
        date,
        avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
        hotLeads: data.hotCount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14) // Last 14 days

    const insights: ScoreInsights = {
      totalLeads: totalLeads || 0,
      scoredLeads: scoredLeads.length,
      avgScore,
      distribution,
      topFactors,
      recentTrend,
    }

    ctx.logSuccess(200, {
      propertyId: propertyId || null,
      totalLeads: totalLeads || 0,
      scoredLeads: scoredLeads.length,
    })

    return NextResponse.json({ insights }, { headers: ctx.responseHeaders })
  } catch (error) {
    ctx.logError(500, error, { operation: 'leadpulse_insights' })
    return serverError(error, ctx.responseHeaders)
  }
}



























