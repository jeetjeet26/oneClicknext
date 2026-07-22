import { describe, expect, it } from 'vitest'
import {
  computeIssueClusters,
  type ReviewForInsights,
  type AnalysisForInsights,
  type CaseForInsights,
} from './insights'

const NOW = new Date('2026-07-21T12:00:00Z')

function review(
  id: string,
  daysAgo: number,
  overrides: Partial<ReviewForInsights> = {}
): ReviewForInsights {
  const date = new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
  return {
    id,
    rating: 2,
    sentiment: 'negative',
    review_text: `Review ${id}`,
    review_date: date,
    created_at: date,
    is_urgent: false,
    ...overrides,
  }
}

function analysis(reviewId: string, domains: string[]): AnalysisForInsights {
  return { review_id: reviewId, issue_domains: domains, severity: 'medium', journey_stage: 'residency' }
}

describe('computeIssueClusters', () => {
  it('returns empty clusters and honest coverage note when nothing is classified', () => {
    const result = computeIssueClusters({
      reviews: [review('r1', 5)],
      analyses: [],
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    expect(result.clusters).toHaveLength(0)
    expect(result.classifiedReviews).toBe(0)
    expect(result.sourceCoverageNote).toContain('not yet classified')
  })

  it('marks a cluster worsening when recent volume exceeds earlier volume', () => {
    // 90-day window: midpoint at 45 days ago. Three recent, one earlier.
    const reviews = [review('r1', 5), review('r2', 10), review('r3', 20), review('r4', 80)]
    const result = computeIssueClusters({
      reviews,
      analyses: reviews.map((r) => analysis(r.id, ['maintenance'])),
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    const cluster = result.clusters.find((c) => c.issueDomain === 'maintenance')
    expect(cluster?.trend).toBe('worsening')
    expect(cluster?.reviewCount).toBe(4)
    expect(cluster?.recommendation).toBeTruthy()
  })

  it('marks a cluster improving when earlier volume exceeds recent volume', () => {
    const reviews = [review('r1', 60), review('r2', 70), review('r3', 80), review('r4', 5)]
    const result = computeIssueClusters({
      reviews,
      analyses: reviews.map((r) => analysis(r.id, ['noise'])),
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    expect(result.clusters.find((c) => c.issueDomain === 'noise')?.trend).toBe('improving')
  })

  it('reports insufficient data for tiny clusters', () => {
    const reviews = [review('r1', 5)]
    const result = computeIssueClusters({
      reviews,
      analyses: [analysis('r1', ['parking'])],
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    expect(result.clusters.find((c) => c.issueDomain === 'parking')?.trend).toBe(
      'insufficient_data'
    )
  })

  it('does not recommend for a single non-urgent negative review', () => {
    const reviews = [review('r1', 5)]
    const result = computeIssueClusters({
      reviews,
      analyses: [analysis('r1', ['billing_fees'])],
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    expect(result.clusters.find((c) => c.issueDomain === 'billing_fees')?.recommendation).toBeNull()
  })

  it('recommends when an urgent review exists even with low volume', () => {
    const reviews = [review('r1', 5, { is_urgent: true })]
    const result = computeIssueClusters({
      reviews,
      analyses: [analysis('r1', ['safety_security'])],
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    const cluster = result.clusters.find((c) => c.issueDomain === 'safety_security')
    expect(cluster?.recommendation).toMatchObject({ interventionType: 'internal_followup' })
    expect(cluster?.urgentCount).toBe(1)
  })

  it('counts reopened cases as recurrence and triggers recommendation', () => {
    const reviews = [review('r1', 5)]
    const cases: CaseForInsights[] = [
      {
        id: 'case-1',
        review_id: 'r1',
        status: 'remediation',
        priority: 'high',
        issue_domains: ['pests'],
        reopened_count: 2,
        created_at: review('r1', 5).created_at,
        resolved_at: null,
      },
    ]
    const result = computeIssueClusters({
      reviews,
      analyses: [analysis('r1', ['pests'])],
      cases,
      windowDays: 90,
      now: NOW,
    })
    const cluster = result.clusters.find((c) => c.issueDomain === 'pests')
    expect(cluster?.openCases).toBe(1)
    expect(cluster?.reopenedCases).toBe(1)
    expect(cluster?.recommendation).toBeTruthy()
  })

  it('requires higher volume before recommending testimonial reuse of praise', () => {
    const twoPraise = [
      review('r1', 5, { sentiment: 'positive', rating: 5 }),
      review('r2', 8, { sentiment: 'positive', rating: 5 }),
    ]
    const withTwo = computeIssueClusters({
      reviews: twoPraise,
      analyses: twoPraise.map((r) => analysis(r.id, ['praise_general'])),
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    expect(
      withTwo.clusters.find((c) => c.issueDomain === 'praise_general')?.recommendation
    ).toBeNull()

    const threePraise = [...twoPraise, review('r3', 12, { sentiment: 'positive', rating: 5 })]
    const withThree = computeIssueClusters({
      reviews: threePraise,
      analyses: threePraise.map((r) => analysis(r.id, ['praise_general'])),
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    expect(
      withThree.clusters.find((c) => c.issueDomain === 'praise_general')?.recommendation
    ).toMatchObject({ interventionType: 'testimonial_opportunity' })
  })

  it('cites capped, freshest-negative-first evidence with snippets', () => {
    const reviews = [
      review('r1', 30),
      review('r2', 5),
      review('r3', 10),
      review('r4', 20),
      review('r5', 15),
    ]
    const result = computeIssueClusters({
      reviews,
      analyses: reviews.map((r) => analysis(r.id, ['maintenance'])),
      cases: [],
      windowDays: 90,
      now: NOW,
    })
    const cluster = result.clusters.find((c) => c.issueDomain === 'maintenance')
    expect(cluster?.evidence).toHaveLength(3)
    expect(cluster?.evidence[0].reviewId).toBe('r2')
    expect(cluster?.evidence[0].snippet).toContain('Review r2')
  })
})
