import { describe, expect, it } from 'vitest'
import {
  canSiteForgeActAutomatically,
  validateAutonomyPromotion,
} from './autonomy-policy'

describe('SiteForge autonomy policy', () => {
  it('enforces sequential promotion', () => {
    expect(() =>
      validateAutonomyPromotion({
        actionScope: 'content.repair',
        currentMode: null,
        requestedMode: 'supervised',
        holdoutPercent: 0,
        limits: {},
        evidence: { evaluatedRuns: 10 },
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
        evidence: {
          evaluatedRuns: 10,
          supervisedSuccesses: 5,
          incidentRate: 0.05,
          rollbackVerified: true,
        },
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
        evidence: {
          evaluatedRuns: 10,
          supervisedSuccesses: 10,
          incidentRate: 0,
          rollbackVerified: true,
        },
      })
    ).toThrow('can never use automatic execution')
  })
})
