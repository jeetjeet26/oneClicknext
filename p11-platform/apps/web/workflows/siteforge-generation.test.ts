import { describe, expect, it } from 'vitest'
import { FatalError } from 'workflow'
import { classifySiteForgeGenerationFailure } from '@/utils/siteforge/workflows/generation-failure'

describe('SiteForge generation failure classification', () => {
  it('allows a build to restart with current approved floor-plan inventory', () => {
    expect(
      classifySiteForgeGenerationFailure(
        'Approved floor-plan inventory changed or is no longer publishable',
        'publishing_artifact'
      )
    ).toMatchObject({
      code: 'floor_plan_inventory_changed',
      retryable: true,
      failedCheckpoint: 'publishing_artifact',
    })
  })

  it('marks deterministic evidence mismatch as nonretryable', () => {
    expect(
      classifySiteForgeGenerationFailure(
        new FatalError(
          'The pinned brand context does not match the confirmed plan'
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
