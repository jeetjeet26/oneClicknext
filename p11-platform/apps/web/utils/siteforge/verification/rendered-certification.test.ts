import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserFindingsAreAdvisory,
  certifyRenderedWordPressArtifact,
} from './rendered-certification'

describe('remote WordPress artifact certification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('blocks public production when complete browser evidence is missing', async () => {
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
          '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home</title></head><body><section class="block-text-section"><h1>Welcome</h1></section><section class="block-accordion"></section><img src="https://apartments.example.com/wp-content/uploads/logo.png" alt="Property logo"></body></html>',
          {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }
        )
      )
      .mockResolvedValueOnce(new Response('approved-logo', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const report = await certifyRenderedWordPressArtifact({
      artifactId: '11111111-1111-4111-8111-111111111111',
      contentHash,
      artifactBinding: {
        artifactId: '11111111-1111-4111-8111-111111111111',
        contentHash,
        runtimePackageSha256: 'b'.repeat(64),
        runtimeManifestSha256: 'c'.repeat(64),
        overlayPackageSha256: null,
        assetManifestHash: 'd'.repeat(64),
        operationSetHash: 'e'.repeat(64),
      },
      targetUrl: 'https://apartments.example.com',
      credentials: { username: 'admin', password: 'app-password' },
      verifiedAt: '2026-07-30T18:00:00.000Z',
      environment: 'production',
      access: 'public',
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
            {
              id: 'faq',
              type: 'faq',
              acfBlock: 'acf/accordion-section',
              reasoning: 'Answer common questions',
              order: 1,
              content: { items: [] },
            },
          ],
        },
      ],
      approvedImageUrls: ['https://assets.example.com/logo.png'],
      approvedImageDigests: [
        createHash('sha256').update('approved-logo').digest('hex'),
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
          id: 'rendered_image_provenance',
          passed: true,
        }),
        expect.objectContaining({
          id: 'browser:evidence.browser.required',
          passed: false,
          severity: 'blocker',
        }),
      ])
    )
    expect(
      report.checks.some(
        check => check.id.startsWith('browser:') && check.severity === 'blocker'
      )
    ).toBe(true)
    // Every deterministic (non-browser) failure still fails the report closed.
    expect(
      report.checks.filter(
        check => !check.id.startsWith('browser:') && check.severity === 'blocker'
      ).length
    ).toBeGreaterThan(0)
  })

  it('limits advisory browser findings to iterative protected preview', () => {
    expect(
      browserFindingsAreAdvisory({
        environment: 'protected_preview',
        access: 'protected',
      })
    ).toBe(true)
    expect(
      browserFindingsAreAdvisory({
        environment: 'staging',
        access: 'public',
      })
    ).toBe(false)
    expect(
      browserFindingsAreAdvisory({
        environment: 'production',
        access: 'public',
      })
    ).toBe(false)
  })
})
