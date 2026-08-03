import { afterEach, describe, expect, it, vi } from 'vitest'
import { certifyRenderedWordPressArtifact } from './rendered-certification'

describe('remote WordPress artifact certification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('proves HTML checks but fails closed without browser evidence', async () => {
    const contentHash = 'a'.repeat(64)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content_hash: contentHash,
            page_ids: [42],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home</title></head><body><section class="block-text-section"><h1>Welcome</h1></section></body></html>',
          {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const report = await certifyRenderedWordPressArtifact({
      artifactId: '11111111-1111-4111-8111-111111111111',
      contentHash,
      targetUrl: 'https://apartments.example.com',
      credentials: { username: 'admin', password: 'app-password' },
      verifiedAt: '2026-07-30T18:00:00.000Z',
      requireIndexable: true,
      pages: [
        {
          slug: 'home',
          title: 'Home',
          purpose: 'Convert visitors',
          sections: [
            {
              id: 'intro',
              type: 'intro',
              acfBlock: 'acf/text-section',
              reasoning: 'Introduce the property',
              order: 0,
              evidenceIds: ['property-1'],
              content: {
                headline: 'Welcome',
                content: 'Explore verified apartment details.',
                layout: 'center',
                background: 'white',
              },
            },
          ],
        },
      ],
    })

    expect(report.passed).toBe(false)
    expect(report.browser.evidenceAccepted).toBe(false)
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'artifact_manifest_identity',
          passed: true,
        }),
        expect.objectContaining({
          id: 'critical_blocks:home',
          passed: true,
        }),
        expect.objectContaining({
          id: 'production_indexable:home',
          passed: true,
        }),
        expect.objectContaining({
          id: 'browser:evidence.browser.required',
          passed: false,
        }),
      ])
    )
  })
})
