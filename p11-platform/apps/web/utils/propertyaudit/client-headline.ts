import { scoreCollapsedMetrics } from './evaluator'
import { SELLABLE_V1_SURFACES, getSurfaceLabel, isSupportedSurface, type Surface } from './types'

export type HeadlineAnswer = {
  query_id?: string | null
  presence: boolean
  presence_rate?: number | null
  llm_rank: number | null
  link_rank: number | null
  sov: number | null
  flags?: string[]
  geo_queries?: {
    id?: string
    text?: string
    type?: string
    weight?: number | null
  }
  geo_citations?: Array<{
    is_brand_domain?: boolean | null
  }>
}

export type HeadlineQuery = {
  id: string
  text?: string | null
  type?: string | null
  weight?: number | null
}

export const CLIENT_HEADLINE_SURFACES = SELLABLE_V1_SURFACES

export type ClientQueryRef = {
  type?: string | null
  text?: string | null
  weight?: number | null
}

export type ClientHeadlineRates = {
  brandedRecognitionPct: number | null
  discoveryMentionPct: number | null
  citationQuality: number | null
  ownedCitationPct: number | null
  genericCityMentionPct: number | null
}

export type ClientSurfaceHeadline = ClientHeadlineRates & {
  surface: Surface
  label: string
  queryCount: number
}

export type ClientHeadline = ClientHeadlineRates & {
  surfaces: ClientSurfaceHeadline[]
  breakdown: {
    position: number
    link: number
    sov: number
    accuracy: number
  }
}

export function isClientHeadlineSurface(surface: string): surface is Surface {
  return (CLIENT_HEADLINE_SURFACES as readonly string[]).includes(surface)
}

export function isBrandedQuery(query: ClientQueryRef): boolean {
  return query.type === 'branded'
}

export function isGenericCityCategoryQuery(query: ClientQueryRef): boolean {
  if (query.type !== 'category') return false
  if (typeof query.weight === 'number') {
    return query.weight <= 0.8
  }
  const text = (query.text || '').trim().toLowerCase()
  return /^best\s+.+\s+in\s+/.test(text)
}

export function isDiscoveryQuery(query: ClientQueryRef): boolean {
  if (query.type !== 'category' && query.type !== 'local') return false
  return !isGenericCityCategoryQuery(query)
}

export function queryRefFromAnswer(answer: HeadlineAnswer, query?: HeadlineQuery | null): ClientQueryRef {
  return {
    type: query?.type || answer.geo_queries?.type || null,
    text: query?.text || answer.geo_queries?.text || null,
    weight: query?.weight ?? answer.geo_queries?.weight ?? null,
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function presenceRate(answers: HeadlineAnswer[]): number | null {
  if (answers.length === 0) return null
  const rates = answers.map(answer =>
    typeof answer.presence_rate === 'number' ? answer.presence_rate : (answer.presence ? 1 : 0)
  )
  return Math.round(average(rates) * 1000) / 10
}

function ownedCitationRate(answers: HeadlineAnswer[]): number | null {
  if (answers.length === 0) return null
  const hits = answers.filter(answer =>
    answer.link_rank != null
    || (answer.geo_citations || []).some(citation => citation.is_brand_domain)
  ).length
  return Math.round((hits / answers.length) * 1000) / 10
}

function citationQuality(answers: HeadlineAnswer[]): {
  score: number | null
  breakdown: { position: number; link: number; sov: number; accuracy: number }
} {
  if (answers.length === 0) {
    return { score: null, breakdown: { position: 0, link: 0, sov: 0, accuracy: 0 } }
  }
  const scored = answers.map(answer =>
    scoreCollapsedMetrics({
      llmRank: answer.llm_rank,
      linkRank: answer.link_rank,
      sov: answer.sov,
      flags: answer.flags || [],
    })
  )
  return {
    score: Math.round(average(scored.map(item => item.score)) * 10) / 10,
    breakdown: {
      position: Math.round(average(scored.map(item => item.breakdown.position)) * 10) / 10,
      link: Math.round(average(scored.map(item => item.breakdown.link)) * 10) / 10,
      sov: Math.round(average(scored.map(item => item.breakdown.sov)) * 10) / 10,
      accuracy: Math.round(average(scored.map(item => item.breakdown.accuracy)) * 10) / 10,
    },
  }
}

export function buildHeadlineRates(
  collapsed: HeadlineAnswer[],
  queries: HeadlineQuery[] = []
): ClientHeadlineRates & { breakdown: ClientHeadline['breakdown'] } {
  const queryMap = new Map(queries.map(query => [query.id, query]))
  const withRef = collapsed.map(answer => ({
    answer,
    query: queryRefFromAnswer(answer, queryMap.get(answer.query_id || answer.geo_queries?.id || '') || null),
  }))

  const branded = withRef.filter(item => isBrandedQuery(item.query)).map(item => item.answer)
  const discovery = withRef.filter(item => isDiscoveryQuery(item.query)).map(item => item.answer)
  const genericCity = withRef.filter(item => isGenericCityCategoryQuery(item.query)).map(item => item.answer)
  const quality = citationQuality(collapsed)

  return {
    brandedRecognitionPct: presenceRate(branded),
    discoveryMentionPct: presenceRate(discovery),
    citationQuality: quality.score,
    ownedCitationPct: ownedCitationRate(collapsed),
    genericCityMentionPct: presenceRate(genericCity),
    breakdown: quality.breakdown,
  }
}

export function buildClientHeadline(
  collapsedBySurface: Array<{ surface: string; answers: HeadlineAnswer[] }>,
  queries: HeadlineQuery[] = []
): ClientHeadline {
  const surfaces: ClientSurfaceHeadline[] = []

  for (const entry of collapsedBySurface) {
    if (!isClientHeadlineSurface(entry.surface) || !isSupportedSurface(entry.surface)) continue
    const rates = buildHeadlineRates(entry.answers, queries)
    surfaces.push({
      surface: entry.surface,
      label: getSurfaceLabel(entry.surface),
      queryCount: entry.answers.length,
      brandedRecognitionPct: rates.brandedRecognitionPct,
      discoveryMentionPct: rates.discoveryMentionPct,
      citationQuality: rates.citationQuality,
      ownedCitationPct: rates.ownedCitationPct,
      genericCityMentionPct: rates.genericCityMentionPct,
    })
  }

  const allAnswers = collapsedBySurface
    .filter(entry => isClientHeadlineSurface(entry.surface))
    .flatMap(entry => entry.answers)
  const combined = buildHeadlineRates(allAnswers, queries)

  return {
    ...combined,
    surfaces,
  }
}
