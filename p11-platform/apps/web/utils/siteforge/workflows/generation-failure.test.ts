import { describe, expect, it } from 'vitest'
import { classifySiteForgeGenerationFailure } from './generation-failure'

describe('SiteForge generation failure classification', () => {
  it('makes repaired brand and optional-topology projections retryable', () => {
    const failure = classifySiteForgeGenerationFailure(
      'Deterministic quality gates failed: confirmed_plan_fidelity (pages), exact_brand_tokens (colors.primary, colors.secondary, typography.headline)',
      'publishing_artifact'
    )

    expect(failure).toMatchObject({
      code: 'deterministic_projection_contract_mismatch',
      retryable: true,
      failedCheckpoint: 'publishing_artifact',
    })
  })
})
