import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseLighthouseReportArtifact } from './browserbase-certifier'

const url = 'https://example.com/'
const storagePath =
  'browser-certification/11111111-1111-4111-8111-111111111111/lighthouse/mobile.json'

function lighthouseBytes() {
  return Buffer.from(JSON.stringify({
    lighthouseVersion: '13.0.0',
    fetchTime: '2026-08-04T18:00:00.000Z',
    requestedUrl: url,
    finalDisplayedUrl: url,
    configSettings: { formFactor: 'mobile' },
    categories: {
      performance: { score: 0.91 },
      accessibility: { score: 1 },
      'best-practices': { score: 0.96 },
      seo: { score: 1 },
    },
    audits: {
      'largest-contentful-paint': { numericValue: 1900 },
      'cumulative-layout-shift': { numericValue: 0.02 },
      'total-blocking-time': { numericValue: 75 },
    },
  }))
}

describe('Browserbase certification evidence', () => {
  it('derives scores only from a digest-verified Lighthouse report', () => {
    const bytes = lighthouseBytes()
    const report = parseLighthouseReportArtifact(bytes, {
      url,
      formFactor: 'mobile',
      storagePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      provider: 'http-lighthouse',
      providerRunId: 'run-1',
      runnerBinarySha256: 'b'.repeat(64),
      runnerConfigSha256: 'c'.repeat(64),
      toolManifestSha256: 'd'.repeat(64),
      environment: 'production',
      access: 'public',
      bindingHash: 'e'.repeat(64),
      generatedAt: '2026-08-04T18:00:00.000Z',
    })

    expect(report).toEqual(expect.objectContaining({
      source: 'lighthouse',
      lighthouseVersion: '13.0.0',
      reportStoragePath: storagePath,
      performance: 0.91,
      largestContentfulPaintMs: 1900,
    }))
  })

  it('rejects reports with a false digest or mismatched runner identity', () => {
    const bytes = lighthouseBytes()
    expect(() => parseLighthouseReportArtifact(bytes, {
      url,
      formFactor: 'mobile',
      storagePath,
      sha256: 'a'.repeat(64),
      provider: 'http-lighthouse',
      providerRunId: 'run-1',
      runnerBinarySha256: 'b'.repeat(64),
      runnerConfigSha256: 'c'.repeat(64),
      toolManifestSha256: 'd'.repeat(64),
      environment: 'production',
      access: 'public',
      bindingHash: 'e'.repeat(64),
      generatedAt: '2026-08-04T18:00:00.000Z',
    })).toThrow(/digest mismatch/)

    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(() => parseLighthouseReportArtifact(bytes, {
      url,
      formFactor: 'desktop',
      storagePath,
      sha256: digest,
      provider: 'http-lighthouse',
      providerRunId: 'run-1',
      runnerBinarySha256: 'b'.repeat(64),
      runnerConfigSha256: 'c'.repeat(64),
      toolManifestSha256: 'd'.repeat(64),
      environment: 'production',
      access: 'public',
      bindingHash: 'e'.repeat(64),
      generatedAt: '2026-08-04T18:00:00.000Z',
    })).toThrow(/identity does not match/)
  })
})
