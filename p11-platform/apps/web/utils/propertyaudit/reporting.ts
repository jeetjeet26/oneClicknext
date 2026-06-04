import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { generateRecommendations } from './recommendation-engine'
import { auditPublicSiteForProperty, type PublicSiteAudit } from './public-site-audit'
import { getGeoConfig, getSurfaceLabel, getSurfaceMeasurementNote } from './types'

type SupabaseClient = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => any
}

export type ReportRun = {
  id: string
  surface: string
  model_name?: string | null
  status?: string | null
  batch_id?: string | null
  started_at?: string | null
  finished_at?: string | null
  geo_scores?: Array<{
    overall_score: number
    visibility_pct: number
    avg_llm_rank: number | null
    avg_link_rank: number | null
    avg_sov: number | null
    breakdown?: {
      position: number
      link: number
      sov: number
      accuracy: number
    }
  }>
}

type ReportScore = NonNullable<ReportRun['geo_scores']>[number]

export type ReportAnswer = {
  id: string
  query_id?: string | null
  presence: boolean
  presence_rate?: number | null
  citation_consistency?: number | null
  answer_drift?: number | null
  llm_rank: number | null
  link_rank: number | null
  sov: number | null
  run_count?: number | null
  flags?: string[]
  analysis_method?: string | null
  natural_response?: string | null
  answer_summary?: string | null
  created_at?: string | null
  ordered_entities?: Array<{
    name: string
    domain: string
    position: number
    rationale?: string | null
  }>
  geo_queries?: {
    id: string
    text: string
    type: string
  }
  geo_citations?: Array<{
    url: string
    domain: string
    is_brand_domain?: boolean | null
  }>
  ai_overview_visible?: boolean
  ai_overview_source?: string | null
}

export type ReportQuery = {
  id: string
  text: string
  type: string
  geo?: string | null
  run_count?: number | null
}

export type ReportGlossaryEntry = {
  term: string
  definition: string
  formula?: string
  interpretation?: string
}

export type ReportInsights = {
  highlights: string[]
  risks: string[]
  opportunities: string[]
  summaryStats: Array<{ label: string; value: string }>
}

export type ReportCharts = {
  scoreTrend: string
  visibilityTrend: string
  queryTypeBar: string
  recommendationBar: string
  competitorBar: string
}

export type ReportRecommendationSummary = {
  total: number
  high: number
  medium: number
  low: number
  byType: Record<string, number>
}

export type ReportCompetitor = {
  name: string
  domain: string
  mentionCount: number
  avgRank: number
  ambiguityReason?: string
}

export type ReportData = {
  property: { name?: string | null; address?: any; website_url?: string | null } | null
  runs: ReportRun[]
  surfaceSummaries: Array<{
    surface: string
    label: string
    measurementNote: string
    lastRunAt: string | null
    overallScore: number | null
    visibilityPct: number | null
  }>
  siteAudit: PublicSiteAudit
  queries: ReportQuery[]
  answers: ReportAnswer[]
  competitors: ReportCompetitor[]
  scores: ReportScore[]
  recommendationSummary: ReportRecommendationSummary
  recommendations: Awaited<ReturnType<typeof generateRecommendations>>['recommendations']
  queryTypeStats: Array<{ type: string; total: number; presencePct: number; avgRank: number | null; avgSov: number | null }>
  rankSummary: {
    brandedRecognitionPct: number | null
    nonBrandedDiscoveryRank: number | null
    nonBrandedVisibilityPct: number | null
    comparisonAvgRank: number | null
  }
  citationSummary: { total: number; brandPct: number; topDomains: Array<{ domain: string; count: number }> }
  aiOverviewSummary: { totalTracked: number; visibleCount: number; visibilityPct: number; byType: Array<{ type: string; visiblePct: number }> }
  trends: Array<{ label: string; score: number | null; visibility: number | null }>
  glossary: ReportGlossaryEntry[]
  insights: ReportInsights
  narrative?: string | null
}

const DEFAULT_RUN_WINDOW = 6

export async function buildPropertyReportData(
  supabase: SupabaseClient,
  propertyId: string,
  options: { batchId?: string | null } = {}
): Promise<ReportData> {
  const runWindow = Math.max(2, parseInt(process.env.PROPERTYAUDIT_REPORT_RUN_WINDOW || `${DEFAULT_RUN_WINDOW}`, 10))

  const { data: property } = await supabase
    .from('properties')
    .select('name, address, website_url')
    .eq('id', propertyId)
    .single()

  let runsQuery = supabase
    .from('geo_runs')
    .select('id, surface, batch_id, model_name, status, started_at, finished_at, geo_scores(*)')
    .eq('property_id', propertyId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false })

  if (options.batchId) {
    runsQuery = runsQuery.eq('batch_id', options.batchId)
  } else {
    runsQuery = runsQuery.limit(runWindow)
  }

  const { data: runs } = await runsQuery

  const { data: queries } = await supabase
    .from('geo_queries')
    .select('id, text, type, geo, run_count')
    .eq('property_id', propertyId)
    .eq('is_active', true)

  const reportRuns = (runs || []) as ReportRun[]
  const reportQueries = (queries || []) as ReportQuery[]
  const runIds = reportRuns.map((r) => r.id)
  let rawAnswers: ReportAnswer[] = []
  if (runIds.length > 0) {
    const { data } = await supabase
      .from('geo_answers')
      .select('*, geo_queries (id, text, type), geo_citations (url, domain, is_brand_domain)')
      .in('run_id', runIds)
    rawAnswers = (data || []) as ReportAnswer[]
  }

  const aiOverviewMap = await fetchAiOverviews(supabase, propertyId, reportQueries.map((q) => q.id))
  const aggregatedAnswers = aggregateAnswersByQuery(rawAnswers, reportQueries, aiOverviewMap)

  const competitors = buildCompetitorsFromAnswers(rawAnswers, {
    propertyName: property?.name || null,
    websiteUrl: property?.website_url || null,
  })

  const scores = buildReportScores(reportRuns)

  const recommendationsResult = await generateRecommendations(propertyId, {
    batchId: options.batchId || null,
    runIds,
  })
  const recommendationSummary = buildRecommendationSummary(recommendationsResult.recommendations)

  const queryTypeStats = buildQueryTypeStats(aggregatedAnswers)
  const rankSummary = buildRankSummary(aggregatedAnswers)
  const citationSummary = buildCitationSummary(rawAnswers)
  const aiOverviewSummary = buildAiOverviewSummary(reportQueries, aiOverviewMap)
  const trends = buildTrends(reportRuns)
  const glossary = buildGlossary()
  const insightsBlock = buildInsights({
    propertyName: property?.name || 'Property',
    scores,
    trends,
    queryTypeStats,
    rankSummary,
    citationSummary,
    recommendationSummary,
    competitors,
    aiOverviewSummary
  })

  const narrative = await maybeGenerateNarrative({
    propertyName: property?.name || 'Property',
    insights: insightsBlock,
    recommendationSummary,
    trends,
    queryTypeStats,
    rankSummary,
    citationSummary,
    competitors,
    aiOverviewSummary
  })

  return {
    property: property || null,
    runs: runs || [],
    surfaceSummaries: buildSurfaceSummaries(runs || []),
    siteAudit: await auditPublicSiteForProperty(supabase, propertyId, property?.website_url || null),
    queries: queries || [],
    answers: aggregatedAnswers,
    competitors,
    scores,
    rankSummary,
    recommendationSummary,
    recommendations: recommendationsResult.recommendations,
    queryTypeStats,
    citationSummary,
    aiOverviewSummary,
    trends,
    glossary,
    insights: insightsBlock,
    narrative
  }
}

export async function buildRunReportData(
  supabase: SupabaseClient,
  runId: string
): Promise<ReportData | null> {
  const { data: run, error: runError } = await supabase
    .from('geo_runs')
    .select(`
      *,
      properties (name, address, website_url),
      geo_scores (*),
      geo_answers (
        *,
        geo_queries (id, text, type),
        geo_citations (url, domain, is_brand_domain)
      )
    `)
    .eq('id', runId)
    .single()

  if (runError || !run) return null

  const propertyId = run.property_id as string
  const recommendationsResult = await generateRecommendations(propertyId, runId)
  const recommendationSummary = buildRecommendationSummary(recommendationsResult.recommendations)

  const rawAnswers = run.geo_answers || []
  const queries = (run.geo_answers || [])
    .map((a: any) => a.geo_queries)
    .filter(Boolean)
  const uniqueQueries = new Map<string, ReportQuery>()
  queries.forEach((q: ReportQuery) => {
    if (q?.id) uniqueQueries.set(q.id, q)
  })

  const scores = run.geo_scores ? [run.geo_scores[0]] : []
  const runs = [{
    id: run.id,
    surface: run.surface,
    model_name: run.model_name,
    status: run.status,
    started_at: run.started_at,
    finished_at: run.finished_at,
    geo_scores: run.geo_scores
  }] as ReportRun[]

  const aiOverviewMap = await fetchAiOverviews(supabase, propertyId, Array.from(uniqueQueries.keys()))
  const aggregatedAnswers = aggregateAnswersByQuery(rawAnswers, Array.from(uniqueQueries.values()), aiOverviewMap)
  const competitors = buildCompetitorsFromAnswers(rawAnswers, {
    propertyName: (run.properties as any)?.name || null,
    websiteUrl: (run.properties as any)?.website_url || null,
  })
  const queryTypeStats = buildQueryTypeStats(aggregatedAnswers)
  const rankSummary = buildRankSummary(aggregatedAnswers)
  const citationSummary = buildCitationSummary(rawAnswers)
  const aiOverviewSummary = buildAiOverviewSummary(Array.from(uniqueQueries.values()), aiOverviewMap)
  const trends = buildTrends(runs)
  const glossary = buildGlossary()

  const insightsBlock = buildInsights({
    propertyName: run.properties?.name || 'Property',
    scores,
    trends,
    queryTypeStats,
    rankSummary,
    citationSummary,
    recommendationSummary,
    competitors,
    aiOverviewSummary
  })

  const narrative = await maybeGenerateNarrative({
    propertyName: run.properties?.name || 'Property',
    insights: insightsBlock,
    recommendationSummary,
    trends,
    queryTypeStats,
    rankSummary,
    citationSummary,
    competitors,
    aiOverviewSummary
  })

  return {
    property: run.properties || null,
    runs,
    surfaceSummaries: buildSurfaceSummaries(runs),
    siteAudit: await auditPublicSiteForProperty(supabase, propertyId, (run.properties as any)?.website_url || null),
    queries: Array.from(uniqueQueries.values()),
    answers: aggregatedAnswers,
    competitors,
    scores,
    rankSummary,
    recommendationSummary,
    recommendations: recommendationsResult.recommendations,
    queryTypeStats,
    citationSummary,
    aiOverviewSummary,
    trends,
    glossary,
    insights: insightsBlock,
    narrative
  }
}

export function buildCharts(data: {
  trends: ReportData['trends']
  queryTypeStats: ReportData['queryTypeStats']
  recommendationSummary: ReportData['recommendationSummary']
  competitors: ReportData['competitors']
}): ReportCharts {
  const scoreTrend = renderLineChart(
    data.trends.map(t => t.score ?? null),
    data.trends.map(t => t.label),
    'GEO Score Over Time (0-100)'
  )

  const visibilityTrend = renderLineChart(
    data.trends.map(t => t.visibility ?? null),
    data.trends.map(t => t.label),
    'Query Presence Over Time (%)'
  )

  const queryTypeBar = renderBarChart(
    data.queryTypeStats.map(t => ({ label: t.type, value: t.presencePct })),
    'Query Presence Rate by Type (%)'
  )

  const recommendationBar = renderBarChart(
    [
      { label: 'High', value: data.recommendationSummary.high },
      { label: 'Medium', value: data.recommendationSummary.medium },
      { label: 'Low', value: data.recommendationSummary.low }
    ],
    'Recommendations by Priority'
  )

  const competitorBar = renderBarChart(
    data.competitors.slice(0, 6).map(c => ({ label: c.name, value: c.mentionCount })),
    'Competitor / Entity Mentions'
  )

  return { scoreTrend, visibilityTrend, queryTypeBar, recommendationBar, competitorBar }
}

function buildTrends(runs: ReportRun[]): Array<{ label: string; score: number | null; visibility: number | null }> {
  const batches = new Map<string, { startedAt: string | null; scores: number[]; visibility: number[] }>()

  runs.forEach(run => {
    const score = run.geo_scores?.[0]
    if (!score) return
    const batchKey = run.batch_id || run.id
    const entry = batches.get(batchKey) || { startedAt: run.started_at || null, scores: [], visibility: [] }
    if (
      run.started_at &&
      (!entry.startedAt || new Date(run.started_at).getTime() < new Date(entry.startedAt).getTime())
    ) {
      entry.startedAt = run.started_at
    }
    entry.scores.push(score.overall_score)
    entry.visibility.push(score.visibility_pct)
    batches.set(batchKey, entry)
  })

  return Array.from(batches.values())
    .sort((a, b) => {
      const aTime = new Date(a.startedAt || 0).getTime()
      const bTime = new Date(b.startedAt || 0).getTime()
      return aTime - bTime
    })
    .map(batch => ({
      label: formatShortDate(batch.startedAt),
      score: batch.scores.length > 0 ? average(batch.scores) : null,
      visibility: batch.visibility.length > 0 ? average(batch.visibility) : null
    }))
}

export function aggregateAnswersByQuery(
  answers: ReportAnswer[],
  queries: ReportQuery[],
  aiOverviewMap: Map<string, { visible: boolean; source_url?: string | null }>
): ReportAnswer[] {
  const queryMap = new Map<string, ReportQuery>()
  queries.forEach(query => queryMap.set(query.id, query))

  const answersByQuery = new Map<string, ReportAnswer[]>()
  answers.forEach(answer => {
    const queryId = answer.query_id || answer.geo_queries?.id
    if (!queryId) return
    if (!answersByQuery.has(queryId)) answersByQuery.set(queryId, [])
    answersByQuery.get(queryId)!.push(answer)
  })

  return Array.from(answersByQuery.entries()).map(([queryId, group]) => {
    const query = queryMap.get(queryId)
    const runCount = query?.run_count || 1
    const presenceValues = group.map(a => (a.presence ? 1 : 0))
    const presenceRate = presenceValues.length > 0 ? average(presenceValues) : 0
    const presence = median(presenceValues) >= 0.5
    const llmRanks = group.map(a => a.llm_rank).filter(isNumber)
    const linkRanks = group.map(a => a.link_rank).filter(isNumber)
    const sovs = group.map(a => a.sov).filter(isNumber)
    const sortedByTime = [...group].sort((a, b) => {
      const aTime = new Date(a.created_at || 0).getTime()
      const bTime = new Date(b.created_at || 0).getTime()
      return bTime - aTime
    })
    const latest = sortedByTime[0]
    const flags = summarizeFlags(group)
    const aiOverview = aiOverviewMap.get(queryId)
    const applicableSov = query?.type ? isSovApplicable(query.type) : true

    return {
      id: queryId,
      query_id: queryId,
      presence,
      presence_rate: presenceRate,
      citation_consistency: calculateCitationConsistency(group),
      answer_drift: calculateAnswerDrift(group),
      llm_rank: llmRanks.length > 0 ? median(llmRanks) : null,
      link_rank: linkRanks.length > 0 ? median(linkRanks) : null,
      sov: applicableSov && sovs.length > 0 ? median(sovs) : null,
      run_count: runCount,
      flags,
      analysis_method: latest?.analysis_method,
      natural_response: latest?.natural_response,
      answer_summary: latest?.answer_summary,
      created_at: latest?.created_at,
      ordered_entities: latest?.ordered_entities,
      geo_queries: {
        id: queryId,
        text: query?.text || latest?.geo_queries?.text || '',
        type: query?.type || latest?.geo_queries?.type || 'unknown'
      },
      geo_citations: latest?.geo_citations || [],
      ai_overview_visible: aiOverview?.visible || false,
      ai_overview_source: aiOverview?.source_url || null
    }
  })
}

function buildSurfaceSummaries(runs: ReportRun[]) {
  return getLatestScoredRunsBySurface(runs).map(run => ({
    surface: run.surface,
    label: getSurfaceLabel(run.surface),
    measurementNote: getSurfaceMeasurementNote(run.surface),
    lastRunAt: run.started_at || null,
    overallScore: run.geo_scores?.[0]?.overall_score ?? null,
    visibilityPct: run.geo_scores?.[0]?.visibility_pct ?? null,
  }))
}

function getLatestScoredRunsBySurface(runs: ReportRun[]): ReportRun[] {
  const bySurface = new Map<string, ReportRun>()
  runs.forEach(run => {
    if (!run.surface || !run.geo_scores?.[0]) return
    const existing = bySurface.get(run.surface)
    if (!existing) {
      bySurface.set(run.surface, run)
      return
    }

    const currentTime = run.started_at ? new Date(run.started_at).getTime() : 0
    const existingTime = existing.started_at ? new Date(existing.started_at).getTime() : 0
    if (currentTime > existingTime) {
      bySurface.set(run.surface, run)
    }
  })
  return Array.from(bySurface.values())
}

export function buildReportScores(runs: ReportRun[]): ReportScore[] {
  const surfaceScores = getLatestScoredRunsBySurface(runs)
    .map(run => run.geo_scores?.[0])
    .filter(Boolean) as ReportScore[]

  if (surfaceScores.length <= 1) return surfaceScores

  const averageNullable = (values: Array<number | null | undefined>) => {
    const numeric = values.filter(isNumber)
    return numeric.length > 0 ? average(numeric) : null
  }
  const averageBreakdown = (key: keyof NonNullable<ReportScore['breakdown']>) =>
    averageNullable(surfaceScores.map(score => score.breakdown?.[key])) ?? 0

  return [{
    overall_score: average(surfaceScores.map(score => score.overall_score)),
    visibility_pct: average(surfaceScores.map(score => score.visibility_pct)),
    avg_llm_rank: averageNullable(surfaceScores.map(score => score.avg_llm_rank)),
    avg_link_rank: averageNullable(surfaceScores.map(score => score.avg_link_rank)),
    avg_sov: averageNullable(surfaceScores.map(score => score.avg_sov)),
    breakdown: {
      position: averageBreakdown('position'),
      link: averageBreakdown('link'),
      sov: averageBreakdown('sov'),
      accuracy: averageBreakdown('accuracy'),
    },
  }]
}

async function fetchAiOverviews(
  supabase: SupabaseClient,
  propertyId: string,
  queryIds: string[]
): Promise<Map<string, { visible: boolean; source_url?: string | null }>> {
  const map = new Map<string, { visible: boolean; source_url?: string | null }>()
  
  // Fetch ALL AI Overview data for the property, not just for specific queryIds
  // This allows AI Overview visibility to work independently of historical runs
  const { data } = await supabase
    .from('geo_ai_overviews')
    .select('query_id, visible, source_url, observed_at, geo_queries(id, text, type)')
    .eq('property_id', propertyId)
    .order('observed_at', { ascending: false })

  // Build map, keeping only the latest observation per query
  // Include all queries, even those that may have been deleted
  ;(data || []).forEach((row: any) => {
    const queryId = row.query_id
    if (!queryId) return
    
    if (!map.has(queryId)) {
      map.set(queryId, { 
        visible: !!row.visible, 
        source_url: row.source_url 
      })
    }
  })

  return map
}

function buildAiOverviewSummary(
  queries: ReportQuery[],
  aiOverviewMap: Map<string, { visible: boolean; source_url?: string | null }>
) {
  const byType = new Map<string, { total: number; visible: number }>()
  queries.forEach(query => {
    const entry = byType.get(query.type) || { total: 0, visible: 0 }
    entry.total += 1
    if (aiOverviewMap.get(query.id)?.visible) entry.visible += 1
    byType.set(query.type, entry)
  })

  const totals = Array.from(byType.values()).reduce((acc, curr) => {
    acc.total += curr.total
    acc.visible += curr.visible
    return acc
  }, { total: 0, visible: 0 })

  return {
    totalTracked: totals.total,
    visibleCount: totals.visible,
    visibilityPct: totals.total > 0 ? Math.round((totals.visible / totals.total) * 100) : 0,
    byType: Array.from(byType.entries()).map(([type, entry]) => ({
      type,
      visiblePct: entry.total > 0 ? Math.round((entry.visible / entry.total) * 100) : 0
    }))
  }
}

function buildQueryTypeStats(answers: ReportAnswer[]) {
  const statsByType = new Map<string, { total: number; presenceRates: number[]; ranks: number[]; sovs: number[] }>()

  answers.forEach(answer => {
    const queryType = answer.geo_queries?.type || 'unknown'
    const entry = statsByType.get(queryType) || { total: 0, presenceRates: [], ranks: [], sovs: [] }
    entry.total += 1
    if (typeof answer.presence_rate === 'number') {
      entry.presenceRates.push(answer.presence_rate)
    } else {
      entry.presenceRates.push(answer.presence ? 1 : 0)
    }
    if (typeof answer.llm_rank === 'number') entry.ranks.push(answer.llm_rank)
    if (typeof answer.sov === 'number' && isSovApplicable(queryType)) entry.sovs.push(answer.sov)
    statsByType.set(queryType, entry)
  })

  return Array.from(statsByType.entries()).map(([type, entry]) => {
    const presencePct = entry.presenceRates.length > 0
      ? Math.round(average(entry.presenceRates) * 100)
      : 0
    return {
      type,
      total: entry.total,
      presencePct,
      avgRank: type === 'branded' ? null : entry.ranks.length > 0 ? average(entry.ranks) : null,
      avgSov: isSovApplicable(type) && entry.sovs.length > 0 ? average(entry.sovs) : null
    }
  })
}

function buildRankSummary(answers: ReportAnswer[]): ReportData['rankSummary'] {
  const brandedAnswers = answers.filter(answer => answer.geo_queries?.type === 'branded')
  const discoveryAnswers = answers.filter(answer =>
    answer.geo_queries?.type === 'category' ||
    answer.geo_queries?.type === 'local' ||
    answer.geo_queries?.type === 'comparison'
  )
  const comparisonAnswers = answers.filter(answer => answer.geo_queries?.type === 'comparison')

  const brandedRecognitionPct = brandedAnswers.length > 0
    ? Math.round(average(brandedAnswers.map(answer => answer.presence_rate ?? (answer.presence ? 1 : 0))) * 100)
    : null
  const discoveryRanks = discoveryAnswers
    .map(answer => answer.llm_rank)
    .filter(isNumber)
  const discoveryPresenceRates = discoveryAnswers.map(answer => answer.presence_rate ?? (answer.presence ? 1 : 0))
  const comparisonRanks = comparisonAnswers
    .map(answer => answer.llm_rank)
    .filter(isNumber)

  return {
    brandedRecognitionPct,
    nonBrandedDiscoveryRank: discoveryRanks.length > 0 ? average(discoveryRanks) : null,
    nonBrandedVisibilityPct: discoveryPresenceRates.length > 0 ? Math.round(average(discoveryPresenceRates) * 100) : null,
    comparisonAvgRank: comparisonRanks.length > 0 ? average(comparisonRanks) : null,
  }
}

function buildCitationSummary(answers: ReportAnswer[]) {
  let total = 0
  let brand = 0
  const domainCount = new Map<string, number>()

  answers.forEach(answer => {
    const citations = answer.geo_citations || []
    citations.forEach(citation => {
      total += 1
      if (citation.is_brand_domain) brand += 1
      domainCount.set(citation.domain, (domainCount.get(citation.domain) || 0) + 1)
    })
  })

  const topDomains = Array.from(domainCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([domain, count]) => ({ domain, count }))

  return {
    total,
    brandPct: total > 0 ? Math.round((brand / total) * 100) : 0,
    topDomains
  }
}

function calculateCitationConsistency(answers: ReportAnswer[]): number {
  const domainCount = new Map<string, number>()
  let total = 0
  answers.forEach(answer => {
    ;(answer.geo_citations || []).forEach(citation => {
      total += 1
      domainCount.set(citation.domain, (domainCount.get(citation.domain) || 0) + 1)
    })
  })
  if (total === 0) return 0
  const topCount = Math.max(...domainCount.values())
  return Math.round((topCount / total) * 100)
}

function calculateAnswerDrift(answers: ReportAnswer[]): number {
  if (answers.length <= 1) return 0
  const summaries = answers
    .map(answer => answer.answer_summary?.trim().toLowerCase())
    .filter((summary): summary is string => Boolean(summary))
  if (summaries.length <= 1) return 0
  const uniqueCount = new Set(summaries).size
  return Math.round(((uniqueCount - 1) / Math.max(1, summaries.length - 1)) * 100)
}

export function buildCompetitorsFromAnswers(
  answers: ReportAnswer[],
  propertyContext: { propertyName?: string | null; websiteUrl?: string | null } = {}
): ReportCompetitor[] {
  const brandDomain = normalizeCompetitorDomain(propertyContext.websiteUrl)
  const map = new Map<string, { name: string; domain: string; mentions: number[]; ambiguityReason?: string }>()
  answers.forEach(answer => {
    (answer.ordered_entities || []).forEach(entity => {
      const domain = normalizeCompetitorDomain(entity.domain)
      if (!domain) return
      if (brandDomain && domain === brandDomain) return
      if (isNonCompetitiveEntity(entity.name, domain)) return

      const ambiguityReason = getCompetitorAmbiguityReason({
        entityName: entity.name,
        entityDomain: domain,
        propertyName: propertyContext.propertyName,
      })
      if (!map.has(domain)) {
        map.set(domain, { name: entity.name, domain, mentions: [], ambiguityReason })
      } else if (ambiguityReason && !map.get(domain)?.ambiguityReason) {
        map.get(domain)!.ambiguityReason = ambiguityReason
      }
      map.get(domain)!.mentions.push(entity.position)
    })
  })

  return Array.from(map.values())
    .map(entry => ({
      name: entry.name,
      domain: entry.domain,
      mentionCount: entry.mentions.length,
      avgRank: entry.mentions.reduce((a, b) => a + b, 0) / entry.mentions.length,
      ambiguityReason: entry.ambiguityReason,
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
}

function normalizeCompetitorDomain(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  try {
    const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || ''
  }
}

function tokenizeEntityName(value: string | null | undefined): string[] {
  if (!value) return []
  const stopWords = new Set([
    'apartments',
    'apartment',
    'community',
    'communities',
    'residences',
    'residence',
    'homes',
    'home',
    'the',
    'at',
    'in',
    'of',
    'and',
    'luxury',
  ])
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !stopWords.has(token))
}

const NON_COMPETITIVE_DOMAIN_PATTERNS = [
  /(?:^|\.)facebook\.com$/,
  /(?:^|\.)youtube\.com$/,
  /(?:^|\.)youtu\.be$/,
  /(?:^|\.)instagram\.com$/,
  /(?:^|\.)tiktok\.com$/,
  /(?:^|\.)twitter\.com$/,
  /(?:^|\.)x\.com$/,
  /(?:^|\.)reddit\.com$/,
  /(?:^|\.)quora\.com$/,
  /(?:^|\.)wikipedia\.org$/,
  /(?:^|\.)wiktionary\.org$/,
  /(?:^|\.)merriam-webster\.com$/,
  /(?:^|\.)dictionary\.com$/,
  /(?:^|\.)cambridge\.org$/,
  /(?:^|\.)spotify\.com$/,
  /(?:^|\.)soundcloud\.com$/,
  /(?:^|\.)genius\.com$/,
  /(?:^|\.)lyrics\.com$/,
]

function isNonCompetitiveEntity(name: string | null | undefined, domain: string): boolean {
  const normalizedName = (name || '').toLowerCase()
  if (NON_COMPETITIVE_DOMAIN_PATTERNS.some(pattern => pattern.test(domain))) return true
  if (/(facebook|youtube|tiktok|instagram|reddit|quora)\s*(group|post|video|short|thread|comment)?/.test(normalizedName)) return true
  if (/(song|lyrics|radio mix|music video|official video|come on down)/.test(normalizedName)) return true
  if (/(what does|meaning of|definition of|word\s+["']?era|century)/.test(normalizedName)) return true
  return false
}

function getDomainStem(domain: string): string {
  const firstLabel = domain.split('.')[0] || ''
  return firstLabel.replace(/[^a-z0-9]+/g, '')
}

function getCompetitorAmbiguityReason(input: {
  entityName: string | null | undefined
  entityDomain: string
  propertyName: string | null | undefined
}): string | undefined {
  const domainStem = getDomainStem(input.entityDomain)
  const normalizedEntityName = (input.entityName || '').toLowerCase()
  if (domainStem && !normalizedEntityName.includes(domainStem)) {
    return undefined
  }

  const propertyTokens = new Set(tokenizeEntityName(input.propertyName))
  if (propertyTokens.size === 0) return undefined
  if (domainStem && normalizedEntityName.includes(domainStem) && !propertyTokens.has(domainStem)) {
    return undefined
  }

  const entityTokens = tokenizeEntityName(input.entityName)
  const collidingEntityTokens = entityTokens.filter(token => propertyTokens.has(token) && token.length >= 4)

  if (collidingEntityTokens.length > 0) {
    return 'Name overlaps with the audited property; review before treating as competitor pressure.'
  }
  if (domainStem.length >= 4 && propertyTokens.has(domainStem)) {
    return 'Domain name overlaps with the audited property; review before treating as competitor pressure.'
  }
  return undefined
}

function isSovApplicable(queryType: string): boolean {
  return ['category', 'comparison', 'local'].includes(queryType)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function formatQueryTypeList(stats: Array<{ type: string; presencePct: number }>): string {
  if (stats.length === 0) return 'Selected'
  return stats.map(stat => `${stat.type} (${stat.presencePct}%)`).join(' and ')
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2
  }
  return sorted[mid]
}

function summarizeFlags(answers: ReportAnswer[]): string[] {
  const counts = new Map<string, number>()
  answers.forEach(answer => {
    (answer.flags || []).forEach(flag => {
      counts.set(flag, (counts.get(flag) || 0) + 1)
    })
  })
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([flag]) => flag)
}

function buildRecommendationSummary(recommendations: Awaited<ReturnType<typeof generateRecommendations>>['recommendations']) {
  const summary: ReportRecommendationSummary = {
    total: recommendations.length,
    high: recommendations.filter(r => r.priority === 'high').length,
    medium: recommendations.filter(r => r.priority === 'medium').length,
    low: recommendations.filter(r => r.priority === 'low').length,
    byType: {}
  }
  recommendations.forEach(rec => {
    summary.byType[rec.type] = (summary.byType[rec.type] || 0) + 1
  })
  return summary
}

function buildGlossary(): ReportGlossaryEntry[] {
  return [
    {
      term: 'GEO Score',
      definition: 'Weighted score of how well the property appears in LLM search responses.',
      formula: '45% Position + 25% Link Rank + 20% SOV + 10% Accuracy',
      interpretation: 'Higher is better. The report headline averages the latest selected surface scores; each surface row uses the same component formula. Scores above 75 are considered strong.'
    },
    {
      term: 'Visibility / Presence',
      definition: 'Percent of tracked queries where the property is mentioned in the AI response.',
      formula: '(queries_with_presence / total_queries) * 100',
      interpretation: 'Measures whether your property appears at all. Different from SOV, which measures citation share among sources.'
    },
    {
      term: 'LLM Rank',
      definition: 'Position of the property in the ordered list of entities returned by the LLM.',
      interpretation: 'Lower is better; rank 1 indicates primary recommendation. Avg rank is calculated only from prompts where a ranked mention exists, so absences are reflected through visibility and score rather than the rank average.'
    },
    {
      term: 'Link Rank',
      definition: 'Position of the first brand citation in cited sources.',
      interpretation: 'Lower is better; rank 1 indicates strongest citation prominence.'
    },
    {
      term: 'SOV (Share of Voice)',
      definition: 'Share of citations that reference the brand. Only applicable to category, comparison, and local queries.',
      formula: 'brand_citations / total_citations',
      interpretation: 'Higher indicates stronger source authority. Not applicable (N/A) for branded and FAQ queries.'
    },
    {
      term: 'Accuracy',
      definition: 'Penalty-based component reduced by quality flags (hallucinations, outdated info).',
      interpretation: 'Higher indicates cleaner, more reliable responses.'
    }
  ]
}

export function buildInsights(input: {
  propertyName: string
  scores: ReportScore[]
  trends: Array<{ label: string; score: number | null; visibility: number | null }>
  queryTypeStats: ReportData['queryTypeStats']
  rankSummary: ReportData['rankSummary']
  citationSummary: ReportData['citationSummary']
  recommendationSummary: ReportData['recommendationSummary']
  competitors: ReportData['competitors']
  aiOverviewSummary: ReportData['aiOverviewSummary']
}): ReportInsights {
  const latestScore = input.scores[0]
  const latestVisibility = latestScore?.visibility_pct ?? null
  const trendDelta = calculateTrendDelta(input.trends.map(t => t.score))

  const weakestType = [...input.queryTypeStats].sort((a, b) => a.presencePct - b.presencePct)[0]
  const strongestType = [...input.queryTypeStats].sort((a, b) => b.presencePct - a.presencePct)[0]

  const highlights: string[] = []
  const risks: string[] = []
  const opportunities: string[] = []

  if (latestScore) {
    highlights.push(`Latest GEO score is ${Math.round(latestScore.overall_score)}/100 with visibility at ${Math.round(latestScore.visibility_pct)}%.`)
  }
  if (input.rankSummary.brandedRecognitionPct !== null) {
    highlights.push(`Branded entity recognition is ${input.rankSummary.brandedRecognitionPct}%; treat this separately from discovery rank.`)
  }
  if (input.rankSummary.nonBrandedDiscoveryRank !== null) {
    risks.push(`Non-branded discovery average rank is #${input.rankSummary.nonBrandedDiscoveryRank.toFixed(1)} across category, local, and comparison prompts.`)
  }
  if (trendDelta !== null) {
    highlights.push(`Score trend over recent runs is ${trendDelta > 0 ? 'up' : trendDelta < 0 ? 'down' : 'flat'} (${trendDelta > 0 ? '+' : ''}${trendDelta.toFixed(1)} pts).`)
  }

  if (weakestType && weakestType.presencePct < 60) {
    risks.push(`Weakest query coverage is ${weakestType.type} at ${weakestType.presencePct}% presence.`)
  }
  if (input.citationSummary.total > 0 && input.citationSummary.brandPct < 30) {
    risks.push(`Brand citation share is ${input.citationSummary.brandPct}% of ${input.citationSummary.total} citations.`)
  }

  const strongTypes = input.queryTypeStats
    .filter(stat => stat.presencePct >= 95)
    .sort((a, b) => b.presencePct - a.presencePct)
  if (strongTypes.length > 0) {
    highlights.push(`${formatQueryTypeList(strongTypes.slice(0, 2))} prompt coverage is already strong; treat it as maintenance, not a gap.`)
  } else if (strongestType && strongestType.presencePct > 80) {
    highlights.push(`Strongest query type is ${strongestType.type} at ${strongestType.presencePct}% presence.`)
  }
  if (input.recommendationSummary.high > 0) {
    opportunities.push(`${input.recommendationSummary.high} high-priority recommendations can lift visibility quickly.`)
  }
  const confirmedCompetitor = input.competitors.find(competitor => !competitor.ambiguityReason)
  const ambiguousCompetitor = input.competitors.find(competitor => competitor.ambiguityReason)
  if (confirmedCompetitor) {
    opportunities.push(`Competitive pressure is led by ${confirmedCompetitor.name} with ${confirmedCompetitor.mentionCount} mentions; prioritize counter-positioning where that entity outranks the property.`)
  } else if (ambiguousCompetitor) {
    opportunities.push(`Review ${ambiguousCompetitor.name} (${ambiguousCompetitor.mentionCount} mentions) for brand/entity ambiguity before treating it as competitor pressure.`)
  }

  const summaryStats = [
    { label: 'Active Queries', value: `${input.queryTypeStats.reduce((a, b) => a + b.total, 0)}` },
    { label: 'Total Recommendations', value: `${input.recommendationSummary.total}` },
    { label: 'Discovery Rank', value: input.rankSummary.nonBrandedDiscoveryRank !== null ? `#${input.rankSummary.nonBrandedDiscoveryRank.toFixed(1)}` : 'N/A' },
    { label: 'Branded Recognition', value: input.rankSummary.brandedRecognitionPct !== null ? `${input.rankSummary.brandedRecognitionPct}%` : 'N/A' },
    { label: 'Brand Citation Share', value: `${input.citationSummary.brandPct}%` },
    { label: 'AI Overview Visibility', value: `${input.aiOverviewSummary.visibilityPct}%` }
  ]

  return { highlights, risks, opportunities, summaryStats }
}

async function maybeGenerateNarrative(input: {
  propertyName: string
  insights: ReportInsights
  recommendationSummary: ReportRecommendationSummary
  trends: Array<{ label: string; score: number | null; visibility: number | null }>
  queryTypeStats: ReportData['queryTypeStats']
  rankSummary: ReportData['rankSummary']
  citationSummary: ReportData['citationSummary']
  competitors: ReportData['competitors']
  aiOverviewSummary?: ReportData['aiOverviewSummary']
}): Promise<string | null> {
  const enable = process.env.PROPERTYAUDIT_REPORT_ENABLE_LLM !== 'false'
  if (!enable) return null

  const provider = (process.env.PROPERTYAUDIT_REPORT_LLM_PROVIDER || 'openai').toLowerCase()
  const config = getGeoConfig()

  const prompt = [
    `Write a concise executive narrative for a GEO audit report.`,
    `Property: ${input.propertyName}`,
    `Highlights: ${input.insights.highlights.join(' ')}`,
    `Risks: ${input.insights.risks.join(' ')}`,
    `Opportunities: ${input.insights.opportunities.join(' ')}`,
    `Recommendation summary: High ${input.recommendationSummary.high}, Medium ${input.recommendationSummary.medium}, Low ${input.recommendationSummary.low}`,
    `Branded recognition: ${input.rankSummary.brandedRecognitionPct ?? 'N/A'}%`,
    `Non-branded discovery avg rank: ${input.rankSummary.nonBrandedDiscoveryRank?.toFixed(1) ?? 'N/A'}`,
    `Citation share: ${input.citationSummary.brandPct}% of ${input.citationSummary.total} citations`,
    `AI Overview visibility: ${input.aiOverviewSummary?.visibilityPct ?? 0}% of tracked queries`,
    `Confirmed competitors: ${input.competitors.filter(c => !c.ambiguityReason).slice(0, 3).map(c => `${c.name} (${c.mentionCount})`).join(', ') || 'None'}`,
    `Ambiguous same-name/entity mentions: ${input.competitors.filter(c => c.ambiguityReason).slice(0, 3).map(c => `${c.name} (${c.mentionCount}; ${c.ambiguityReason})`).join(', ') || 'None'}`,
    `Writing rules: treat query types at or above 95% presence as strengths or maintenance areas, not gaps or opportunities. Do not call ambiguous same-name/entity mentions competitors; describe them as entity disambiguation work.`,
    `Return 2-3 short paragraphs with actionable tone.`
  ].join('\n')

  try {
    if (provider === 'claude') {
      if (!config.anthropicApiKey) return null
      const client = new Anthropic({ apiKey: config.anthropicApiKey })
      const response = await client.messages.create({
        model: process.env.PROPERTYAUDIT_REPORT_CLAUDE_MODEL || config.claudeModel,
        max_tokens: 500,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }]
      })
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map(b => b.text)
        .join('\n')
      return text.trim() || null
    }

    if (!config.openaiApiKey) return null
    const client = new OpenAI({ apiKey: config.openaiApiKey })
    const response = await client.chat.completions.create({
      model: process.env.PROPERTYAUDIT_REPORT_OPENAI_MODEL || config.openaiModel,
      messages: [
        { role: 'system', content: 'You write crisp, data-driven executive summaries.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
    const content = response.choices?.[0]?.message?.content?.trim()
    return content || null
  } catch (error) {
    console.error('[reporting] LLM narrative failed:', error)
    return null
  }
}

function renderLineChart(values: Array<number | null>, labels: string[], title: string): string {
  const width = 640
  const height = 180
  const padding = 32
  const filtered = values.filter((v): v is number => typeof v === 'number')
  if (filtered.length < 2) {
    return renderChartPlaceholder(title, 'Trend appears after at least two completed audit batches.')
  }

  const max = Math.max(...filtered)
  const min = Math.min(...filtered)
  const range = max - min || 1
  const points = values.map((value, index) => {
    if (value === null || value === undefined) return null
    const x = padding + (index / Math.max(1, values.length - 1)) * (width - padding * 2)
    const y = padding + (1 - (value - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).filter(Boolean).join(' ')

  const labelItems = labels.map((label, index) => {
    const x = padding + (index / Math.max(1, labels.length - 1)) * (width - padding * 2)
    return `<text x="${x}" y="${height - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${escapeSvgText(label)}</text>`
  }).join('')

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
      <text x="${padding}" y="${padding - 10}" font-size="12" fill="#111827">${title}</text>
      <polyline fill="none" stroke="#6366f1" stroke-width="3" points="${points}" />
      ${labelItems}
    </svg>
  `.trim()
}

function renderBarChart(data: Array<{ label: string; value: number }>, title: string): string {
  const width = 640
  const height = 240
  const padding = 32
  const labelAreaHeight = 58
  if (data.length === 0) {
    return renderChartPlaceholder(title)
  }

  const max = Math.max(...data.map(d => d.value), 1)
  const barWidth = (width - padding * 2) / data.length
  const bars = data.map((item, index) => {
    const barHeight = (item.value / max) * (height - padding * 2 - labelAreaHeight)
    const x = padding + index * barWidth
    const y = height - padding - labelAreaHeight - barHeight
    const labelLines = wrapSvgLabel(item.label, Math.max(8, Math.floor(barWidth / 7)), 2)
      .map((line, lineIndex) =>
        `<tspan x="${x + barWidth / 2}" dy="${lineIndex === 0 ? 0 : 12}">${escapeSvgText(line)}</tspan>`
      )
      .join('')
    return `
      <rect x="${x + 6}" y="${y}" width="${barWidth - 12}" height="${barHeight}" fill="#6366f1" rx="4" />
      <text x="${x + barWidth / 2}" y="${height - padding - labelAreaHeight + 18}" text-anchor="middle" font-size="9" fill="#6b7280">${labelLines}</text>
      <text x="${x + barWidth / 2}" y="${y - 6}" text-anchor="middle" font-size="10" fill="#111827">${item.value}</text>
    `
  }).join('')

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
      <text x="${padding}" y="${padding - 10}" font-size="12" fill="#111827">${title}</text>
      ${bars}
    </svg>
  `.trim()
}

function renderChartPlaceholder(title: string, message = 'Data not available.'): string {
  return `
    <div style="border: 1px dashed #d1d5db; padding: 16px; border-radius: 8px; color: #6b7280;">
      <strong>${title}</strong><br />
      ${message}
    </div>
  `.trim()
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function wrapSvgLabel(label: string, maxChars: number, maxLines: number): string[] {
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []

  words.forEach(word => {
    const current = lines[lines.length - 1]
    if (!current) {
      lines.push(word)
      return
    }
    if (`${current} ${word}`.length <= maxChars) {
      lines[lines.length - 1] = `${current} ${word}`
    } else if (lines.length < maxLines) {
      lines.push(word)
    } else {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${word}`
    }
  })

  return (lines.length > 0 ? lines : [label])
    .slice(0, maxLines)
    .map((line, index, arr) => {
      if (index !== arr.length - 1 || line.length <= maxChars) return line
      return `${line.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`
    })
}

function calculateTrendDelta(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => typeof v === 'number')
  if (filtered.length < 2) return null
  return filtered[filtered.length - 1] - filtered[0]
}

function average(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function formatShortDate(dateValue?: string | null): string {
  if (!dateValue) return '—'
  const date = new Date(dateValue)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
