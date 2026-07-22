/**
 * MarketVision decision-grade domain contracts.
 *
 * Four separate concepts, enforced as separate types:
 * - Observation: a source-captured fact (what a source said, when).
 * - Change: a deterministic delta computed from observation history.
 * - Insight: an interpretation over observations/changes, with citations.
 * - Recommendation: a proposed next step ranked by impact/confidence/freshness.
 *
 * A MarketBrief packages changes, insights, and recommendations for one
 * property at one generation time, with full citation lineage.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Citations: every displayed fact points back to its evidence
// ---------------------------------------------------------------------------
export const MarketCitationSchema = z.object({
  /** What kind of record backs this claim. */
  sourceKind: z.enum(['price_history', 'competitor_unit', 'brand_intelligence', 'capture', 'alert']),
  /** Id of the backing record. */
  sourceId: z.string(),
  /** market_source_captures id when lineage is available. */
  captureId: z.string().nullable(),
  competitorId: z.string().nullable(),
  competitorName: z.string().nullable(),
  /** When the underlying observation was recorded at the source. */
  observedAt: z.string().nullable(),
})
export type MarketCitation = z.infer<typeof MarketCitationSchema>

// ---------------------------------------------------------------------------
// Deterministic changes computed from observation history (no LLM involved)
// ---------------------------------------------------------------------------
export const MarketChangeSchema = z.object({
  changeType: z.enum(['price_drop', 'price_increase', 'availability_change', 'new_unit', 'new_special']),
  competitorId: z.string(),
  competitorName: z.string(),
  unitType: z.string().nullable(),
  bedrooms: z.number().nullable(),
  previousValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  changeAmount: z.number().nullable(),
  changePercent: z.number().nullable(),
  observedAt: z.string(),
  /** Days since the observation; drives freshness weighting. */
  freshnessDays: z.number(),
  citations: z.array(MarketCitationSchema),
})
export type MarketChange = z.infer<typeof MarketChangeSchema>

// ---------------------------------------------------------------------------
// Property-relative position (subject property vs the comp set, by bedrooms)
// ---------------------------------------------------------------------------
export const MarketPositionSchema = z.object({
  bedrooms: z.number(),
  subjectRentMin: z.number().nullable(),
  subjectRentMax: z.number().nullable(),
  marketAvgRent: z.number().nullable(),
  marketMinRent: z.number().nullable(),
  marketMaxRent: z.number().nullable(),
  competitorsSampled: z.number(),
  /** Subject rent relative to market average, as a percentage (+ above, - below). */
  relativeToMarketPct: z.number().nullable(),
  position: z.enum(['above_market', 'at_market', 'below_market', 'unknown']),
})
export type MarketPosition = z.infer<typeof MarketPositionSchema>

// ---------------------------------------------------------------------------
// Bedroom-aware market movement (replaces alert-count trend heuristics)
// ---------------------------------------------------------------------------
export const MarketMovementSchema = z.object({
  bedrooms: z.number(),
  direction: z.enum(['rising', 'falling', 'stable', 'insufficient_data']),
  /** Net percentage movement across observed changes in the window. */
  netChangePct: z.number().nullable(),
  observations: z.number(),
  competitorsCovered: z.number(),
  windowDays: z.number(),
})
export type MarketMovement = z.infer<typeof MarketMovementSchema>

// ---------------------------------------------------------------------------
// Cited insights (interpretation over changes/observations)
// ---------------------------------------------------------------------------
export const MarketInsightItemSchema = z.object({
  insightType: z.enum(['pricing', 'availability', 'positioning', 'messaging', 'coverage']),
  headline: z.string(),
  detail: z.string(),
  confidence: z.number().min(0).max(1),
  /** What the insight is NOT able to say (explicit uncertainty). */
  limitations: z.array(z.string()),
  citations: z.array(MarketCitationSchema),
})
export type MarketInsightItem = z.infer<typeof MarketInsightItemSchema>

// ---------------------------------------------------------------------------
// Recommendations (ranked; never auto-executed)
// ---------------------------------------------------------------------------
export const MarketRecommendationSchema = z.object({
  id: z.string(),
  recommendationType: z.enum([
    'pricing_review',
    'concession_review',
    'brandforge_positioning_review',
    'siteforge_content_patch',
    'forgestudio_messaging_brief',
    'operator_task',
  ]),
  title: z.string(),
  rationale: z.string(),
  /** 0-1: expected business impact if acted on. */
  impact: z.number().min(0).max(1),
  /** 0-1: confidence in the underlying evidence. */
  confidence: z.number().min(0).max(1),
  /** 0-1: how fresh the supporting observations are (1 = today). */
  freshness: z.number().min(0).max(1),
  /** 0-1: how easily the action can be undone (1 = fully reversible). */
  reversibility: z.number().min(0).max(1),
  /** Composite ranking score (impact, confidence, freshness, reversibility). */
  rankScore: z.number(),
  citations: z.array(MarketCitationSchema),
})
export type MarketRecommendation = z.infer<typeof MarketRecommendationSchema>

// ---------------------------------------------------------------------------
// The persisted Market Brief
// ---------------------------------------------------------------------------
export const MarketBriefSchema = z.object({
  schemaVersion: z.string(),
  propertyId: z.string(),
  generatedAt: z.string(),
  /** Model used for narrative synthesis, null when fully deterministic. */
  synthesisModel: z.string().nullable(),
  windowDays: z.number(),
  coverage: z.object({
    competitorsTotal: z.number(),
    competitorsWithRecentObservations: z.number(),
    observationsInWindow: z.number(),
  }),
  changes: z.array(MarketChangeSchema),
  positions: z.array(MarketPositionSchema),
  movements: z.array(MarketMovementSchema),
  insights: z.array(MarketInsightItemSchema),
  recommendations: z.array(MarketRecommendationSchema),
})
export type MarketBrief = z.infer<typeof MarketBriefSchema>

/**
 * Composite recommendation ranking: impact-weighted, discounted by stale or
 * low-confidence evidence, with a small boost for easily reversible actions.
 */
export function rankRecommendation(input: {
  impact: number
  confidence: number
  freshness: number
  reversibility: number
}): number {
  const score =
    input.impact * 0.4 +
    input.confidence * 0.3 +
    input.freshness * 0.2 +
    input.reversibility * 0.1
  return Math.round(score * 1000) / 1000
}
