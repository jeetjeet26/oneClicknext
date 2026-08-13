import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import {
  SITEFORGE_BROWSER_EVIDENCE_VERSION,
  SITEFORGE_CERTIFICATION_POLICY_VERSION,
} from '@/utils/siteforge/verification/browser-evidence'
import {
  bindRenderedCritiqueEvidence,
  CritiqueEvidenceError,
  type CritiqueCertificationRow,
} from './evidence'

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111'
const EVIDENCE_ID = '22222222-2222-4222-8222-222222222222'
const CONTENT_HASH = 'a'.repeat(64)
const EVIDENCE_HASH = 'b'.repeat(64)
const BINDING_HASH = 'c'.repeat(64)
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_HASH = createHash('sha256').update(PNG).digest('hex')

function fixture(capturedAt = '2026-08-10T19:30:00.000Z') {
  const screenshots = (
    ['desktop', 'tablet', 'mobile'] as const
  ).map(viewport => ({
    url: 'https://example.com/',
    viewport,
    width: viewport === 'desktop' ? 1440 : viewport === 'tablet' ? 834 : 390,
    height: viewport === 'desktop' ? 900 : viewport === 'tablet' ? 1112 : 844,
    storagePath: `browser-certification/${ARTIFACT_ID}/${viewport}.png`,
    sha256: PNG_HASH,
    bytes: PNG.byteLength,
    contentType: 'image/png' as const,
    identityDigest: `${viewport === 'desktop' ? 'd' : viewport === 'tablet' ? 'e' : 'f'}`.repeat(64),
  }))
  const report = {
    passed: true,
    policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
    artifactId: ARTIFACT_ID,
    contentHash: CONTENT_HASH,
    bindingHash: BINDING_HASH,
    evidenceHash: EVIDENCE_HASH,
    targetUrl: 'https://example.com',
    verifiedAt: '2026-08-10T19:31:00.000Z',
    checks: [],
    browser: {
      policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
      evidenceVersion: SITEFORGE_BROWSER_EVIDENCE_VERSION,
      evaluatedAt: '2026-08-10T19:31:00.000Z',
      capturedAt,
      passed: true,
      evidenceAccepted: true,
      screenshots,
      checks: [],
    },
    pages: [
      {
        slug: 'home',
        url: 'https://example.com/',
        status: 200,
        bytes: 1000,
        responseMs: 100,
        bodyHash: 'body',
      },
    ],
  }
  const certification: CritiqueCertificationRow = {
    id: EVIDENCE_ID,
    artifact_id: ARTIFACT_ID,
    evidence_hash: EVIDENCE_HASH,
    binding_hash: BINDING_HASH,
    report_hash: hashSiteForgeContent(report),
    report,
    created_at: '2026-08-10T19:31:00.000Z',
  }
  return {
    artifact: {
      id: ARTIFACT_ID,
      contentHash: CONTENT_HASH,
      createdAt: '2026-08-10T19:00:00.000Z',
      blueprint: {
        version: 1,
        pages: [
          {
            slug: 'home',
            title: 'Home',
            purpose: 'Introduce the property',
            sections: [],
          },
        ],
      },
    },
    certification,
  }
}

describe('rendered critique evidence binding', () => {
  it('binds exact artifact, evidence digest, and verified screenshot bytes', async () => {
    const input = fixture()
    const bound = await bindRenderedCritiqueEvidence({
      ...input,
      now: new Date('2026-08-10T20:00:00.000Z'),
      screenshotLoader: async () => PNG,
    })

    expect(bound.artifact.id).toBe(ARTIFACT_ID)
    expect(bound.evidenceDigest).toBe(EVIDENCE_HASH)
    expect(bound.screenshots).toHaveLength(3)
    expect(bound.screenshotManifestDigest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects stale screenshot evidence', async () => {
    const input = fixture('2026-08-08T19:30:00.000Z')
    await expect(
      bindRenderedCritiqueEvidence({
        ...input,
        now: new Date('2026-08-10T20:00:00.000Z'),
        screenshotLoader: async () => PNG,
      })
    ).rejects.toMatchObject({
      code: 'evidence_stale',
    } satisfies Partial<CritiqueEvidenceError>)
  })

  it('rejects artifact and screenshot digest mismatches', async () => {
    const artifactMismatch = fixture()
    artifactMismatch.certification.artifact_id =
      '33333333-3333-4333-8333-333333333333'
    await expect(
      bindRenderedCritiqueEvidence({
        ...artifactMismatch,
        now: new Date('2026-08-10T20:00:00.000Z'),
        screenshotLoader: async () => PNG,
      })
    ).rejects.toMatchObject({ code: 'artifact_mismatch' })

    const screenshotMismatch = fixture()
    await expect(
      bindRenderedCritiqueEvidence({
        ...screenshotMismatch,
        now: new Date('2026-08-10T20:00:00.000Z'),
        screenshotLoader: async () => new Uint8Array([...PNG, 0]),
      })
    ).rejects.toMatchObject({ code: 'screenshot_mismatch' })
  })

  it('rejects an incomplete screenshot viewport manifest', async () => {
    const input = fixture()
    const report = input.certification.report as {
      browser: { screenshots: unknown[] }
    }
    report.browser.screenshots.pop()
    input.certification.report_hash = hashSiteForgeContent(report)

    await expect(
      bindRenderedCritiqueEvidence({
        ...input,
        now: new Date('2026-08-10T20:00:00.000Z'),
        screenshotLoader: async () => PNG,
      })
    ).rejects.toMatchObject({ code: 'screenshot_missing' })
  })
})
