import { describe, expect, it } from 'vitest'
import {
  createEvidenceSafePlaceholder,
  isEvidenceSafePlaceholder,
} from './evidence-safe-content'

describe('evidence-safe SiteForge placeholders', () => {
  it('replaces unsupported factual copy with polished non-factual content', () => {
    const content = createEvidenceSafePlaceholder(
      'acf/feature-section',
      'Feature',
      'home-lifestyle-004'
    )

    expect(content).toEqual({
      headline: 'Made for Every Part of Your Day',
      content:
        'From quiet mornings to lively evenings, each day offers space to settle in, connect, and enjoy life at your own pace.',
    })
    expect(
      isEvidenceSafePlaceholder('acf/feature-section', content || {})
    ).toBe(true)
  })

  it('recognizes finalized floor-plan placeholder settings', () => {
    expect(
      isEvidenceSafePlaceholder('acf/plans-availability', {
        data_source: 'siteforge',
        show_pricing: false,
        show_availability: false,
      })
    ).toBe(true)
  })
})
