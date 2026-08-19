import { describe, expect, it } from 'vitest'
import { createSiteForgeAutonomousGenerationResult } from './autonomy-contract'

const validUsage = {
  inputTokens: 1_000,
  outputTokens: 500,
  totalTokens: 1_500,
  costUsd: 0.2,
  latencyMs: 2_000,
  attempt: 1,
}

describe('SiteForge autonomous generation contract', () => {
  it('pins centralized policy metadata into the hashed artifact', () => {
    const result = createSiteForgeAutonomousGenerationResult({
      role: 'strategist.v1',
      artifactType: 'siteforge.strategy.v1',
      evidenceIds: ['property-facts-v1'],
      promptVersion: 'siteforge.strategy-prompt.v1',
      outputSchemaVersion: 'siteforge.strategy.v1',
      evaluatorVersion: 'siteforge.strategy-evaluator.v1',
      confidence: 0.88,
      usage: validUsage,
      validation: { valid: true, status: 'passed', issues: [] },
      payload: { objective: 'Increase qualified tours' },
    })

    expect(result.artifact.execution.modelPolicyVersion).toBe(
      result.policy.policyVersion
    )
    expect(result.artifact.execution.modelId).toBe(result.policy.modelId)
    expect(result.artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects generation usage beyond the role budget before sealing', () => {
    expect(() =>
      createSiteForgeAutonomousGenerationResult({
        role: 'operations.v1',
        artifactType: 'siteforge.operations-report.v1',
        promptVersion: 'siteforge.operations-prompt.v1',
        outputSchemaVersion: 'siteforge.operations-report.v1',
        evaluatorVersion: 'siteforge.operations-evaluator.v1',
        confidence: 1,
        usage: {
          ...validUsage,
          attempt: 3,
        },
        validation: { valid: true, status: 'passed', issues: [] },
        payload: {},
      })
    ).toThrow(/attempt budget/)
  })
})
