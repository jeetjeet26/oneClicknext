import { describe, expect, it } from 'vitest'
import { classifySiteForgeGenerationFailure } from './generation-failure'

describe('SiteForge generation failure classification', () => {
  it('makes repaired theme spacing contract failures retryable', () => {
    const failure = classifySiteForgeGenerationFailure(
      `Step persistSiteForgeGenerationArtifact failed: [
        {
          "path": ["themeJson", "settings", "spacing", "spacingSizes", 2, "size"],
          "message": "Invalid string: must match pattern /^(?:px|rem|em|vw|%)$/"
        },
        {
          "path": ["designTokens", "spacing", "sectionPadding"],
          "message": "Invalid string"
        }
      ]`,
      'publishing_artifact'
    )

    expect(failure).toMatchObject({
      code: 'theme_spacing_contract_mismatch',
      retryable: true,
      failedCheckpoint: 'publishing_artifact',
    })
  })

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
