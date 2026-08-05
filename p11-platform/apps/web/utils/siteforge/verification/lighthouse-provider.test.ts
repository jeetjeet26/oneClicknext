import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HttpLighthouseEvidenceProvider,
  provisionLighthouseReportArtifacts,
} from './lighthouse-provider'

const artifact = {
  artifactId: '11111111-1111-4111-8111-111111111111',
  contentHash: 'a'.repeat(64),
  runtimePackageSha256: 'b'.repeat(64),
  runtimeManifestSha256: 'c'.repeat(64),
  overlayPackageSha256: null,
  assetManifestHash: 'd'.repeat(64),
  operationSetHash: 'e'.repeat(64),
}

function reportBytes() {
  return Buffer.from(
    JSON.stringify({
      lighthouseVersion: '13.0.0',
      fetchTime: '2026-08-04T18:00:00.000Z',
      requestedUrl: 'https://example.com/',
      finalDisplayedUrl: 'https://example.com/',
      configSettings: { formFactor: 'mobile' },
      categories: {},
      audits: {},
    })
  )
}

describe('external Lighthouse evidence provisioning', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists only digest-verified reports with runner identities', async () => {
    const bytes = reportBytes()
    const reportSha256 = createHash('sha256').update(bytes).digest('hex')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            runs: [
              {
                url: 'https://example.com/',
                formFactor: 'mobile',
                providerRunId: 'lh-run-1',
                generatedAt: '2026-08-04T18:00:00.000Z',
                reportBase64: bytes.toString('base64'),
                reportSha256,
                runnerBinarySha256: 'f'.repeat(64),
                runnerConfigSha256: '1'.repeat(64),
                toolManifestSha256: '2'.repeat(64),
              },
            ],
          }),
          { status: 200 }
        )
      )
    )
    const writer = vi.fn().mockResolvedValue(undefined)
    const reports = await provisionLighthouseReportArtifacts({
      provisioning: {
        targetUrl: 'https://example.com/',
        expectedUrls: ['https://example.com/'],
        environment: 'production',
        access: 'public',
        requireIndexable: true,
        artifact,
        bindingHash: '3'.repeat(64),
      },
      artifactWriter: writer,
      provider: new HttpLighthouseEvidenceProvider(
        new URL('https://lighthouse.example.com/run'),
        's'.repeat(32)
      ),
    })

    expect(reports).toEqual([
      expect.objectContaining({
        providerRunId: 'lh-run-1',
        sha256: reportSha256,
        runnerBinarySha256: 'f'.repeat(64),
        runnerConfigSha256: '1'.repeat(64),
        toolManifestSha256: '2'.repeat(64),
        bindingHash: '3'.repeat(64),
      }),
    ])
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({
        bytes: new Uint8Array(bytes),
        sha256: reportSha256,
        contentType: 'application/json',
      })
    )
  })

  it('fails closed for missing providers and false report digests', async () => {
    await expect(
      provisionLighthouseReportArtifacts({
        provisioning: {
          targetUrl: 'https://example.com/',
          expectedUrls: ['https://example.com/'],
          environment: 'staging',
          access: 'public',
          requireIndexable: false,
          artifact,
          bindingHash: '3'.repeat(64),
        },
        artifactWriter: vi.fn(),
        provider: null,
      })
    ).rejects.toThrow(/provider is required/)

    const bytes = reportBytes()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            runs: [
              {
                url: 'https://example.com/',
                formFactor: 'mobile',
                providerRunId: 'lh-run-2',
                generatedAt: '2026-08-04T18:00:00.000Z',
                reportBase64: bytes.toString('base64'),
                reportSha256: '0'.repeat(64),
                runnerBinarySha256: 'f'.repeat(64),
                runnerConfigSha256: '1'.repeat(64),
                toolManifestSha256: '2'.repeat(64),
              },
            ],
          }),
          { status: 200 }
        )
      )
    )
    await expect(
      new HttpLighthouseEvidenceProvider(
        new URL('https://lighthouse.example.com/run'),
        's'.repeat(32)
      ).provision({
        targetUrl: 'https://example.com/',
        expectedUrls: ['https://example.com/'],
        environment: 'production',
        access: 'public',
        requireIndexable: true,
        artifact,
        bindingHash: '3'.repeat(64),
      })
    ).rejects.toThrow(/digest does not match/)
  })
})
