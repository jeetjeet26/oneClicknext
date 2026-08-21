import { describe, expect, it } from 'vitest'
import { buildCompetitorsFromAnswers, buildInsights, buildReportScores, buildTrends, describeDiscoveryRankGap, formatDiscoveryRank, type ReportAnswer, type ReportCompetitor, type ReportRun } from './reporting'

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
      discoveryRankGap: 'no_discovery_answers',
      discoveryRankLabel: 'No discovery answers',
    },
    citationSummary: { total: 0, brandPct: 0, topDomains: [] },
    recommendationSummary: { total: 0, high: 0, medium: 0, low: 0, byType: {} },
    competitors: [],
    aiOverviewSummary: { totalTracked: 0, visibleCount: 0, visibilityPct: 0, byType: [] },
    ...overrides,
  }
}

describe('PropertyAudit reporting insights', () => {
  it('uses the latest score per client surface and includes Claude', () => {
    const scores = buildReportScores([
      {
        id: 'claude-latest',
        surface: 'claude',
        started_at: '2026-05-28T22:21:35.000Z',
        geo_scores: [{ overall_score: 19, visibility_pct: 41, avg_llm_rank: 1, avg_link_rank: null, avg_sov: null }],
      },
      {
        id: 'google-latest',
        surface: 'google_ai',
        started_at: '2026-05-28T22:21:35.000Z',
        geo_scores: [{ overall_score: 38, visibility_pct: 46, avg_llm_rank: 1.8, avg_link_rank: null, avg_sov: 0.06 }],
      },
      {
        id: 'chatgpt-latest',
        surface: 'chatgpt',
        started_at: '2026-05-28T22:21:35.000Z',
        geo_scores: [{ overall_score: 32, visibility_pct: 20, avg_llm_rank: 1.2, avg_link_rank: 2, avg_sov: 0.1 }],
      },
      {
        id: 'claude-older',
        surface: 'claude',
        started_at: '2026-05-27T22:21:35.000Z',
        geo_scores: [{ overall_score: 90, visibility_pct: 90, avg_llm_rank: 1, avg_link_rank: null, avg_sov: null }],
      },
    ])

    expect(scores).toHaveLength(1)
    expect(scores[0]?.overall_score).toBeCloseTo((19 + 38 + 32) / 3, 5)
    expect(scores[0]?.visibility_pct).toBeCloseTo((41 + 46 + 20) / 3, 5)
  })

  it('labels a missing discovery rank as a list-extraction gap', () => {
    expect(describeDiscoveryRankGap({
      discoveryAnswerCount: 4,
      discoveryMentionCount: 2,
      discoveryRankCount: 0,
    })).toBe('no_list_extracted')
    expect(formatDiscoveryRank(null, 'no_list_extracted')).toBe('No list extracted')
    expect(formatDiscoveryRank(1.2, 'none')).toBe('#1.2')
  })

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

  it('does not mark generic listing domains as ambiguous just because their titles mention the property', () => {
    const competitors = buildCompetitorsFromAnswers([
      makeAnswer([
        { name: 'Epoca Life - Apartments on Trulia', domain: 'trulia.com', position: 3 },
      ]),
    ], {
      propertyName: 'Epoca Life',
      websiteUrl: 'https://epocalife.com',
    })

    expect(competitors[0]).toMatchObject({
      name: 'Epoca Life - Apartments on Trulia',
      domain: 'trulia.com',
      ambiguityReason: undefined,
    })
  })
})

describe('PropertyAudit report trends', () => {
  function scoredRun(overrides: Partial<ReportRun> & { score: number; visibility: number }): ReportRun {
    const { score, visibility, ...rest } = overrides
    return {
      id: rest.id || 'run',
      surface: rest.surface || 'chatgpt',
      batch_id: rest.batch_id || 'batch',
      started_at: rest.started_at || '2026-08-21T19:35:51.000Z',
      geo_scores: [{ overall_score: score, visibility_pct: visibility, avg_llm_rank: 1, avg_link_rank: null, avg_sov: null }],
    }
  }

  it('needs two scored batches before a trend can render', () => {
    const oneBatch = buildTrends([
      scoredRun({ id: 'chatgpt', surface: 'chatgpt', batch_id: 'aug-21', score: 40, visibility: 55 }),
      scoredRun({ id: 'claude', surface: 'claude', batch_id: 'aug-21', score: 38, visibility: 50 }),
    ])

    expect(oneBatch).toHaveLength(1)
  })

  it('builds one point per completed batch, not per surface', () => {
    const trends = buildTrends([
      scoredRun({ id: 'aug-chatgpt', surface: 'chatgpt', batch_id: 'aug-21', started_at: '2026-08-21T19:35:51.000Z', score: 40, visibility: 60 }),
      scoredRun({ id: 'aug-google', surface: 'google_ai', batch_id: 'aug-21', started_at: '2026-08-21T19:35:52.000Z', score: 42, visibility: 62 }),
      scoredRun({ id: 'jul-chatgpt', surface: 'chatgpt', batch_id: 'jul-27', started_at: '2026-07-27T19:24:07.000Z', score: 30, visibility: 48 }),
      {
        id: 'jul-failed',
        surface: 'gemini',
        batch_id: 'jul-27',
        started_at: '2026-07-27T19:24:07.000Z',
        geo_scores: [],
      },
    ])

    expect(trends).toHaveLength(2)
    expect(trends[0]?.score).toBe(30)
    expect(trends[1]?.score).toBe(41)
    expect(trends[1]?.visibility).toBe(61)
  })
})
