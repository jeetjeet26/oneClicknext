import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSiteForgePublicRuntimeConfig } from './public-runtime'

function builder(result: unknown, terminal: 'single' | 'maybeSingle') {
  const value: Record<string, unknown> = {}
  value.select = vi.fn(() => value)
  value.eq = vi.fn(() => value)
  value[terminal] = vi.fn().mockResolvedValue(result)
  return value
}

describe('SiteForge certified public runtime configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('binds the widget and public ingress to one server-owned website identity', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.hellop11.com')
    const from = vi.fn((table: string) =>
      table === 'property_websites'
        ? builder(
            {
              data: {
                id: '11111111-1111-4111-8111-111111111111',
                property_id: '22222222-2222-4222-8222-222222222222',
                siteforge_public_key: 'sf_public_test',
              },
              error: null,
            },
            'single'
          )
        : builder(
            {
              data: { api_key: 'luma_public_test', is_active: true },
              error: null,
            },
            'maybeSingle'
          )
    )

    const config = await loadSiteForgePublicRuntimeConfig(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      { from } as never
    )

    expect(config).toEqual({
      enabled: true,
      apiKey: 'luma_public_test',
      apiBaseUrl: 'https://app.hellop11.com',
      websiteId: '11111111-1111-4111-8111-111111111111',
      conversionEndpoint:
        'https://app.hellop11.com/api/siteforge/public/conversions/11111111-1111-4111-8111-111111111111',
      conversionKey: 'sf_public_test',
      telemetryEndpoint:
        'https://app.hellop11.com/api/siteforge/public/telemetry/11111111-1111-4111-8111-111111111111',
    })
  })
})
