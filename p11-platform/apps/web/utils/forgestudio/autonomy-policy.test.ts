import { describe, expect, it } from 'vitest'
import { evaluateForgeStudioAutonomy } from './autonomy-policy'

const strongEvidence = {
  completedEvaluationCycles: 4,
  measuredKpiLift: 0.08,
  attributionCoverage: 0.95,
  policyIncidentRate: 0.001,
  reversalRate: 0.005,
  operatorOverrideRate: 0.05,
  contextFresh: true,
  rightsCleared: true,
  providerHealthy: true,
}

describe('ForgeStudio autonomy promotion policy', () => {
  it('keeps sensitive claims human-gated despite strong evidence', () => {
    const result = evaluateForgeStudioAutonomy({
      requestedMode: 'bounded',
      actionClass: 'sensitive_claim',
      evidence: strongEvidence,
    })
    expect(result.allowed).toBe(false)
    expect(result.effectiveMode).toBe('recommendation')
    expect(result.reasons).toContain('action_class_requires_human_approval')
  })

  it('allows bounded approved-asset rotation only after evidence gates pass', () => {
    const result = evaluateForgeStudioAutonomy({
      requestedMode: 'bounded',
      actionClass: 'creative_rotation',
      evidence: strongEvidence,
    })
    expect(result.allowed).toBe(true)
    expect(result.effectiveMode).toBe('bounded')
  })

  it('downgrades supervised execution when attribution is weak', () => {
    const result = evaluateForgeStudioAutonomy({
      requestedMode: 'supervised',
      actionClass: 'campaign_theme',
      evidence: { ...strongEvidence, attributionCoverage: 0.4 },
    })
    expect(result.allowed).toBe(false)
    expect(result.effectiveMode).toBe('recommendation')
  })
})
