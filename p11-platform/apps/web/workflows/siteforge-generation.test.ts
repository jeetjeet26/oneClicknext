import { describe, expect, it } from 'vitest'
import { FatalError } from 'workflow'
import { classifySiteForgeGenerationFailure } from '@/utils/siteforge/workflows/generation-failure'

describe('SiteForge generation failure classification', () => {
  it('marks deterministic evidence mismatch as nonretryable', () => {
    expect(
      classifySiteForgeGenerationFailure(
        new FatalError(
          'Photo output is outside the approved rights-cleared asset manifest'
        ),
        'executing_photos'
      )
    ).toMatchObject({
      code: 'asset_evidence_mismatch',
      retryable: false,
      failedCheckpoint: 'executing_photos',
    })
  })

  it('marks temporary provider failure as retryable', () => {
    expect(
      classifySiteForgeGenerationFailure(
        new Error('Anthropic provider temporarily unavailable'),
        'generating_content'
      )
    ).toMatchObject({
      code: 'temporary_provider_failure',
      retryable: true,
      failedCheckpoint: 'generating_content',
    })
  })
})
