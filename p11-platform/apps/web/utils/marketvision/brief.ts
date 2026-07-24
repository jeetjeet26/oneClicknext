/**
 * Market Brief generation.
 *
 * Deterministic-first: changes, positions, and movements are computed from
 * observation history and subject-property truth with no LLM involvement.
 * Insights and recommendations are derived from those deterministic results
 * and always carry citations, confidence, and explicit limitations.
 *
 * Briefs are persisted to market_insights (insight_type 'market_brief') so
 * the operator sees a stable artifact, not a recomputed dashboard.
 */

import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'
import {
  MarketBriefSchema,
  rankRecommendation,
  type MarketBrief,
  type MarketChange,
  type MarketInsightItem,
  type MarketMovement,
  type MarketPosition,
  type MarketRecommendation,
} from './domain-types'
import {
  computeMarketChanges,
  computeMarketMovements,
  type CompetitorRow,
  type PriceHistoryRow,
  type UnitRow,
} from './changes'
import { MARKET_BRIEF_SCHEMA_VERSION } from './models'

export const MARKET_BRIEF_INSIGHT_TYPE = 'market_brief'
const DEFAULT_WINDOW_DAYS = 30

interface SubjectUnit {
  bedrooms: number
  rent_min: number | null
  rent_max: number | null
}

interface CompetitorUnitWithRent extends UnitRow {
  rent_min: number | null
  rent_max: number | null
}

/**
 * Property-relative positioning by bedroom count, using actual subject
 * property pricing versus the comp set. Pure and deterministic.
 */
export function computeMarketPositions(input: {
  subjectUnits: SubjectUnit[]
  competitorUnits: CompetitorUnitWithRent[]
}): MarketPosition[] {
  const bedroomsSet = new Set<number>()
  for (const unit of input.subjectUnits) bedroomsSet.add(unit.bedrooms)
  for (const unit of input.competitorUnits) {
    if (unit.bedrooms !== null) bedroomsSet.add(unit.bedrooms)
  }

  const positions: MarketPosition[] = []

  for (const bedrooms of [...bedroomsSet].sort((a, b) => a - b)) {
    const subject = input.subjectUnits.filter((u) => u.bedrooms === bedrooms)
    const market = input.competitorUnits.filter(
      (u) => u.bedrooms === bedrooms && u.rent_min !== null
    )

    const subjectRents = subject
      .map((u) => u.rent_min)
      .filter((r): r is number => r !== null)
    const subjectRentMin = subjectRents.length ? Math.min(...subjectRents) : null
    const subjectRentMaxCandidates = subject
      .map((u) => u.rent_max ?? u.rent_min)
      .filter((r): r is number => r !== null)
    const subjectRentMax = subjectRentMaxCandidates.length
      ? Math.max(...subjectRentMaxCandidates)
      : null

    const marketRents = market.map((u) => u.rent_min as number)
    const marketAvgRent = marketRents.length
      ? Math.round(marketRents.reduce((a, b) => a + b, 0) / marketRents.length)
      : null
    const marketMinRent = marketRents.length ? Math.min(...marketRents) : null
    const marketMaxRent = marketRents.length ? Math.max(...marketRents) : null
    const competitorsSampled = new Set(market.map((u) => u.competitor_id)).size

    let relativeToMarketPct: number | null = null
    let position: MarketPosition['position'] = 'unknown'
    if (subjectRentMin !== null && marketAvgRent !== null && marketAvgRent > 0) {
      relativeToMarketPct =
        Math.round(((subjectRentMin - marketAvgRent) / marketAvgRent) * 1000) / 10
      if (relativeToMarketPct > 3) position = 'above_market'
      else if (relativeToMarketPct < -3) position = 'below_market'
      else position = 'at_market'
    }

    positions.push({
      bedrooms,
      subjectRentMin,
      subjectRentMax,
      marketAvgRent,
      marketMinRent,
      marketMaxRent,
      competitorsSampled,
      relativeToMarketPct,
      position,
    })
  }

  return positions
}

/** Derive cited insights from deterministic changes/positions/movements. */
export function deriveInsights(input: {
  changes: MarketChange[]
  positions: MarketPosition[]
  movements: MarketMovement[]
  coverage: { competitorsTotal: number; competitorsWithRecentObservations: number }
}): MarketInsightItem[] {
  const insights: MarketInsightItem[] = []

  // Pricing movement insights per bedroom
  for (const movement of input.movements) {
    if (movement.direction === 'rising' || movement.direction === 'falling') {
      const related = input.changes.filter(
        (c) =>
          c.bedrooms === movement.bedrooms &&
          (c.changeType === 'price_drop' || c.changeType === 'price_increase')
      )
      insights.push({
        insightType: 'pricing',
        headline: `${movement.bedrooms}BR market is ${movement.direction} (${movement.netChangePct! > 0 ? '+' : ''}${movement.netChangePct}%)`,
        detail: `${movement.observations} price changes across ${movement.competitorsCovered} competitors in the last ${movement.windowDays} days moved ${movement.direction === 'rising' ? 'up' : 'down'} a net ${movement.netChangePct}%.`,
        confidence: Math.min(0.95, 0.4 + movement.competitorsCovered * 0.15),
        limitations: [
          `Based on ${movement.observations} observations from ${movement.competitorsCovered} competitors; other comp-set members had no fresh pricing observations.`,
        ],
        citations: related.flatMap((c) => c.citations),
      })
    }
  }

  // Position insights (subject vs market)
  for (const position of input.positions) {
    if (position.position === 'above_market' || position.position === 'below_market') {
      insights.push({
        insightType: 'positioning',
        headline: `Your ${position.bedrooms}BR pricing is ${Math.abs(position.relativeToMarketPct!)}% ${position.position === 'above_market' ? 'above' : 'below'} market average`,
        detail: `Subject ${position.bedrooms}BR starts at $${position.subjectRentMin} vs market average $${position.marketAvgRent} (range $${position.marketMinRent}–$${position.marketMaxRent} across ${position.competitorsSampled} competitors).`,
        confidence: Math.min(0.9, 0.3 + position.competitorsSampled * 0.1),
        limitations: [
          'Advertised rents only; effective rents after concessions may differ.',
        ],
        citations: [],
      })
    }
  }

  // Coverage insight when the comp set is going stale
  const { competitorsTotal, competitorsWithRecentObservations } = input.coverage
  if (competitorsTotal > 0 && competitorsWithRecentObservations / competitorsTotal < 0.5) {
    insights.push({
      insightType: 'coverage',
      headline: `Only ${competitorsWithRecentObservations} of ${competitorsTotal} competitors have fresh observations`,
      detail:
        'More than half the comp set has no recent pricing observations. Market movement and positioning read-outs are less reliable until sources are refreshed.',
      confidence: 0.95,
      limitations: [],
      citations: [],
    })
  }

  return insights
}

/** Derive ranked recommendations from insights and positions. Never auto-executes. */
export function deriveRecommendations(input: {
  changes: MarketChange[]
  positions: MarketPosition[]
  movements: MarketMovement[]
  coverage: { competitorsTotal: number; competitorsWithRecentObservations: number }
}): MarketRecommendation[] {
  const recommendations: MarketRecommendation[] = []
  const freshnessFromDays = (days: number) => Math.max(0, 1 - days / 30)

  for (const movement of input.movements) {
    if (movement.direction !== 'falling') continue
    const position = input.positions.find((p) => p.bedrooms === movement.bedrooms)
    if (!position || position.position !== 'above_market') continue

    const related = input.changes.filter(
      (c) => c.bedrooms === movement.bedrooms && c.changeType === 'price_drop'
    )
    const bestFreshness = related.length
      ? Math.max(...related.map((c) => freshnessFromDays(c.freshnessDays)))
      : 0.5
    const confidence = Math.min(0.9, 0.4 + movement.competitorsCovered * 0.15)
    const impact = Math.min(0.9, 0.5 + Math.abs(movement.netChangePct ?? 0) / 20)
    const scores = { impact, confidence, freshness: bestFreshness, reversibility: 0.8 }

    recommendations.push({
      id: randomUUID(),
      recommendationType: 'pricing_review',
      title: `Review ${movement.bedrooms}BR pricing: market falling while you price above it`,
      rationale: `${movement.competitorsCovered} competitors dropped ${movement.bedrooms}BR pricing a net ${movement.netChangePct}% while your ${movement.bedrooms}BR starts ${position.relativeToMarketPct}% above market average. Consider a pricing or concession review.`,
      ...scores,
      rankScore: rankRecommendation(scores),
      citations: related.flatMap((c) => c.citations),
    })
  }

  // Below-market positioning: potential revenue left on the table
  for (const position of input.positions) {
    if (position.position !== 'below_market' || position.competitorsSampled < 3) continue
    const scores = {
      impact: 0.6,
      confidence: Math.min(0.85, 0.3 + position.competitorsSampled * 0.1),
      freshness: 0.7,
      reversibility: 0.8,
    }
    recommendations.push({
      id: randomUUID(),
      recommendationType: 'pricing_review',
      title: `${position.bedrooms}BR priced ${Math.abs(position.relativeToMarketPct!)}% below market — review upside`,
      rationale: `Subject ${position.bedrooms}BR starts at $${position.subjectRentMin} vs market average $${position.marketAvgRent} across ${position.competitorsSampled} competitors. If occupancy is healthy there may be pricing upside.`,
      ...scores,
      rankScore: rankRecommendation(scores),
      citations: [],
    })
  }

  // Stale comp set: operator task to repair sources
  const { competitorsTotal, competitorsWithRecentObservations } = input.coverage
  if (competitorsTotal > 0 && competitorsWithRecentObservations / competitorsTotal < 0.5) {
    const scores = { impact: 0.5, confidence: 0.95, freshness: 1, reversibility: 1 }
    recommendations.push({
      id: randomUUID(),
      recommendationType: 'operator_task',
      title: 'Refresh stale competitor sources',
      rationale: `${competitorsTotal - competitorsWithRecentObservations} of ${competitorsTotal} competitors have no recent observations. Run a source refresh (or repair failing sources) before relying on market read-outs.`,
      ...scores,
      rankScore: rankRecommendation(scores),
      citations: [],
    })
  }

  recommendations.sort((a, b) => b.rankScore - a.rankScore)
  return recommendations
}

/**
 * Generate a Market Brief for a property from live observation history and
 * subject-property truth. Deterministic; no LLM required.
 */
export async function generateMarketBrief(
  propertyId: string,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<MarketBrief> {
  const supabase = createServiceClient()
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: competitors }, { data: subjectUnits }] = await Promise.all([
    supabase
      .from('competitors')
      .select('id, name, last_scraped_at')
      .eq('property_id', propertyId)
      .eq('is_active', true),
    supabase
      .from('property_units')
      .select('bedrooms, rent_min, rent_max')
      .eq('property_id', propertyId),
  ])

  const competitorRows: CompetitorRow[] = (competitors || []).map((c) => ({
    id: c.id,
    name: c.name,
  }))
  const competitorIds = competitorRows.map((c) => c.id)

  let unitRows: (UnitRow & { rent_min: number | null; rent_max: number | null })[] = []
  let historyRows: PriceHistoryRow[] = []

  if (competitorIds.length > 0) {
    const { data: units } = await supabase
      .from('competitor_units')
      .select('id, competitor_id, unit_type, bedrooms, rent_min, rent_max')
      .in('competitor_id', competitorIds)
    unitRows = (units || []) as typeof unitRows

    const unitIds = unitRows.map((u) => u.id)
    if (unitIds.length > 0) {
      const { data: history } = await supabase
        .from('competitor_price_history')
        .select('id, competitor_unit_id, rent_min, rent_max, available_count, recorded_at, capture_id')
        .in('competitor_unit_id', unitIds)
        .gte('recorded_at', windowStart)
        .order('recorded_at', { ascending: true })
      historyRows = (history || []) as PriceHistoryRow[]
    }
  }

  const changes = computeMarketChanges({
    history: historyRows,
    units: unitRows,
    competitors: competitorRows,
  })
  const movements = computeMarketMovements(changes, windowDays)
  const positions = computeMarketPositions({
    subjectUnits: (subjectUnits || []).filter(
      (u): u is { bedrooms: number; rent_min: number | null; rent_max: number | null } =>
        typeof u.bedrooms === 'number'
    ),
    competitorUnits: unitRows,
  })

  // Coverage: competitors with at least one observation in the window
  const unitsByCompetitor = new Map<string, string[]>()
  for (const unit of unitRows) {
    const list = unitsByCompetitor.get(unit.competitor_id) ?? []
    list.push(unit.id)
    unitsByCompetitor.set(unit.competitor_id, list)
  }
  const unitIdsWithObservations = new Set(historyRows.map((h) => h.competitor_unit_id))
  let competitorsWithRecentObservations = 0
  for (const [, unitIds] of unitsByCompetitor) {
    if (unitIds.some((id) => unitIdsWithObservations.has(id))) {
      competitorsWithRecentObservations += 1
    }
  }

  const coverage = {
    competitorsTotal: competitorRows.length,
    competitorsWithRecentObservations,
    observationsInWindow: historyRows.length,
  }

  const insights = deriveInsights({ changes, positions, movements, coverage })
  const recommendations = deriveRecommendations({ changes, positions, movements, coverage })

  const brief: MarketBrief = {
    schemaVersion: MARKET_BRIEF_SCHEMA_VERSION,
    propertyId,
    generatedAt: new Date().toISOString(),
    synthesisModel: null,
    windowDays,
    coverage,
    changes: changes.slice(0, 50),
    positions,
    movements,
    insights,
    recommendations,
  }

  return MarketBriefSchema.parse(brief)
}

/** Persist a brief to market_insights so it is a durable artifact. */
export async function persistMarketBrief(brief: MarketBrief): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('market_insights')
    .insert({
      property_id: brief.propertyId,
      insight_type: MARKET_BRIEF_INSIGHT_TYPE,
      data: brief as unknown as Json,
      generated_at: brief.generatedAt,
      // Briefs stay readable until replaced; expire after 7 days by default.
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[marketvision] failed to persist market brief', error)
    // Surface the real database error so the run ledger records the cause
    // instead of a generic persistence failure.
    throw new Error(`Failed to persist market brief: ${error.message}`)
  }
  return data?.id ?? null
}

/** Load the latest persisted brief for a property, if any. */
export async function getLatestMarketBrief(
  propertyId: string
): Promise<{ id: string; brief: MarketBrief } | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('market_insights')
    .select('id, data, generated_at')
    .eq('property_id', propertyId)
    .eq('insight_type', MARKET_BRIEF_INSIGHT_TYPE)
    .order('generated_at', { ascending: false })
    .limit(1)

  const row = data?.[0]
  if (!row) return null

  const parsed = MarketBriefSchema.safeParse(row.data)
  if (!parsed.success) {
    console.error('[marketvision] persisted brief failed schema validation', {
      id: row.id,
      issues: parsed.error.issues.slice(0, 3),
    })
    return null
  }

  return { id: row.id, brief: parsed.data }
}
