/**
 * PropertyAudit Query Executions API
 * Returns all individual execution data (geo_answers) for a specific query
 * Used to show raw data transparency in the UI
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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
    const { searchParams } = new URL(req.url)
    const limit = Math.min(100, parseInt(searchParams.get('limit') || '50', 10))

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
    const executions: ExecutionData[] = (answers || []).map((answer: any) => ({
      id: answer.id,
      runId: answer.run_id,
      surface: answer.geo_runs?.surface || 'unknown',
      modelName: answer.geo_runs?.model_name || null,
      presence: answer.presence || false,
      llmRank: answer.llm_rank,
      linkRank: answer.link_rank,
      sov: answer.sov,
      flags: answer.flags || [],
      answerSummary: answer.answer_summary,
      orderedEntities: answer.ordered_entities || [],
      citations: (answer.geo_citations || []).map((c: any) => ({
        url: c.url,
        domain: c.domain,
        isBrandDomain: c.is_brand_domain || false
      })),
      createdAt: answer.created_at,
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
