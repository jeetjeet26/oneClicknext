import { describe, expect, it, vi } from 'vitest'
import { restoreProductionProtection } from './production-steps'

describe('production certification compensation', () => {
  it('fails closed by reapplying settings in protected staging mode', async () => {
    const applySiteForgeSettings = vi.fn().mockResolvedValue(undefined)
    const settings = {
      themeArtifact: { schemaVersion: 2 },
      legal: {
        equalHousingOpportunity: true,
        fairHousingDisclaimer:
          'This property supports Equal Housing Opportunity requirements.',
        privacyPath: '/privacy',
        termsPath: '/terms',
        accessibilityPath: '/accessibility',
      },
      analytics: {
        consentMode: 'required',
        events: ['page_view'],
      },
      publicRuntime: {
        conversionEndpoint: 'https://example.com/api/conversions',
      },
    }

    await restoreProductionProtection(
      { applySiteForgeSettings } as never,
      settings as never
    )

    expect(applySiteForgeSettings).toHaveBeenCalledWith({
      ...settings,
      targetMode: 'staging',
    })
  })
})
