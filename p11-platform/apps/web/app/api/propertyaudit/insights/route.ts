/**
 * PropertyAudit Insights API
 * Competitive analysis and domain statistics
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { validatePropertyAccess } from '@/utils/services/auth-guard'

interface InsightCitation {
  domain: string
  is_brand_domain: boolean | null
}

interface InsightAnswer {
  id: string
  presence: boolean
  llm_rank: number | null
  ordered_entities: unknown
  geo_citations: InsightCitation[] | null
}

interface InsightRun {
  id: string
  surface: string | null
  batch_id: string | null
  status: string | null
  started_at: string | null
  finished_at: string | null
  cross_model_analysis: unknown
  geo_answers: InsightAnswer[] | null
}

interface OrderedEntity {
  name: string
  domain: string
  position: number
}

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

    if (!propertyId) {
      return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
    }

    const access = await validatePropertyAccess(user.id, propertyId)
    if (!access.authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get latest completed runs with batch info and cross-model analysis
    let runsQuery = supabase
      .from('geo_runs')
      .select(`
        id,
        surface,
        batch_id,
        status,
        started_at,
        finished_at,
        cross_model_analysis,
        geo_answers (
          id,
          presence,
          llm_rank,
          ordered_entities,
          geo_citations (
            domain,
            is_brand_domain
          )
        )
      `)
      .eq('property_id', propertyId)
      .order('started_at', { ascending: false })
      .limit(10)  // Get more to check batch status

    if (surface === 'openai' || surface === 'claude') {
      runsQuery = runsQuery.eq('surface', surface)
    }

    const { data: allRuns, error: runsError } = await runsQuery
    const typedRuns = (allRuns ?? []) as unknown as InsightRun[]
    
    // Check batch completion status
    const latestBatchId = typedRuns[0]?.batch_id
    let batchComplete = true
    let batchStatus = 'complete'
    
    if (latestBatchId) {
      const batchRuns = typedRuns.filter((run) => run.batch_id === latestBatchId)
      const completedRuns = batchRuns.filter((run) => run.status === 'completed')
      const runningRuns = batchRuns.filter((run) => run.status === 'running')
      
      if (runningRuns.length > 0) {
        batchComplete = false
        batchStatus = 'running'
      } else if (completedRuns.length < batchRuns.length) {
        batchComplete = false
        batchStatus = 'partial'
      }
      
      console.log(`[Insights] Batch ${latestBatchId}: ${completedRuns.length}/${batchRuns.length} complete`)
    }
    
    // Only use completed runs for insights
    const runs = typedRuns.filter((run) => run.status === 'completed')

    if (runsError) {
      console.error('Error fetching runs:', runsError)
      return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 })
    }

    // Aggregate competitor mentions
    const competitorMap = new Map<string, { 
      name: string
      domain: string
      mentions: number[]
      citationCount: number 
    }>()

    const domainMap = new Map<string, { count: number; isBrandDomain: boolean }>()

    runs?.forEach((run) => {
      run.geo_answers?.forEach((answer) => {
        // Process entities
        const entities = parseOrderedEntities(answer.ordered_entities)
        entities.forEach((entity) => {
            // Use domain if available, otherwise use entity name as key
            // This prevents grouping all entities with empty domains together
            const domain = entity.domain && entity.domain.trim() !== '' 
              ? entity.domain 
              : null
            const key = domain || `name:${entity.name}`
            
            if (!competitorMap.has(key)) {
              competitorMap.set(key, {
                name: entity.name,
                domain: domain || 'unknown',
                mentions: [],
                citationCount: 0
              })
            }
            const comp = competitorMap.get(key)!
            comp.mentions.push(entity.position)
        })

        // Process citations
        const citations = parseCitations(answer.geo_citations)
        citations.forEach((citation) => {
            const domain = citation.domain
            if (!domainMap.has(domain)) {
              domainMap.set(domain, {
                count: 0,
                isBrandDomain: Boolean(citation.is_brand_domain)
              })
            }
            domainMap.get(domain)!.count++

            // Update competitor citation count
            if (competitorMap.has(domain)) {
              competitorMap.get(domain)!.citationCount++
            }
        })
      })
    })

    // Format competitors
    const competitors = Array.from(competitorMap.entries())
      .map(([domain, data]) => ({
        name: data.name,
        domain,
        mentionCount: data.mentions.length,
        avgRank: data.mentions.length > 0 
          ? data.mentions.reduce((a, b) => a + b, 0) / data.mentions.length 
          : 0,
        citationCount: data.citationCount
      }))
      .sort((a, b) => b.mentionCount - a.mentionCount)

    // Format domains
    const domains = Array.from(domainMap.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        isBrandDomain: data.isBrandDomain
      }))
      .sort((a, b) => {
        // Brand domains first, then by count
        if (a.isBrandDomain && !b.isBrandDomain) return -1
        if (!a.isBrandDomain && b.isBrandDomain) return 1
        return b.count - a.count
      })

    // Calculate brand Share of Voice
    const totalCitations = domains.reduce((sum, d) => sum + d.count, 0)
    const brandCitations = domains.filter(d => d.isBrandDomain).reduce((sum, d) => sum + d.count, 0)
    const brandSOV = totalCitations > 0 ? (brandCitations / totalCitations) * 100 : 0

    // Extract cross-model analysis from batch runs
    const crossModelAnalysis = typedRuns.find((run) => run.cross_model_analysis)?.cross_model_analysis || null

    return NextResponse.json({
      competitors,
      domains,
      summary: {
        totalCompetitors: competitors.length,
        brandSOV: brandSOV.toFixed(1),
        topCompetitor: competitors[0] || null
      },
      batchStatus: {
        complete: batchComplete,
        status: batchStatus,
        batchId: latestBatchId,
        message: batchComplete 
          ? 'All models complete - insights reflect full cross-model analysis'
          : 'Some models still running - insights may be partial'
      },
      // Cross-model analysis results (if available)
      crossModelAnalysis: crossModelAnalysis ? {
        agreementRate: getAnalysisField(crossModelAnalysis, 'agreement_rate'),
        scoreComparison: getAnalysisField(crossModelAnalysis, 'score_comparison'),
        visibilityComparison: getAnalysisField(crossModelAnalysis, 'visibility_comparison'),
        recommendations: getAnalysisField(crossModelAnalysis, 'recommendations')
      } : null
    })
  } catch (error) {
    console.error('PropertyAudit Insights Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function parseOrderedEntities(value: unknown): OrderedEntity[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      if (typeof record.name !== 'string') return null
      if (typeof record.domain !== 'string') return null
      if (typeof record.position !== 'number') return null
      return {
        name: record.name,
        domain: record.domain,
        position: record.position,
      }
    })
    .filter((entry): entry is OrderedEntity => entry !== null)
}

function parseCitations(value: InsightCitation[] | null): InsightCitation[] {
  if (!Array.isArray(value)) return []
  return value.filter((citation) => typeof citation.domain === 'string' && citation.domain.length > 0)
}

function getAnalysisField(analysis: unknown, field: string): unknown {
  if (!analysis || typeof analysis !== 'object') return null
  return (analysis as Record<string, unknown>)[field] ?? null
}

