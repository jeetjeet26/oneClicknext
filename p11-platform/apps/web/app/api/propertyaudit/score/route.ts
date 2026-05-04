/**
 * PropertyAudit Score API
 * Get current GEO visibility scores for a property
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { getSurfaceLabel, isSupportedSurface, type Surface } from '@/utils/propertyaudit/types'

export interface GeoScoreSummary {
  propertyId: string
  overallScore: number
  visibilityPct: number
  scoreBucket: 'excellent' | 'good' | 'fair' | 'poor'
  surfaces: Partial<Record<Surface, SurfaceScore | null>>
  surfaceSummaries: Array<{
    surface: Surface
    label: string
    score: number | null
    visibilityPct: number | null
  }>
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

type GeoScoreRow = {
  overall_score: number | null
  visibility_pct: number | null
  avg_llm_rank: number | null
  avg_link_rank: number | null
  avg_sov: number | null
  breakdown: unknown
}

type GeoRunWithScores = {
  id: string
  surface: string | null
  started_at: string | null
  geo_scores: GeoScoreRow[] | null
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

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    const latestRunsBySurface = new Map<Surface, GeoRunWithScores>()
    const previousRunsBySurface = new Map<Surface, GeoRunWithScores>()
    for (const run of (latestRuns || []) as GeoRunWithScores[]) {
      const surface = run.surface
      if (typeof surface !== 'string' || !isSupportedSurface(surface) || !run.geo_scores?.length) continue
      if (!latestRunsBySurface.has(surface)) {
        latestRunsBySurface.set(surface, run)
      } else if (!previousRunsBySurface.has(surface)) {
        previousRunsBySurface.set(surface, run)
      }
    }

    // Build surface scores
    const surfaceEntries = Array.from(latestRunsBySurface.entries())
    const surfaces = Object.fromEntries(
      surfaceEntries.map(([surface, run]) => [surface, buildSurfaceScore(run)])
    ) as Partial<Record<Surface, SurfaceScore | null>>
    const surfaceSummaries = surfaceEntries.map(([surface, run]) => {
      const score = buildSurfaceScore(run)
      return {
        surface,
        label: getSurfaceLabel(surface),
        score: score.overallScore,
        visibilityPct: score.visibilityPct,
      }
    })

    // Calculate combined score
    const scores = Object.values(surfaces).filter(Boolean) as SurfaceScore[]
    
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
    const prevScores = Array.from(previousRunsBySurface.values())
      .map(run => buildSurfaceScore(run))
      .filter(Boolean) as SurfaceScore[]

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
    const latestScore = scores[0]
    const latestRun = Array.from(latestRunsBySurface.values())[0]
    const latestBreakdown =
      (latestRun?.geo_scores?.[0]?.breakdown as GeoScoreSummary['breakdown'] | undefined) ||
      { position: 0, link: 0, sov: 0, accuracy: 0 }

    const summary: GeoScoreSummary = {
      propertyId,
      overallScore: Math.round(avgOverallScore * 10) / 10,
      visibilityPct: Math.round(avgVisibilityPct * 10) / 10,
      scoreBucket: getScoreBucket(avgOverallScore),
      surfaces,
      surfaceSummaries,
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

function buildSurfaceScore(run: GeoRunWithScores): SurfaceScore {
  const scoreData = run.geo_scores?.[0]
  return {
    overallScore: scoreData?.overall_score || 0,
    visibilityPct: scoreData?.visibility_pct || 0,
    avgLlmRank: scoreData?.avg_llm_rank ?? null,
    avgLinkRank: scoreData?.avg_link_rank ?? null,
    avgSov: scoreData?.avg_sov ?? null,
    runId: run.id,
    runAt: run.started_at || '',
  }
}

function getScoreBucket(score: number): 'excellent' | 'good' | 'fair' | 'poor' {
  if (score >= 75) return 'excellent'
  if (score >= 50) return 'good'
  if (score >= 25) return 'fair'
  return 'poor'
}










