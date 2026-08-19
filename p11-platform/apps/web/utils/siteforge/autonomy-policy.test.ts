import { describe, expect, it } from 'vitest'
import {
  canSiteForgeActAutomatically,
  validateAutonomyPromotion,
} from './autonomy-policy'

const durableEvidence = {
  evaluatedRuns: 10,
  completedJobs: 10,
  supervisedSuccesses: 5,
  approvalDecisions: 5,
  incidentCount: 0,
  incidentRate: 0,
  rollbackVerified: true,
  restoreEvidenceRuns: 1,
  providerEvidenceRuns: 2,
  renderedEvidenceRuns: 5,
  outcomeMeasurements: 4,
  negativeOutcomeRate: 0,
  derivedAt: '2026-08-10T00:00:00.000Z',
}

describe('SiteForge autonomy policy', () => {
  it('enforces sequential promotion', () => {
    expect(() =>
      validateAutonomyPromotion({
        actionScope: 'content.repair',
        currentMode: null,
        requestedMode: 'supervised',
        holdoutPercent: 0,
        limits: {},
        evidence: durableEvidence,
      })
    ).toThrow('one stage at a time')
  })

  it('allows bounded auto only with evidence and limits', () => {
    expect(() =>
      validateAutonomyPromotion({
        actionScope: 'content.repair',
        currentMode: 'supervised',
        requestedMode: 'bounded_auto',
        holdoutPercent: 10,
        limits: { maxActionsPerDay: 2 },
        evidence: { ...durableEvidence, incidentRate: 0.05 },
      })
    ).not.toThrow()
    expect(canSiteForgeActAutomatically('content.repair', 'bounded_auto')).toBe(true)
  })

  it('never permits automatic production launch', () => {
    expect(canSiteForgeActAutomatically('production.launch', 'bounded_auto')).toBe(false)
    expect(() =>
      validateAutonomyPromotion({
        actionScope: 'production.launch',
        currentMode: 'supervised',
        requestedMode: 'bounded_auto',
        holdoutPercent: 10,
        limits: { maxActionsPerDay: 1 },
        evidence: { ...durableEvidence, supervisedSuccesses: 10 },
      })
    ).toThrow('can never use automatic execution')
  })

  it('rejects bounded auto without repeated provider and outcome evidence', () => {
    expect(() =>
      validateAutonomyPromotion({
        actionScope: 'content.repair',
        currentMode: 'supervised',
        requestedMode: 'bounded_auto',
        holdoutPercent: 10,
        limits: { maxActionsPerDay: 2 },
        evidence: {
          ...durableEvidence,
          providerEvidenceRuns: 1,
          outcomeMeasurements: 0,
        },
      })
    ).toThrow('repeated provider evidence')
  })

  it('requires rendered effect evidence before extension bounded-auto policy', () => {
    expect(() =>
      validateAutonomyPromotion({
        actionScope: 'runtime.extension.publish',
        currentMode: 'supervised',
        requestedMode: 'bounded_auto',
        holdoutPercent: 10,
        limits: { maxActionsPerDay: 1 },
        evidence: { ...durableEvidence, renderedEvidenceRuns: 4 },
      })
    ).toThrow('parent-versus-edited rendered evidence')
  })
})
