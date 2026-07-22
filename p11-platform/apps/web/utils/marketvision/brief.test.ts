import { describe, expect, it, vi } from 'vitest'

vi.mock('@/utils/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

import { computeMarketPositions, deriveInsights, deriveRecommendations } from './brief'
import type { MarketChange, MarketMovement, MarketPosition } from './domain-types'

describe('computeMarketPositions', () => {
  it('positions the subject relative to the market by bedrooms', () => {
    const positions = computeMarketPositions({
      subjectUnits: [{ bedrooms: 1, rent_min: 1650, rent_max: 1800 }],
      competitorUnits: [
        { id: 'u1', competitor_id: 'c1', unit_type: '1BR', bedrooms: 1, rent_min: 1400, rent_max: 1500 },
        { id: 'u2', competitor_id: 'c2', unit_type: '1BR', bedrooms: 1, rent_min: 1500, rent_max: 1600 },
        { id: 'u3', competitor_id: 'c3', unit_type: '1BR', bedrooms: 1, rent_min: 1600, rent_max: 1700 },
      ],
    })

    expect(positions).toHaveLength(1)
    const position = positions[0]
    expect(position.bedrooms).toBe(1)
    expect(position.marketAvgRent).toBe(1500)
    expect(position.competitorsSampled).toBe(3)
    expect(position.relativeToMarketPct).toBe(10)
    expect(position.position).toBe('above_market')
  })

  it('reports unknown position when subject pricing is missing', () => {
    const positions = computeMarketPositions({
      subjectUnits: [],
      competitorUnits: [
        { id: 'u1', competitor_id: 'c1', unit_type: '1BR', bedrooms: 1, rent_min: 1400, rent_max: null },
      ],
    })

    expect(positions[0].position).toBe('unknown')
    expect(positions[0].subjectRentMin).toBe(null)
  })
})

function makeMovement(overrides: Partial<MarketMovement> = {}): MarketMovement {
  return {
    bedrooms: 1,
    direction: 'falling',
    netChangePct: -4.5,
    observations: 4,
    competitorsCovered: 3,
    windowDays: 30,
    ...overrides,
  }
}

function makePosition(overrides: Partial<MarketPosition> = {}): MarketPosition {
  return {
    bedrooms: 1,
    subjectRentMin: 1650,
    subjectRentMax: 1800,
    marketAvgRent: 1500,
    marketMinRent: 1400,
    marketMaxRent: 1600,
    competitorsSampled: 3,
    relativeToMarketPct: 10,
    position: 'above_market',
    ...overrides,
  }
}

function makeChange(overrides: Partial<MarketChange> = {}): MarketChange {
  return {
    changeType: 'price_drop',
    competitorId: 'c1',
    competitorName: 'Alpha',
    unitType: '1BR',
    bedrooms: 1,
    previousValue: 1500,
    currentValue: 1400,
    changeAmount: -100,
    changePercent: -6.7,
    observedAt: '2026-07-20T00:00:00Z',
    freshnessDays: 1,
    citations: [
      {
        sourceKind: 'price_history',
        sourceId: 'h1',
        captureId: 'cap-1',
        competitorId: 'c1',
        competitorName: 'Alpha',
        observedAt: '2026-07-20T00:00:00Z',
      },
    ],
    ...overrides,
  }
}

describe('deriveInsights', () => {
  it('produces cited pricing insights for real movements', () => {
    const insights = deriveInsights({
      changes: [makeChange()],
      positions: [makePosition()],
      movements: [makeMovement()],
      coverage: { competitorsTotal: 4, competitorsWithRecentObservations: 3 },
    })

    const pricing = insights.find((i) => i.insightType === 'pricing')
    expect(pricing).toBeDefined()
    expect(pricing!.citations.length).toBeGreaterThan(0)
    expect(pricing!.limitations.length).toBeGreaterThan(0)

    const positioning = insights.find((i) => i.insightType === 'positioning')
    expect(positioning).toBeDefined()
  })

  it('flags stale coverage instead of pretending the read-out is reliable', () => {
    const insights = deriveInsights({
      changes: [],
      positions: [],
      movements: [],
      coverage: { competitorsTotal: 10, competitorsWithRecentObservations: 2 },
    })

    const coverage = insights.find((i) => i.insightType === 'coverage')
    expect(coverage).toBeDefined()
    expect(coverage!.headline).toContain('2 of 10')
  })
})

describe('deriveRecommendations', () => {
  it('recommends a pricing review when market falls and subject is above market', () => {
    const recommendations = deriveRecommendations({
      changes: [makeChange()],
      positions: [makePosition()],
      movements: [makeMovement()],
      coverage: { competitorsTotal: 4, competitorsWithRecentObservations: 3 },
    })

    const pricingReview = recommendations.find(
      (r) => r.recommendationType === 'pricing_review'
    )
    expect(pricingReview).toBeDefined()
    expect(pricingReview!.rankScore).toBeGreaterThan(0)
    expect(pricingReview!.citations.length).toBeGreaterThan(0)
  })

  it('ranks recommendations by composite score, highest first', () => {
    const recommendations = deriveRecommendations({
      changes: [makeChange()],
      positions: [makePosition()],
      movements: [makeMovement()],
      coverage: { competitorsTotal: 10, competitorsWithRecentObservations: 2 },
    })

    expect(recommendations.length).toBeGreaterThan(1)
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i - 1].rankScore).toBeGreaterThanOrEqual(
        recommendations[i].rankScore
      )
    }
  })

  it('produces no pricing recommendations without evidence', () => {
    const recommendations = deriveRecommendations({
      changes: [],
      positions: [],
      movements: [],
      coverage: { competitorsTotal: 4, competitorsWithRecentObservations: 4 },
    })

    expect(
      recommendations.filter((r) => r.recommendationType === 'pricing_review')
    ).toHaveLength(0)
  })
})
