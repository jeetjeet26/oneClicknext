import { describe, expect, it } from 'vitest'
import { buildCompetitorsFromAnswers, buildInsights, type ReportAnswer, type ReportCompetitor } from './reporting'

function makeAnswer(orderedEntities: ReportAnswer['ordered_entities']): ReportAnswer {
  return {
    id: 'answer-1',
    presence: true,
    llm_rank: 1,
    link_rank: null,
    sov: null,
    ordered_entities: orderedEntities,
  }
}

function makeInsightsInput(overrides: Partial<Parameters<typeof buildInsights>[0]> = {}): Parameters<typeof buildInsights>[0] {
  return {
    propertyName: 'Epoca Life',
    scores: [],
    trends: [],
    queryTypeStats: [],
    rankSummary: {
      brandedRecognitionPct: null,
      nonBrandedDiscoveryRank: null,
      nonBrandedVisibilityPct: null,
      comparisonAvgRank: null,
    },
    citationSummary: { total: 0, brandPct: 0, topDomains: [] },
    recommendationSummary: { total: 0, high: 0, medium: 0, low: 0, byType: {} },
    competitors: [],
    aiOverviewSummary: { totalTracked: 0, visibleCount: 0, visibilityPct: 0, byType: [] },
    ...overrides,
  }
}

describe('PropertyAudit reporting insights', () => {
  it('flags same-name entity mentions before treating them as competitor pressure', () => {
    const competitors = buildCompetitorsFromAnswers([
      makeAnswer([
        { name: 'Epoca', domain: 'epoca.com', position: 1 },
        { name: 'Epoca', domain: 'epoca.com', position: 2 },
      ]),
    ], {
      propertyName: 'Epoca Life',
      websiteUrl: 'https://epocalife.com',
    })

    expect(competitors[0]?.ambiguityReason).toContain('overlaps with the audited property')

    const insights = buildInsights(makeInsightsInput({ competitors }))

    expect(insights.opportunities).toContain('Review Epoca (2 mentions) for brand/entity ambiguity before treating it as competitor pressure.')
    expect(insights.opportunities.join(' ')).not.toContain('Top competitor is Epoca')
  })

  it('keeps already-strong prompt clusters in highlights instead of opportunities', () => {
    const confirmedCompetitor: ReportCompetitor = {
      name: 'Otay Ranch Apartments',
      domain: 'otay.example',
      mentionCount: 6,
      avgRank: 2,
    }

    const insights = buildInsights(makeInsightsInput({
      queryTypeStats: [
        { type: 'voice_search', total: 10, presencePct: 100, avgRank: 1, avgSov: null },
        { type: 'comparison', total: 10, presencePct: 96, avgRank: 2, avgSov: 0.4 },
      ],
      competitors: [confirmedCompetitor],
    }))

    expect(insights.highlights.join(' ')).toContain('voice_search (100%) and comparison (96%) prompt coverage is already strong')
    expect(insights.opportunities.join(' ')).not.toContain('voice_search')
    expect(insights.opportunities.join(' ')).toContain('Competitive pressure is led by Otay Ranch Apartments')
  })

  it('excludes social, media, and dictionary-style entities from competitive landscape', () => {
    const competitors = buildCompetitorsFromAnswers([
      makeAnswer([
        {
          name: 'Facebook group post: "What does the word era means ?? A) time B) century C) ..."',
          domain: 'facebook.com',
          position: 5,
        },
        {
          name: 'YouTube: "Come On Down (Tamperer Radio Mix)"',
          domain: 'youtube.com',
          position: 8,
        },
        {
          name: 'Otay Ranch Apartments',
          domain: 'otayranch.example',
          position: 2,
        },
      ]),
    ], {
      propertyName: 'Epoca Life',
      websiteUrl: 'https://epocalife.com',
    })

    expect(competitors).toHaveLength(1)
    expect(competitors[0]).toMatchObject({
      name: 'Otay Ranch Apartments',
      domain: 'otayranch.example',
      mentionCount: 1,
    })
  })
})
