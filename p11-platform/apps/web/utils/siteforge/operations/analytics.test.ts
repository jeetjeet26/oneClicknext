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
      'siteforge.conversion_outcome_rate',
    ])
  })

  it('aggregates provider-neutral for-sale conversion outcomes by session', () => {
    const [funnel] = aggregateArtifactFunnels([
      {
        artifact_id: 'artifact-sale',
        event_type: 'page_view',
        session_id: 'session-1',
        lead_id: null,
      },
      {
        artifact_id: 'artifact-sale',
        event_type: 'plan_saved',
        session_id: 'session-1',
        lead_id: 'lead-1',
      },
      {
        artifact_id: 'artifact-sale',
        event_type: 'page_view',
        session_id: 'session-2',
        lead_id: null,
      },
      {
        artifact_id: 'artifact-sale',
        event_type: 'broker_handoff_requested',
        session_id: 'session-2',
        lead_id: 'lead-2',
      },
    ])

    expect(funnel.metrics.conversionRate).toBe(1)
    expect(funnel.metrics.conversionOutcomes).toMatchObject({
      plan_saved: 1,
      broker_handoff_requested: 1,
    })
    expect(funnel.metrics.tourConversionRate).toBe(0)
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
