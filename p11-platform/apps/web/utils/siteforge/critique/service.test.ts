import { describe, expect, it, vi } from 'vitest'
import type { SiteBlueprint } from '@/types/siteforge'
import type { BoundCritiqueEvidence } from './evidence'
import { createRenderedAestheticCritique } from './service'

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111'
const CONTENT_HASH = 'a'.repeat(64)

function section(id: string) {
  return {
    id,
    type: 'intro',
    acfBlock: 'acf/text-section' as const,
    variant: 'editorial',
    content: {
      headline: 'A considered place to live',
      content: 'Explore details documented by the property team.',
      layout: 'center',
      background: 'white',
    },
    reasoning: 'Introduce the property',
    order: 1,
    evidenceIds: ['property-evidence'],
  }
}

function boundEvidence(repeated = false): BoundCritiqueEvidence {
  const pages: SiteBlueprint['pages'] = [
    {
      slug: 'home',
      title: 'Home',
      purpose: 'Introduce the property',
      sections: [section('home-intro')],
    },
    ...(repeated
      ? [
          {
            slug: 'amenities',
            title: 'Amenities',
            purpose: 'Explain amenities',
            sections: [section('amenities-intro')],
          },
        ]
      : []),
  ]
  const screenshots = pages.flatMap(page =>
    (['desktop', 'tablet', 'mobile'] as const).map(viewport => ({
      descriptor: {
        url:
          page.slug === 'home'
            ? 'https://example.com/'
            : `https://example.com/${page.slug}/`,
        viewport,
        width: viewport === 'desktop' ? 1440 : 390,
        height: 900,
        storagePath: `${page.slug}-${viewport}.png`,
        sha256: `${page.slug === 'home' ? 'b' : 'c'}`.repeat(64),
        bytes: 8,
        contentType: 'image/png' as const,
        identityDigest: `${viewport === 'desktop' ? 'd' : viewport === 'tablet' ? 'e' : 'f'}`.repeat(64),
      },
      bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    }))
  )
  return {
    artifact: {
      id: ARTIFACT_ID,
      contentHash: CONTENT_HASH,
      createdAt: '2026-08-10T19:00:00.000Z',
      blueprint: { version: 1, pages },
    },
    certificationEvidenceId: '22222222-2222-4222-8222-222222222222',
    evidenceDigest: '1'.repeat(64),
    certificationReportHash: '2'.repeat(64),
    certificationBindingHash: '3'.repeat(64),
    capturedAt: '2026-08-10T19:30:00.000Z',
    targetUrl: 'https://example.com',
    screenshots,
    screenshotManifestDigest: '4'.repeat(64),
  }
}

describe('rendered aesthetic critique service', () => {
  it('preserves severity and emits approval-bound proposal-only repairs', async () => {
    const evidence = boundEvidence()
    const desktop = evidence.screenshots[0].descriptor
    const provider = vi.fn().mockResolvedValue({
      findings: [
        {
          category: 'hierarchy',
          severity: 'major',
          title: 'Primary heading lacks emphasis',
          critique: 'The main heading and body copy render at similar emphasis.',
          evidence: [
            {
              pageUrl: desktop.url,
              viewport: desktop.viewport,
              screenshotSha256: desktop.sha256,
              screenshotIdentityDigest: desktop.identityDigest,
              observation: 'The heading does not dominate the opening viewport.',
            },
          ],
          affectedSectionIds: ['home-intro'],
          confidence: 0.91,
          suggestedOperations: [
            {
              version: 2,
              op: 'section.update',
              sectionId: 'home-intro',
              value: { variant: 'lead' },
              reasoning: 'Use a supported lead treatment.',
            },
          ],
          repairSummary: 'Use the supported lead variant for the opening section.',
        },
      ],
    })

    const report = await createRenderedAestheticCritique({
      evidence,
      provider,
      generatedAt: '2026-08-10T20:00:00.000Z',
    })

    expect(report.highestSeverity).toBe('major')
    expect(report.provider.status).toBe('succeeded')
    expect(report.proposals).toHaveLength(1)
    expect(report.proposals[0]).toMatchObject({
      approval: {
        required: true,
        status: 'pending',
        artifactId: ARTIFACT_ID,
        contentHash: CONTENT_HASH,
        evidenceDigest: '1'.repeat(64),
      },
      factualGuards: {
        strategy: 'siteforge_editor_factual_guard',
        rejectNewFacts: true,
      },
      rerunTargets: {
        canonicalPreview: true,
        browserCertification: true,
      },
      directMutation: false,
    })
  })

  it('returns deterministic evidence and bounded repair when provider fails', async () => {
    const report = await createRenderedAestheticCritique({
      evidence: boundEvidence(true),
      provider: vi.fn().mockRejectedValue(new Error('provider offline')),
      generatedAt: '2026-08-10T20:00:00.000Z',
    })

    expect(report.provider).toMatchObject({
      status: 'failed',
      failureCode: 'provider_unavailable',
    })
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'deterministic',
          category: 'repetition',
        }),
      ])
    )
    expect(report.deterministicChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'deterministic.repeated_page_composition',
          triggered: true,
        }),
      ])
    )
    expect(report.proposals.length).toBeGreaterThan(0)
    expect(
      report.proposals.reduce(
        (total, proposal) => total + proposal.operations.length,
        0
      )
    ).toBeLessThanOrEqual(12)
  })

  it('drops fabricated screenshot references and unsafe mutations', async () => {
    const evidence = boundEvidence()
    const provider = vi.fn().mockResolvedValue({
      findings: [
        {
          category: 'imagery_cropping',
          severity: 'blocker',
          title: 'Fabricated crop issue',
          critique: 'Not linked to supplied evidence.',
          evidence: [
            {
              pageUrl: 'https://example.com/',
              viewport: 'desktop',
              screenshotSha256: '9'.repeat(64),
              screenshotIdentityDigest: '8'.repeat(64),
              observation: 'Invented reference.',
            },
          ],
          affectedSectionIds: ['home-intro'],
          confidence: 1,
          suggestedOperations: [
            {
              version: 2,
              op: 'section.remove',
              sectionId: 'home-intro',
            },
          ],
          repairSummary: 'Unsafe deletion.',
        },
      ],
    })
    const report = await createRenderedAestheticCritique({
      evidence,
      provider,
      generatedAt: '2026-08-10T20:00:00.000Z',
    })

    expect(report.findings).toHaveLength(0)
    expect(report.proposals).toHaveLength(0)
    expect(report.highestSeverity).toBeNull()
  })
})
