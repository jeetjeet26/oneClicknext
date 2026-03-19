/**
 * PropertyAudit Run Details API
 * Get detailed run data with answers
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createServiceClient } from '@/utils/supabase/admin'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export interface GeoAnswer {
  id: string
  queryId: string
  queryText: string
  queryType: string
  presence: boolean
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags: string[]
  answerSummary: string | null
  naturalResponse?: string | null
  analysisMethod?: string | null
  rawResponse?: unknown
  orderedEntities: Array<{
    name: string
    domain: string
    rationale: string
    position: number
  }>
  citations: Array<{
    url: string
    domain: string
    isBrandDomain: boolean
  }>
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toOrderedEntities(value: unknown): GeoAnswer['orderedEntities'] {
  if (!Array.isArray(value)) return []

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      if (
        typeof record.name !== 'string' ||
        typeof record.domain !== 'string' ||
        typeof record.rationale !== 'string' ||
        typeof record.position !== 'number'
      ) {
        return null
      }

      return {
        name: record.name,
        domain: record.domain,
        rationale: record.rationale,
        position: record.position,
      }
    })
    .filter((item): item is GeoAnswer['orderedEntities'][number] => item !== null)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildRunProgress(run: Record<string, unknown>) {
  const status = asString(run.status) || 'queued'
  const rawProgress = asNumber(run.progress_pct) ?? 0
  const progressPct =
    status === 'completed' ? 100 : status === 'running' ? Math.max(0, Math.min(99, rawProgress)) : rawProgress
  const currentQueryIndex = asNumber(run.current_query_index) ?? 0
  const queryCount = asNumber(run.query_count) ?? 0
  const lastUpdatedAt = asString(run.last_updated_at)
  const secondsSinceUpdate = lastUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(lastUpdatedAt)) / 1000))
    : null
  const isPossiblyStalled = status === 'running' && secondsSinceUpdate !== null && secondsSinceUpdate > 180
  const errorMessage = asString(run.error_message)
  const statusDetail =
    status === 'queued'
      ? `Waiting to start (${queryCount} queries)`
      : status === 'running'
      ? `${isPossiblyStalled ? 'Possibly stalled • ' : ''}${progressPct}% • ${currentQueryIndex}/${queryCount} queries`
      : status === 'completed'
      ? `Finished ${queryCount} queries`
      : errorMessage || 'Run failed before completion'

  return {
    progressPct,
    currentQueryIndex,
    lastUpdatedAt,
    secondsSinceUpdate,
    isPossiblyStalled,
    statusDetail,
  }
}

// GET: Get run details with answers
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { runId } = await params
    const service = createServiceClient()

    // Fetch run with score
    const { data: run, error: runError } = await service
      .from('geo_runs')
      .select(`
        *,
        geo_scores (*)
      `)
      .eq('id', runId)
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, run.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch answers with queries and citations
    const { data: answers, error: answersError } = await service
      .from('geo_answers')
      .select(`
        *,
        geo_queries (
          text,
          type,
          geo
        ),
        geo_citations (
          url,
          domain,
          is_brand_domain
        )
      `)
      .eq('run_id', runId)
      .order('created_at', { ascending: true })

    if (answersError) {
      console.error('Error fetching answers:', answersError)
      return NextResponse.json({ error: 'Failed to fetch answers' }, { status: 500 })
    }

    // Format answers
    const formattedAnswers: GeoAnswer[] = (answers || []).map(answer => ({
      id: answer.id,
      queryId: answer.query_id,
      queryText: answer.geo_queries?.text || '',
      queryType: answer.geo_queries?.type || '',
      presence: answer.presence,
      llmRank: answer.llm_rank,
      linkRank: answer.link_rank,
      sov: answer.sov,
      flags: toStringArray(answer.flags),
      answerSummary: answer.answer_summary,
      naturalResponse: answer.natural_response ?? null,
      analysisMethod: answer.analysis_method ?? null,
      orderedEntities: toOrderedEntities(answer.ordered_entities),
      rawResponse: answer.raw_json,
      citations: (answer.geo_citations || []).map((c: Record<string, unknown>) => ({
        url: String(c.url || ''),
        domain: String(c.domain || ''),
        isBrandDomain: Boolean(c.is_brand_domain),
      })),
    }))

    // Group answers by query type
    const answersByType = {
      branded: formattedAnswers.filter(a => a.queryType === 'branded'),
      category: formattedAnswers.filter(a => a.queryType === 'category'),
      comparison: formattedAnswers.filter(a => a.queryType === 'comparison'),
      local: formattedAnswers.filter(a => a.queryType === 'local'),
      faq: formattedAnswers.filter(a => a.queryType === 'faq'),
    }

    // Calculate stats
    const stats = {
      totalQueries: formattedAnswers.length,
      withPresence: formattedAnswers.filter(a => a.presence).length,
      avgLlmRank: calculateAverage(formattedAnswers.filter(a => a.llmRank !== null).map(a => a.llmRank as number)),
      avgLinkRank: calculateAverage(formattedAnswers.filter(a => a.linkRank !== null).map(a => a.linkRank as number)),
      avgSov: calculateAverage(formattedAnswers.filter(a => a.sov !== null).map(a => a.sov as number)),
      flaggedCount: formattedAnswers.filter(a => a.flags.length > 0).length,
    }

    const scoreData = run.geo_scores?.[0]

    return NextResponse.json({
      run: {
        id: run.id,
        propertyId: run.property_id,
        surface: run.surface,
        modelName: run.model_name,
        status: run.status,
        queryCount: run.query_count,
        usesWebSearch: Boolean(run.uses_web_search),
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        errorMessage: run.error_message,
        ...buildRunProgress(run as Record<string, unknown>),
      },
      score: scoreData ? {
        overallScore: scoreData.overall_score,
        visibilityPct: scoreData.visibility_pct,
        avgLlmRank: scoreData.avg_llm_rank,
        avgLinkRank: scoreData.avg_link_rank,
        avgSov: scoreData.avg_sov,
        breakdown: scoreData.breakdown,
      } : null,
      answers: formattedAnswers,
      answersByType,
      stats,
    })
  } catch (error) {
    console.error('PropertyAudit Run Details GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE: Delete a run (cascades to answers/citations/scores)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { runId } = await params
    const service = createServiceClient()

    const { data: run, error: runError } = await service
      .from('geo_runs')
      .select('id, property_id, surface, started_at')
      .eq('id', runId)
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, run.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error: deleteError } = await service
      .from('geo_runs')
      .delete()
      .eq('id', runId)

    if (deleteError) {
      console.error('Error deleting run:', deleteError)
      return NextResponse.json({ error: 'Failed to delete run' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      deletedRunId: runId,
      propertyId: run.property_id,
    })
  } catch (error) {
    console.error('PropertyAudit Run Details DELETE Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function calculateAverage(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
}









