import { describe, expect, it, vi } from 'vitest'
import { assertSafeAnalyticsWebhookUrl } from './handlers'

describe('SiteForge analytics webhook URL safety', () => {
  it('rejects destinations that resolve to private addresses', async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([{ address: '10.0.0.5', family: 4 }])

    await expect(
      assertSafeAnalyticsWebhookUrl(
        'https://analytics.example.com/events',
        resolver as never
      )
    ).rejects.toThrow('private or reserved')
  })

  it('accepts an allowlisted public HTTPS destination', async () => {
    const previous = process.env.SITEFORGE_ANALYTICS_WEBHOOK_HOST_ALLOWLIST
    process.env.SITEFORGE_ANALYTICS_WEBHOOK_HOST_ALLOWLIST =
      'analytics.example.com'
    const resolver = vi
      .fn()
      .mockResolvedValue([{ address: '8.8.8.8', family: 4 }])

    try {
      await expect(
        assertSafeAnalyticsWebhookUrl(
          'https://analytics.example.com/events',
          resolver as never
        )
      ).resolves.toMatchObject({ protocol: 'https:' })
    } finally {
      if (previous === undefined) {
        delete process.env.SITEFORGE_ANALYTICS_WEBHOOK_HOST_ALLOWLIST
      } else {
        process.env.SITEFORGE_ANALYTICS_WEBHOOK_HOST_ALLOWLIST = previous
      }
    }
  })
})
