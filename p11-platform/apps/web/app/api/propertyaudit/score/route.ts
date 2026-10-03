/**
 * PropertyAudit Score API
 * Client headline is branded recognition + discovery mention, computed on read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'
import { readMeasurements } from '@/utils/propertyaudit/read-measurements'
import { capturedAnswers, comparableMeasurements } from '@/utils/propertyaudit/measurement-source'
import { getScoreBucket } from '@/utils/propertyaudit/evaluator'
import {
  CLIENT_HEADLINE_SURFACES,
  buildClientHeadline,
  isClientHeadlineSurface,
  type ClientHeadline,
} from '@/utils/propertyaudit/client-headline'
import { aggregateAnswersByQuery, type ReportAnswer, type ReportQuery } from '@/utils/propertyaudit/reporting'
import { getSurfaceLabel, isSupportedSurface, type Surface } from '@/utils/propertyaudit/types'

export interface GeoScoreSummary {
  propertyId: string
  overallScore: number
  visibilityPct: number
  brandedRecognitionPct: number | null
  discoveryMentionPct: number | null
  citationQuality: number | null
  ownedCitationPct: number | null
  genericCityMentionPct: number | null
  scoreBucket: 'excellent' | 'good' | 'fair' | 'poor'
  surfaces: Partial<Record<Surface, SurfaceScore | null>>
  surfaceSummaries: Array<{
    surface: Surface
    label: string
    score: number | null
    visibilityPct: number | null
    brandedRecognitionPct: number | null
    discoveryMentionPct: number | null
    citationQuality: number | null
    ownedCitationPct: number | null
    measured: boolean
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
    metric: 'discoveryMentionPct' | 'citationQuality'
  } | null
}

interface SurfaceScore {
  overallScore: number
  visibilityPct: number
  brandedRecognitionPct: number | null
  discoveryMentionPct: number | null
  citationQuality: number | null
  ownedCitationPct: number | null
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
  breakdown?: unknown
}

type GeoRunWithScores = {
  id: string
  surface: string | null
  started_at: string | null
  geo_scores: GeoScoreRow[] | null
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const propertyId = req.nextUrl.searchParams.get('propertyId')
    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const source = await readMeasurements(user.id, propertyId, {kind: 'summary'})
    if (source.state !== 'ready') return NextResponse.json({error: 'Audit measurements are unavailable', state: source.state}, {status: source.state === 'forbidden' ? 403 : 409})
    const latestRunsBySurface = new Map<Surface, GeoRunWithScores>()
    const previousRunsBySurface = new Map<Surface, GeoRunWithScores>()
    for (const entry of source.runs) {
      const run = {...entry.run, geo_scores: entry.scores}
      const surface = run.surface
      if (!isClientHeadlineSurface(surface) || !isSupportedSurface(surface)) continue
      if (!latestRunsBySurface.has(surface)) latestRunsBySurface.set(surface, run)
      else if (!previousRunsBySurface.has(surface)) previousRunsBySurface.set(surface, run)
    }
    const latestRunIds = [...latestRunsBySurface.values()].map(run => run.id)
    const { answers: rawAnswers, queries } = capturedAnswers(source.runs)
    const comparable = comparableMeasurements(source.runs.filter(r => latestRunIds.includes(r.run.id)), source.runs.filter(r => [...previousRunsBySurface.values()].some(p => p.id === r.run.id)))
    const latestHeadline = buildHeadlineForRuns(latestRunsBySurface, rawAnswers, queries)
    if (!latestHeadline || latestRunIds.length === 0) {
      return NextResponse.json({
        score: null,
        message: 'No completed runs found. Run an audit first.',
      }, { headers: NO_STORE_HEADERS })
    }

    const previousHeadline = previousRunsBySurface.size > 0
      ? buildHeadlineForRuns(previousRunsBySurface, rawAnswers, queries)
      : null

    const surfaces = Object.fromEntries(
      Array.from(latestRunsBySurface.entries()).map(([surface, run]) => {
        const surfaceHeadline = latestHeadline.surfaces.find(item => item.surface === surface)
        const stored = run.geo_scores?.[0]
        return [surface, {
          overallScore: surfaceHeadline?.citationQuality ?? stored?.overall_score ?? 0,
          visibilityPct: surfaceHeadline?.discoveryMentionPct ?? stored?.visibility_pct ?? 0,
          brandedRecognitionPct: surfaceHeadline?.brandedRecognitionPct ?? null,
          discoveryMentionPct: surfaceHeadline?.discoveryMentionPct ?? null,
          citationQuality: surfaceHeadline?.citationQuality ?? null,
          ownedCitationPct: surfaceHeadline?.ownedCitationPct ?? null,
          avgLlmRank: averageNullable(
            rawAnswers.filter(answer => answer.run_id === run.id).map(answer => answer.llm_rank)
          ) ?? stored?.avg_llm_rank ?? null,
          avgLinkRank: stored?.avg_link_rank ?? null,
          avgSov: stored?.avg_sov ?? null,
          runId: run.id,
          runAt: run.started_at || '',
        } satisfies SurfaceScore]
      })
    ) as Partial<Record<Surface, SurfaceScore | null>>

    const surfaceSummaries = CLIENT_HEADLINE_SURFACES.map(surface => {
      const measured = latestHeadline.surfaces.find(item => item.surface === surface)
      return {
        surface,
        label: getSurfaceLabel(surface),
        score: measured?.citationQuality ?? null,
        visibilityPct: measured?.discoveryMentionPct ?? null,
        brandedRecognitionPct: measured?.brandedRecognitionPct ?? null,
        discoveryMentionPct: measured?.discoveryMentionPct ?? null,
        citationQuality: measured?.citationQuality ?? null,
        ownedCitationPct: measured?.ownedCitationPct ?? null,
        measured: Boolean(measured),
      }
    })

    const citationQuality = latestHeadline.citationQuality ?? 0
    const lastRunAt = Array.from(latestRunsBySurface.values())
      .map(run => run.started_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null

    const summary: GeoScoreSummary = {
      propertyId,
      overallScore: citationQuality,
      visibilityPct: latestHeadline.discoveryMentionPct ?? 0,
      brandedRecognitionPct: latestHeadline.brandedRecognitionPct,
      discoveryMentionPct: latestHeadline.discoveryMentionPct,
      citationQuality: latestHeadline.citationQuality,
      ownedCitationPct: latestHeadline.ownedCitationPct,
      genericCityMentionPct: latestHeadline.genericCityMentionPct,
      scoreBucket: getScoreBucket(citationQuality),
      surfaces,
      surfaceSummaries,
      breakdown: latestHeadline.breakdown,
      lastRunAt,
      trend: comparable ? buildHeadlineTrend(latestHeadline, previousHeadline) : null,
    }

    return NextResponse.json({ score: summary, scope: source.scope, comparisonAvailable: comparable, coverage: source.runs.filter(r => latestRunIds.includes(r.run.id)).map(r => ({ runId: r.run.id, surface: r.run.surface, capturedExecutions: r.items.length || null, retainedAnswers: r.answers.length, originalContextRetained: Boolean(r.job && r.items.length) })) }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error('PropertyAudit Score GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function averageNullable(values: Array<number | null | undefined>): number | null {
  const numeric = values.filter((value): value is number => typeof value === 'number')
  if (numeric.length === 0) return null
  return Math.round((numeric.reduce((sum, value) => sum + value, 0) / numeric.length) * 100) / 100
}

function buildHeadlineForRuns(
  runsBySurface: Map<Surface, GeoRunWithScores>,
  rawAnswers: ReportAnswer[],
  queries: ReportQuery[]
): ClientHeadline | null {
  const collapsedBySurface = Array.from(runsBySurface.entries()).map(([surface, run]) => {
    const runAnswers = rawAnswers.filter(answer => answer.run_id === run.id)
    return {
      surface,
      answers: aggregateAnswersByQuery(runAnswers, queries, new Map()),
    }
  }).filter(entry => entry.answers.length > 0)

  if (collapsedBySurface.length === 0) return null
  return buildClientHeadline(collapsedBySurface, queries)
}

function buildHeadlineTrend(
  latest: ClientHeadline,
  previous: ClientHeadline | null
): GeoScoreSummary['trend'] {
  if (!previous) return null
  const metric = latest.discoveryMentionPct != null && previous.discoveryMentionPct != null
    ? 'discoveryMentionPct'
    : 'citationQuality'
  const current = latest[metric]
  const prior = previous[metric]
  if (current == null || prior == null) return null
  const changePercent = Math.round((current - prior) * 10) / 10
  const direction: 'up' | 'down' | 'stable' = changePercent > 1 ? 'up' : changePercent < -1 ? 'down' : 'stable'
  return { direction, changePercent, metric }
}
