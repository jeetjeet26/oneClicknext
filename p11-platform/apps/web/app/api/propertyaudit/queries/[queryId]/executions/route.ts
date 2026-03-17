/**
 * PropertyAudit Query Executions API
 * Returns all individual execution data (geo_answers) for a specific query
 * Used to show raw data transparency in the UI
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

export interface ExecutionData {
  id: string
  runId: string
  surface: string
  modelName: string | null
  presence: boolean
  llmRank: number | null
  linkRank: number | null
  sov: number | null
  flags: string[]
  answerSummary: string | null
  orderedEntities: Array<{
    name: string
    domain: string
    position: number
    rationale?: string | null
  }>
  citations: Array<{
    url: string
    domain: string
    isBrandDomain: boolean
  }>
  createdAt: string
  analysisMethod: string | null
  naturalResponse: string | null
}

export interface ExecutionAggregates {
  totalExecutions: number
  presenceRate: number
  medianLlmRank: number | null
  medianLinkRank: number | null
  medianSov: number | null
  surfaces: Record<string, number>
}

interface ExecutionAnswerRow {
  id: string
  run_id: string
  presence: boolean
  llm_rank: number | null
  link_rank: number | null
  sov: number | null
  flags: unknown
  answer_summary: string | null
  ordered_entities: unknown
  analysis_method: string | null
  natural_response: string | null
  created_at: string | null
  geo_runs:
    | {
        id: string
        surface: string | null
        model_name: string | null
        execution_count?: number | null
      }
    | null
  geo_citations:
    | Array<{
        url: string
        domain: string
        is_brand_domain: boolean | null
      }>
    | null
}

// GET /api/propertyaudit/queries/[queryId]/executions
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ queryId: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { queryId } = await params
    const { searchParams } = req.nextUrl
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '50', 10)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 50

    const { data: query, error: queryError } = await supabase
      .from('geo_queries')
      .select('property_id')
      .eq('id', queryId)
      .single()

    if (queryError || !query) {
      return NextResponse.json({ error: 'Query not found' }, { status: 404 })
    }

    const access = await validatePropertyAccess(user.id, query.property_id)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch all answers for this query with run info and citations
    const { data: answers, error: answersError } = await supabase
      .from('geo_answers')
      .select(`
        id,
        run_id,
        presence,
        llm_rank,
        link_rank,
        sov,
        flags,
        answer_summary,
        ordered_entities,
        analysis_method,
        natural_response,
        created_at,
        geo_runs!inner (
          id,
          surface,
          model_name,
          execution_count
        ),
        geo_citations (
          url,
          domain,
          is_brand_domain
        )
      `)
      .eq('query_id', queryId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (answersError) {
      console.error('Error fetching executions:', answersError)
      return NextResponse.json({ error: 'Failed to fetch executions' }, { status: 500 })
    }

    // Transform to API response format
    const executions: ExecutionData[] = ((answers || []) as unknown as ExecutionAnswerRow[]).map((answer) => ({
      id: answer.id,
      runId: answer.run_id,
      surface: answer.geo_runs?.surface || 'unknown',
      modelName: answer.geo_runs?.model_name || null,
      presence: Boolean(answer.presence),
      llmRank: answer.llm_rank,
      linkRank: answer.link_rank,
      sov: answer.sov,
      flags: Array.isArray(answer.flags)
        ? answer.flags.filter((flag): flag is string => typeof flag === 'string')
        : [],
      answerSummary: answer.answer_summary,
      orderedEntities: parseOrderedEntities(answer.ordered_entities),
      citations: (answer.geo_citations || []).map((citation) => ({
        url: citation.url,
        domain: citation.domain,
        isBrandDomain: Boolean(citation.is_brand_domain),
      })),
      createdAt: answer.created_at || new Date(0).toISOString(),
      analysisMethod: answer.analysis_method,
      naturalResponse: answer.natural_response
    }))

    // Calculate aggregates
    const aggregates = calculateAggregates(executions)

    return NextResponse.json({
      success: true,
      queryId,
      executions,
      aggregates
    })
  } catch (error) {
    console.error('PropertyAudit Executions GET Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function calculateAggregates(executions: ExecutionData[]): ExecutionAggregates {
  if (executions.length === 0) {
    return {
      totalExecutions: 0,
      presenceRate: 0,
      medianLlmRank: null,
      medianLinkRank: null,
      medianSov: null,
      surfaces: {}
    }
  }

  // Count presence
  const presenceCount = executions.filter(e => e.presence).length
  const presenceRate = presenceCount / executions.length

  // Collect non-null values for median calculations
  const llmRanks = executions.map(e => e.llmRank).filter((r): r is number => r !== null)
  const linkRanks = executions.map(e => e.linkRank).filter((r): r is number => r !== null)
  const sovs = executions.map(e => e.sov).filter((s): s is number => s !== null)

  // Count by surface
  const surfaces: Record<string, number> = {}
  executions.forEach(e => {
    surfaces[e.surface] = (surfaces[e.surface] || 0) + 1
  })

  return {
    totalExecutions: executions.length,
    presenceRate: Math.round(presenceRate * 100) / 100,
    medianLlmRank: median(llmRanks),
    medianLinkRank: median(linkRanks),
    medianSov: median(sovs),
    surfaces
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function parseOrderedEntities(value: unknown): ExecutionData['orderedEntities'] {
  if (!Array.isArray(value)) return []

  return value.reduce<ExecutionData['orderedEntities']>((acc, entry) => {
    if (!entry || typeof entry !== 'object') return acc
      const record = entry as Record<string, unknown>
    if (
      typeof record.name !== 'string' ||
      typeof record.domain !== 'string' ||
      typeof record.position !== 'number'
    ) {
      return acc
    }
    acc.push({
        name: record.name,
        domain: record.domain,
        position: record.position,
        rationale: typeof record.rationale === 'string' ? record.rationale : null,
    })
    return acc
  }, [])
}
