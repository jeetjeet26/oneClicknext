/**
 * PropertyAudit Runs API
 * List runs with scores and diffs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export interface GeoRunWithScore {
  id: string
  propertyId: string
  surface: 'openai' | 'claude'
  modelName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  queryCount: number
  startedAt: string
  finishedAt: string | null
  score: {
    overallScore: number
    visibilityPct: number
    avgLlmRank: number | null
    avgLinkRank: number | null
    avgSov: number | null
  } | null
  diff: {
    scoreChange: number
    visibilityChange: number
    direction: 'up' | 'down' | 'stable'
  } | null
}

function isValidSurface(value: unknown): value is GeoRunWithScore['surface'] {
  return value === 'openai' || value === 'claude'
}

function isValidStatus(value: unknown): value is GeoRunWithScore['status'] {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed'
  )
}

// GET: List runs for a property with scores
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const searchParams = req.nextUrl.searchParams
    const propertyId = searchParams.get('propertyId')
    const surface = searchParams.get('surface')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (surface && surface !== 'openai' && surface !== 'claude') {
      return NextResponse.json(
        { error: 'Invalid surface. Allowed values: openai, claude' },
        { status: 400 }
      )
    }

    // Fetch runs with scores
    let query = supabase
      .from('geo_runs')
      .select(`
        *,
        geo_scores (
          overall_score,
          visibility_pct,
          avg_llm_rank,
          avg_link_rank,
          avg_sov
        )
      `)
      .eq('property_id', propertyId)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (surface === 'openai' || surface === 'claude') {
      query = query.eq('surface', surface)
    }

    const { data: runs, error, count } = await query

    if (error) {
      console.error('Error fetching runs:', error)
      return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
    }

    // Calculate diffs between consecutive runs
    const runsWithDiffs = (runs || [])
      .map((run, index): GeoRunWithScore | null => {
      const scoreData = run.geo_scores?.[0]
      const currentScore = scoreData?.overall_score || 0
      const currentVisibility = scoreData?.visibility_pct || 0

      // Get previous run for diff calculation
      const prevRun = runs?.[index + 1]
      const prevScoreData = prevRun?.geo_scores?.[0]
      
      let diff = null
      if (prevScoreData && scoreData) {
        const prevScore = prevScoreData.overall_score || 0
        const prevVisibility = prevScoreData.visibility_pct || 0
        const scoreChange = currentScore - prevScore
        const visibilityChange = currentVisibility - prevVisibility
        
        const direction: 'up' | 'down' | 'stable' = scoreChange > 0.5 ? 'up' : scoreChange < -0.5 ? 'down' : 'stable';
        
        diff = {
          scoreChange: Math.round(scoreChange * 10) / 10,
          visibilityChange: Math.round(visibilityChange * 10) / 10,
          direction,
        }
      }

      if (
        !run.id ||
        !run.property_id ||
        !run.started_at ||
        !isValidSurface(run.surface) ||
        !isValidStatus(run.status)
      ) {
        return null
      }

      return {
        id: run.id,
        propertyId: run.property_id,
        surface: run.surface,
        modelName: run.model_name || 'unknown',
        status: run.status,
        queryCount: run.query_count || 0,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        score: scoreData ? {
          overallScore: scoreData.overall_score,
          visibilityPct: scoreData.visibility_pct,
          avgLlmRank: scoreData.avg_llm_rank,
          avgLinkRank: scoreData.avg_link_rank,
          avgSov: scoreData.avg_sov,
        } : null,
        diff,
      }
      })
      .filter((run): run is GeoRunWithScore => run !== null)

    // Get latest scores per surface for summary
    const latestOpenai = runsWithDiffs.find(r => r.surface === 'openai' && r.score)
    const latestClaude = runsWithDiffs.find(r => r.surface === 'claude' && r.score)

    return NextResponse.json({
      runs: runsWithDiffs,
      total: count || runs?.length || 0,
      summary: {
        openai: latestOpenai?.score || null,
        claude: latestClaude?.score || null,
        combined: calculateCombinedScore(latestOpenai?.score, latestClaude?.score),
      },
    })
  } catch (error) {
    console.error('PropertyAudit Runs GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Calculate combined score across surfaces
function calculateCombinedScore(
  openai: GeoRunWithScore['score'] | null | undefined,
  claude: GeoRunWithScore['score'] | null | undefined
): { overallScore: number; visibilityPct: number } | null {
  if (!openai && !claude) return null
  
  const scores = [openai, claude].filter(Boolean) as NonNullable<GeoRunWithScore['score']>[]
  
  if (scores.length === 0) return null
  
  const avgScore = scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
  const avgVisibility = scores.reduce((sum, s) => sum + s.visibilityPct, 0) / scores.length
  
  return {
    overallScore: Math.round(avgScore * 10) / 10,
    visibilityPct: Math.round(avgVisibility * 10) / 10,
  }
}










