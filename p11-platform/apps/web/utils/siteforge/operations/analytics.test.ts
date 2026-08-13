import { describe, expect, it } from 'vitest'
import {
  aggregateArtifactFunnels,
  evaluateAnomalyRules,
  SITEFORGE_OUTCOME_KPIS,
} from './analytics'

describe('SiteForge ownership analytics', () => {
  it('uses the fixed delayed-outcome KPI vocabulary', () => {
    expect(SITEFORGE_OUTCOME_KPIS).toEqual([
      'siteforge.sessions',
      'siteforge.cta_conversion_rate',
      'siteforge.lead_conversion_rate',
      'siteforge.tour_conversion_rate',
    ])
  })

  it('computes artifact-aware CTA, lead, and tour conversion by session', () => {
    const [funnel] = aggregateArtifactFunnels([
      {
        artifact_id: 'artifact-1',
        event_type: 'page_view',
        session_id: 'session-1',
        lead_id: null,
      },
      {
        artifact_id: 'artifact-1',
        event_type: 'cta_click',
        session_id: 'session-1',
        lead_id: null,
      },
      {
        artifact_id: 'artifact-1',
        event_type: 'lead_submit',
        session_id: 'session-1',
        lead_id: 'lead-1',
      },
      {
        artifact_id: 'artifact-1',
        event_type: 'page_view',
        session_id: 'session-2',
        lead_id: null,
      },
    ])
    expect(funnel).toMatchObject({
      artifactId: 'artifact-1',
      metrics: {
        sessions: 2,
        uniqueLeads: 1,
        ctaConversionRate: 0.5,
        leadConversionRate: 0.5,
        tourConversionRate: 0,
      },
    })
  })

  it('keeps model-like anomaly responses as proposals with evidence', () => {
    const [funnel] = aggregateArtifactFunnels([
      {
        artifact_id: 'artifact-1',
        event_type: 'page_view',
        session_id: 'session-1',
        lead_id: null,
      },
    ])
    expect(
      evaluateAnomalyRules(funnel, [
        {
          id: 'lead-floor',
          metric: 'leadConversionRate',
          operator: 'lt',
          threshold: 0.1,
          minimumSessions: 1,
          severity: 'medium',
        },
      ])
    ).toEqual([
      expect.objectContaining({
        category: 'analytics_anomaly',
        evidence: expect.objectContaining({ artifactId: 'artifact-1' }),
      }),
    ])
  })
})
