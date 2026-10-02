/**
 * PropertyAudit Runs API
 * List runs with scores and diffs
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { isSupportedSurface, type Surface } from '@/utils/propertyaudit/types'

export interface GeoRunWithScore {
  id: string
  propertyId: string
  batchId: string | null
  surface: Surface
  modelName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  queryCount: number
  progressPct: number
  currentQueryIndex: number
  lastUpdatedAt: string | null
  secondsSinceUpdate: number | null
  isPossiblyStalled: boolean
  statusLabel: string
  statusDetail: string
  errorMessage: string | null
  usesWebSearch: boolean
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

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function computeProgressPct(status: GeoRunWithScore['status'], progress: number | null): number {
  if (status === 'completed') return 100
  if (status === 'failed') return Math.max(0, Math.min(100, progress ?? 0))
  if (status === 'queued') return 0
  return Math.max(0, Math.min(99, progress ?? 0))
}

function computeStatusLabel(status: GeoRunWithScore['status']): string {
  if (status === 'queued') return 'Queued'
  if (status === 'running') return 'Running'
  if (status === 'completed') return 'Completed'
  return 'Failed'
}

function computeStatusDetail(
  status: GeoRunWithScore['status'],
  progressPct: number,
  currentQueryIndex: number,
  queryCount: number,
  isPossiblyStalled: boolean,
  errorMessage: string | null
): string {
  if (status === 'queued') return `Waiting to start (${queryCount} queries)`
  if (status === 'running') {
    const progressText = `${progressPct}% • ${Math.max(0, currentQueryIndex)}/${Math.max(0, queryCount)} queries`
    return isPossiblyStalled ? `Possibly stalled • ${progressText}` : progressText
  }
  if (status === 'completed') return `Finished ${queryCount} queries`
  return errorMessage || 'Run failed before completion'
}

function isValidSurface(value: unknown): value is GeoRunWithScore['surface'] {
  return typeof value === 'string' && isSupportedSurface(value)
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
    const limit = Number(searchParams.get('limit') || '20')
    const offset = Number(searchParams.get('offset') || '0')
    const through = searchParams.get('through') || new Date().toISOString()
    const since = searchParams.get('since')

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (surface && !isSupportedSurface(surface)) {
      return NextResponse.json(
        { error: 'Invalid surface.' },
        { status: 400 }
      )
    }

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000 || !Number.isFinite(Date.parse(through)) || (since && !Number.isFinite(Date.parse(since)))) return NextResponse.json({error:'Invalid history window'}, {status:400})
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
      `, {count:'exact'})
      .eq('property_id', propertyId)
      .is('archived_at', null)
      .or('measurement_mode.is.null,measurement_mode.neq.local_fixture')
      .lte('started_at', through)
      .order('started_at', { ascending: false })
      .order('id', {ascending:false})
      .range(offset, offset + limit - 1)

    if (surface && isSupportedSurface(surface)) {
      query = query.eq('surface', surface)
    }

    if (since) query = query.gte('started_at', since)

    const { data: runs, error, count } = await query

    if (error) {
      console.error('Error fetching runs:', error)
      return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
    }

    // Calculate diffs between consecutive runs
    const runsWithDiffs = (runs || [])
      .map((run): GeoRunWithScore | null => {
      const scoreData = run.geo_scores?.[0]
      // A list-page neighbour may be a different surface, model or question set.
      // Only the summary's captured-source comparison may claim improvement.
      const diff = null

      if (
        !run.id ||
        !run.property_id ||
        !run.started_at ||
        !isValidSurface(run.surface) ||
        !isValidStatus(run.status)
      ) {
        return null
      }

      const progressPct = computeProgressPct(run.status, asNumber(run.progress_pct))
      const currentQueryIndex = asNumber(run.current_query_index) ?? 0
      const lastUpdatedAt = asString(run.last_updated_at)
      const secondsSinceUpdate = lastUpdatedAt
        ? Math.max(0, Math.floor((Date.now() - Date.parse(lastUpdatedAt)) / 1000))
        : null
      const isPossiblyStalled =
        run.status === 'running' && secondsSinceUpdate !== null && secondsSinceUpdate > 180
      const errorMessage = asString(run.error_message)
      const queryCount = run.query_count || 0

      return {
        id: run.id,
        propertyId: run.property_id,
        batchId: asString(run.batch_id),
        surface: run.surface,
        modelName: run.model_name || 'unknown',
        status: run.status,
        queryCount,
        progressPct,
        currentQueryIndex,
        lastUpdatedAt,
        secondsSinceUpdate,
        isPossiblyStalled,
        statusLabel: computeStatusLabel(run.status),
        statusDetail: computeStatusDetail(
          run.status,
          progressPct,
          currentQueryIndex,
          queryCount,
          isPossiblyStalled,
          errorMessage
        ),
        errorMessage,
        usesWebSearch: Boolean(run.uses_web_search),
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
    const summaryBySurface = Object.fromEntries(
      Array.from(
        new Map(
          runsWithDiffs
            .filter(run => run.status === 'completed' && run.score)
            .reverse()
            .map(run => [run.surface, run.score])
        ).entries()
      )
    )

    return NextResponse.json({
      runs: runsWithDiffs,
      total: count ?? 0,
      nextOffset: offset + limit < (count ?? 0) ? offset + limit : null,
      through,
      scope: 'Unarchived, non-synthetic runs in the selected time window. Different sources may not be comparable.',
      summaryScope: 'Latest scored run per surface on this page. Use the headline for property-wide summaries.',
      summary: {
        openai: summaryBySurface.openai || summaryBySurface.chatgpt || null,
        claude: summaryBySurface.claude || null,
        surfaces: summaryBySurface,
        combined: calculateCombinedScore(Object.values(summaryBySurface)),
      },
    })
  } catch (error) {
    console.error('PropertyAudit Runs GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Calculate combined score across surfaces
function calculateCombinedScore(
  scoresInput: Array<GeoRunWithScore['score'] | null | undefined>
): { overallScore: number; visibilityPct: number } | null {
  const scores = scoresInput.filter(Boolean) as NonNullable<GeoRunWithScore['score']>[]
  
  if (scores.length === 0) return null
  
  const avgScore = scores.reduce((sum, s) => sum + s.overallScore, 0) / scores.length
  const avgVisibility = scores.reduce((sum, s) => sum + s.visibilityPct, 0) / scores.length
  
  return {
    overallScore: Math.round(avgScore * 10) / 10,
    visibilityPct: Math.round(avgVisibility * 10) / 10,
  }
}










