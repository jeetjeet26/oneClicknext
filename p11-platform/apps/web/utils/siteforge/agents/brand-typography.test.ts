import { describe, expect, it } from 'vitest'
import { normalizeBrandTypographySection } from './brand-typography'

describe('normalizeBrandTypographySection', () => {
  it('normalizes BrandForge font objects into stable string contracts', () => {
    expect(
      normalizeBrandTypographySection({
        primaryFont: {
          name: 'Cormorant Garamond',
          usage: 'Headlines, logo, signage',
        },
        secondaryFont: {
          name: 'Montserrat',
          usage: 'Body copy, digital applications',
        },
      })
    ).toEqual({
      primaryFont: 'Cormorant Garamond',
      primaryUsage: 'Headlines, logo, signage',
      secondaryFont: 'Montserrat',
      secondaryUsage: 'Body copy, digital applications',
    })
  })
})
