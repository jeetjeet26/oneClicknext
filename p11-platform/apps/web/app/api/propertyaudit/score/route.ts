/**
 * PropertyAudit Score API
 * Get current GEO visibility scores for a property
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export interface GeoScoreSummary {
  propertyId: string
  overallScore: number
  visibilityPct: number
  scoreBucket: 'excellent' | 'good' | 'fair' | 'poor'
  surfaces: {
    openai: SurfaceScore | null
    claude: SurfaceScore | null
  }
  breakdown: {
    position: number
    link: number
    sov: number
    accuracy: number
  }
  lastRunAt: string | null
  trend: {
    direction: 'up' | 'down' | 'stable'
    changePercent: number
  } | null
}

interface SurfaceScore {
  overallScore: number
  visibilityPct: number
  avgLlmRank: number | null
  avgLinkRank: number | null
  avgSov: number | null
  runId: string
  runAt: string
}

// GET: Get current GEO score for a property
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    console.log('[Score API] Fetching score for property:', propertyId)

    // Get latest completed runs per surface
    const { data: latestRuns, error: runsError } = await supabase
      .from('geo_runs')
      .select(`
        id,
        surface,
        started_at,
        geo_scores (
          overall_score,
          visibility_pct,
          avg_llm_rank,
          avg_link_rank,
          avg_sov,
          breakdown
        )
      `)
      .eq('property_id', propertyId)
      .eq('status', 'completed')
      .order('started_at', { ascending: false })
      .limit(10)

    if (runsError) {
      console.error('Error fetching runs:', runsError)
      return NextResponse.json({ error: 'Failed to fetch scores' }, { status: 500 })
    }

    // Find latest run per surface
    const latestOpenaiRun = latestRuns?.find(r => r.surface === 'openai' && r.geo_scores?.length > 0)
    const latestClaudeRun = latestRuns?.find(r => r.surface === 'claude' && r.geo_scores?.length > 0)

    // Get previous runs for trend calculation
    const prevOpenaiRun = latestRuns?.find(r => 
      r.surface === 'openai' && 
      r.geo_scores?.length > 0 && 
      r.id !== latestOpenaiRun?.id
    )
    const prevClaudeRun = latestRuns?.find(r => 
      r.surface === 'claude' && 
      r.geo_scores?.length > 0 && 
      r.id !== latestClaudeRun?.id
    )

    // Build surface scores
    const openaiScore = latestOpenaiRun ? buildSurfaceScore(latestOpenaiRun) : null
    const claudeScore = latestClaudeRun ? buildSurfaceScore(latestClaudeRun) : null

    // Calculate combined score
    const scores = [openaiScore, claudeScore].filter(Boolean) as SurfaceScore[]
    
    if (scores.length === 0) {
      console.log('[Score API] No completed runs found for property:', propertyId)
      return NextResponse.json({
        score: null,
        message: 'No completed runs found. Run an audit first.',
      }, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        }
      })
    }

    const avgOverallScore = scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
    const avgVisibilityPct = scores.reduce((sum, s) => sum + s.visibilityPct, 0) / scores.length

    // Calculate trend
    const prevScores = [
      prevOpenaiRun ? buildSurfaceScore(prevOpenaiRun) : null,
      prevClaudeRun ? buildSurfaceScore(prevClaudeRun) : null,
    ].filter(Boolean) as SurfaceScore[]

    let trend = null
    if (prevScores.length > 0) {
      const prevAvg = prevScores.reduce((sum, s) => sum + s.overallScore, 0) / prevScores.length
      const changePercent = avgOverallScore - prevAvg
      const direction: 'up' | 'down' | 'stable' = changePercent > 1 ? 'up' : changePercent < -1 ? 'down' : 'stable';
      trend = {
        direction,
        changePercent: Math.round(changePercent * 10) / 10,
      }
    }

    // Get breakdown from latest score
    const latestScore = openaiScore || claudeScore
    const latestBreakdown = latestOpenaiRun?.geo_scores?.[0]?.breakdown || 
                           latestClaudeRun?.geo_scores?.[0]?.breakdown || 
                           { position: 0, link: 0, sov: 0, accuracy: 0 }

    const summary: GeoScoreSummary = {
      propertyId,
      overallScore: Math.round(avgOverallScore * 10) / 10,
      visibilityPct: Math.round(avgVisibilityPct * 10) / 10,
      scoreBucket: getScoreBucket(avgOverallScore),
      surfaces: {
        openai: openaiScore,
        claude: claudeScore,
      },
      breakdown: latestBreakdown as GeoScoreSummary['breakdown'],
      lastRunAt: latestScore?.runAt || null,
      trend,
    }

    console.log('[Score API] Returning score for property:', propertyId, 'Score:', summary.overallScore)
    return NextResponse.json({ score: summary }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      }
    })
  } catch (error) {
    console.error('PropertyAudit Score GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function buildSurfaceScore(run: Record<string, unknown>): SurfaceScore {
  const scoreData = (run.geo_scores as Array<Record<string, unknown>>)?.[0]
  return {
    overallScore: (scoreData?.overall_score as number) || 0,
    visibilityPct: (scoreData?.visibility_pct as number) || 0,
    avgLlmRank: scoreData?.avg_llm_rank as number | null,
    avgLinkRank: scoreData?.avg_link_rank as number | null,
    avgSov: scoreData?.avg_sov as number | null,
    runId: run.id as string,
    runAt: run.started_at as string,
  }
}

function getScoreBucket(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 75) return 'excellent'
  if (score >= 50) return 'good'
  if (score >= 25) return 'fair'
  return 'poor'
}










