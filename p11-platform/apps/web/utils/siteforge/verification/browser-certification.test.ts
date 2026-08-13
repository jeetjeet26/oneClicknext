import { describe, expect, it } from 'vitest'
import { certifyBrowserEvidence } from './browser-certification'
import {
  SITEFORGE_BROWSER_EVIDENCE_VERSION,
  browserCertificationEvidenceSchema,
  type BrowserCertificationEvidence,
} from './browser-evidence'
import { buildCertificationBindingHash } from './certification-binding'

const url = 'https://example.com/'
const hash = 'a'.repeat(64)
const artifactId = '11111111-1111-4111-8111-111111111111'
const artifact = {
  artifactId,
  contentHash: hash,
  runtimePackageSha256: 'b'.repeat(64),
  runtimeManifestSha256: 'c'.repeat(64),
  overlayPackageSha256: null,
  assetManifestHash: 'd'.repeat(64),
  operationSetHash: 'e'.repeat(64),
}

function certificationInput(
  evidence?: unknown,
  overrides: Partial<Parameters<typeof certifyBrowserEvidence>[0]> = {}
): Parameters<typeof certifyBrowserEvidence>[0] {
  const environment = overrides.environment ?? 'production'
  const access = overrides.access ?? 'public'
  const requireIndexable = overrides.requireIndexable ?? true
  const bindingHash = buildCertificationBindingHash({
    artifact,
    targetUrl: url,
    environment,
    access,
    requireIndexable,
  })
  if (
    evidence &&
    typeof evidence === 'object' &&
    'identity' in evidence
  ) {
    const complete = evidence as BrowserCertificationEvidence
    complete.identity.environment = environment
    complete.identity.access = access
    complete.identity.requireIndexable = requireIndexable
    complete.identity.artifactBinding = artifact
    complete.identity.bindingHash = bindingHash
    complete.baselineDiffs.forEach(diff => {
      diff.baselineBindingHash = bindingHash
    })
    complete.lighthouse.runs.forEach(run => {
      run.bindingHash = bindingHash
    })
  }
  return {
    evidence,
    targetUrl: url,
    expectedUrls: [url],
    evaluatedAt: '2026-07-31T20:01:00.000Z',
    environment,
    access,
    requireIndexable,
    artifact,
    bindingHash,
    ...overrides,
  }
}

function passingEvidence(): BrowserCertificationEvidence {
  const viewports = [
    ['desktop', 1440, 1000],
    ['tablet', 834, 1112],
    ['mobile', 390, 844],
  ] as const
  return {
    evidenceVersion: SITEFORGE_BROWSER_EVIDENCE_VERSION,
    capturedAt: '2026-07-31T20:00:00.000Z',
    identity: {
      sessionId: 'browserbase-session-1',
      targetUrl: url,
      environment: 'production',
      access: 'public',
      requireIndexable: true,
      artifact: { artifactId, contentHash: hash },
      artifactBinding: artifact,
      bindingHash: buildCertificationBindingHash({
        artifact,
        targetUrl: url,
        environment: 'production',
        access: 'public',
        requireIndexable: true,
      }),
    },
    screenshots: viewports.map(([viewport, width, height]) => ({
      url,
      viewport,
      width,
      height,
      storagePath: `browser-certification/${artifactId}/production/session/${viewport}-${hash}.png`,
      sha256: hash,
      bytes: 1024,
      contentType: 'image/png' as const,
      identityDigest: 'f'.repeat(64),
    })),
    baselineDiffs: viewports.map(([viewport]) => ({
      url,
      viewport,
      baselineId: `11111111-1111-4111-8111-11111111111${
        viewport === 'desktop' ? '2' : viewport === 'tablet' ? '3' : '4'
      }`,
      baselineStoragePath: `browser-certification/${artifactId}/baselines/${viewport}-${hash}.png`,
      baselineSha256: hash,
      baselineBindingHash: buildCertificationBindingHash({
        artifact,
        targetUrl: url,
        environment: 'production',
        access: 'public',
        requireIndexable: true,
      }),
      baselineEvidenceDigest: 'f'.repeat(64),
      baselineApprovalId: '22222222-2222-4222-8222-222222222222',
      baselineApprovedAt: '2026-07-30T20:00:00.000Z',
      baselineApprovedBy: '33333333-3333-4333-8333-333333333333',
      actualStoragePath: `browser-certification/${artifactId}/production/session/${viewport}-${hash}.png`,
      actualSha256: hash,
      comparisonMethod: 'pixelmatch-v2' as const,
      mismatchRatio: 0,
      mismatchThreshold: 0.0002 as const,
      mismatchedPixels: 0,
      totalPixels: 1_000_000,
      dimensionsMatch: true,
    })),
    layout: viewports.map(([viewport]) => ({
      url,
      viewport,
      horizontalOverflowPixels: 0,
      cumulativeLayoutShift: 0.02,
    })),
    interactions: {
      pages: [{
        url,
        linksTested: 1,
        buttonsTested: 2,
        navigation: [{
          requestedUrl: 'https://example.com/floor-plans/',
          finalUrl: 'https://example.com/floor-plans/',
          status: 200,
          passed: true,
        }],
        network: [{
          url: 'https://example.com/api/leads',
          method: 'POST',
          resourceType: 'fetch',
          aborted: true,
        }],
        forms: [{
          id: 'lead-form',
          attempted: true,
          validationObserved: true,
          destinationVerified: true,
          payloadVerified: true,
          sideEffectPrevented: true,
          request: {
            url: 'https://example.com/api/leads',
            method: 'POST',
            payload: { email: 'browser-certification@example.invalid' },
            aborted: true,
          },
          resultingState: 'error',
        }],
        widgets: [{ id: 'chat', opened: true, usable: true }],
        keyboard: { traversed: true, traps: [], unreachableControls: [] },
        focus: { visible: true, orderValid: true, obscuredControls: [] },
      }],
    },
    accessibility: {
      scans: [{
        url,
        engine: 'axe-core',
        engineVersion: '4.12.1',
        findings: [],
      }],
    },
    lighthouse: {
      runs: [{
        url,
        finalUrl: url,
        formFactor: 'mobile',
        source: 'lighthouse',
        lighthouseVersion: '13.0.0',
        generatedAt: '2026-07-31T19:55:00.000Z',
        reportStoragePath: `browser-certification/${artifactId}/lighthouse/mobile.json`,
        reportSha256: 'b'.repeat(64),
        provider: 'http-lighthouse',
        providerRunId: 'run-1',
        runnerBinarySha256: 'c'.repeat(64),
        runnerConfigSha256: 'd'.repeat(64),
        toolManifestSha256: 'e'.repeat(64),
        bindingHash: buildCertificationBindingHash({
          artifact,
          targetUrl: url,
          environment: 'production',
          access: 'public',
          requireIndexable: true,
        }),
        performance: 0.9,
        accessibility: 1,
        bestPractices: 0.95,
        seo: 1,
        largestContentfulPaintMs: 2_000,
        cumulativeLayoutShift: 0.02,
        totalBlockingTimeMs: 100,
      }],
    },
    seo: {
      pages: [{
        url,
        canonicalUrl: url,
        openGraph: {
          title: 'Example',
          description: 'Example property',
          imageUrl: 'https://example.com/og.jpg',
          url,
        },
        jsonLd: [{ valid: true, types: ['ApartmentComplex'], errors: [] }],
      }],
      sitemap: {
        url: 'https://example.com/wp-sitemap.xml',
        status: 200,
        listedUrls: [url],
      },
      robots: {
        url: 'https://example.com/robots.txt',
        status: 200,
        sitemapUrls: ['https://example.com/wp-sitemap.xml'],
        blockedCriticalUrls: [],
      },
    },
    redirects: {
      entries: [],
      criticalRoutes: [{
        requestedUrl: url,
        finalUrl: url,
        status: 200,
        hops: 0,
      }],
    },
    consent: {
      defaultState: 'denied',
      bannerVisible: true,
      preferenceControlsUsable: true,
      declineTested: true,
      grantTested: true,
      scripts: [{
        src: 'https://analytics.example.com/tag.js',
        category: 'analytics',
        loadedBeforeConsent: false,
        loadedAfterConsent: true,
      }],
    },
  }
}

describe('browser certification suite', () => {
  it('integrates approved screenshots, Axe, interaction interception, consent, network, and Lighthouse evidence', () => {
    const report = certifyBrowserEvidence(
      certificationInput(passingEvidence())
    )

    expect(report.passed).toBe(true)
    expect(report.evidenceAccepted).toBe(true)
    expect(report.capturedAt).toBe('2026-07-31T20:00:00.000Z')
    expect(report.screenshots).toHaveLength(3)
    expect(report.screenshots[0]).toEqual(
      expect.objectContaining({
        storagePath: expect.stringContaining('browser-certification/'),
        identityDigest: 'f'.repeat(64),
      })
    )
    expect(report.checks.map(check => check.code)).toEqual(
      expect.arrayContaining([
        'evidence.identity',
        'visual.viewport_manifest',
        'visual.baseline_diff',
        'interaction.forms_widgets_keyboard_focus',
        'accessibility.critical_axe',
        'performance.lighthouse_mobile_budget',
        'seo.canonical_og_jsonld',
        'seo.sitemap_robots',
      ])
    )
    expect(passingEvidence().interactions.pages[0]).toEqual(
      expect.objectContaining({
        navigation: [expect.objectContaining({ passed: true })],
        network: [
          expect.objectContaining({
            url: 'https://example.com/api/leads',
            aborted: true,
          }),
        ],
        forms: [
          expect.objectContaining({
            destinationVerified: true,
            payloadVerified: true,
            sideEffectPrevented: true,
          }),
        ],
        widgets: [expect.objectContaining({ opened: true, usable: true })],
        keyboard: expect.objectContaining({ traversed: true, traps: [] }),
      })
    )
  })

  it('accepts bounded rasterization drift and rejects changes above policy', () => {
    const bounded = passingEvidence()
    for (const diff of bounded.baselineDiffs) {
      diff.mismatchedPixels = 165
      diff.totalPixels = 1_000_000
      diff.mismatchRatio = 0.000165
    }
    expect(certifyBrowserEvidence(certificationInput(bounded)).passed).toBe(true)

    const excessive = passingEvidence()
    excessive.baselineDiffs[0].mismatchedPixels = 201
    excessive.baselineDiffs[0].totalPixels = 1_000_000
    excessive.baselineDiffs[0].mismatchRatio = 0.000201
    expect(certifyBrowserEvidence(certificationInput(excessive)).passed).toBe(
      false
    )
  })

  it('rejects legacy synthetic evidence and current-image self comparisons', () => {
    const legacy = certifyBrowserEvidence(
      certificationInput({
        evidenceVersion: 'siteforge-browser-evidence-v1',
        capturedAt: '2026-07-31T20:00:00.000Z',
      })
    )
    expect(legacy.passed).toBe(false)
    expect(legacy.evidenceAccepted).toBe(false)

    const evidence = passingEvidence()
    evidence.baselineDiffs[0].baselineStoragePath =
      evidence.baselineDiffs[0].actualStoragePath
    expect(browserCertificationEvidenceSchema.safeParse(evidence).success).toBe(false)
  })

  it('fails public staging when a real Lighthouse report is missing', () => {
    const evidence = passingEvidence()
    evidence.identity.environment = 'staging'
    evidence.identity.requireIndexable = false
    evidence.lighthouse.runs = []
    const report = certifyBrowserEvidence(certificationInput(evidence, {
      environment: 'staging',
      requireIndexable: false,
    }))

    expect(report.passed).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        code: 'performance.lighthouse_mobile_budget',
        passed: false,
      })
    )
    expect(report.checks.some(check => check.code === 'seo.sitemap_robots')).toBe(false)
  })

  it('never auto-accepts the first captured screenshot as a baseline', () => {
    const evidence = passingEvidence()
    evidence.baselineDiffs = []
    const report = certifyBrowserEvidence(certificationInput(evidence))

    expect(report.passed).toBe(false)
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        code: 'visual.baseline_diff',
        passed: false,
      })
    )
  })

  it('enforces presentation checks on public staging independently of indexability', () => {
    const evidence = passingEvidence()
    evidence.identity.environment = 'staging'
    evidence.identity.requireIndexable = false
    evidence.accessibility.scans[0].findings.push({
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Colors do not have sufficient contrast',
      nodes: [{ target: ['main'], html: '<main>' }],
    })
    const report = certifyBrowserEvidence(certificationInput(evidence, {
      environment: 'staging',
      requireIndexable: false,
    }))

    expect(report.passed).toBe(false)
    expect(report.checks).toContainEqual(expect.objectContaining({
      code: 'accessibility.critical_axe',
      passed: false,
    }))
  })

  it('defers public presentation checks only for protected preview', () => {
    const evidence = passingEvidence()
    evidence.identity.environment = 'protected_preview'
    evidence.identity.access = 'protected'
    evidence.identity.requireIndexable = false
    evidence.lighthouse.runs = []
    evidence.accessibility.scans = []
    evidence.seo.pages = []
    const report = certifyBrowserEvidence(certificationInput(evidence, {
      environment: 'protected_preview',
      access: 'protected',
      requireIndexable: false,
    }))

    expect(report.passed).toBe(true)
    expect(report.checks).toContainEqual(expect.objectContaining({
      code: 'performance.lighthouse_mobile_budget',
      passed: true,
      evidence: expect.objectContaining({ deferredTo: 'public_staging' }),
    }))
  })

  it('does not treat a button as proof of form submission', () => {
    const evidence = passingEvidence()
    evidence.interactions.pages[0].forms[0].sideEffectPrevented = false
    evidence.interactions.pages[0].forms[0].resultingState = 'success'
    const report = certifyBrowserEvidence(certificationInput(evidence))

    expect(report.passed).toBe(false)
    expect(report.checks).toContainEqual(expect.objectContaining({
      code: 'interaction.forms_widgets_keyboard_focus',
      passed: false,
    }))
  })

  it.each([
    ['axe', (evidence: BrowserCertificationEvidence) => {
      evidence.accessibility.scans[0].findings.push({
        ruleId: 'aria-required-attr',
        impact: 'critical',
        description: 'Required ARIA attributes are missing',
        nodes: [{ target: ['button'], html: '<button>' }],
      })
    }],
    ['interaction', (evidence: BrowserCertificationEvidence) => {
      evidence.interactions.pages[0].keyboard.traps.push('focus trap')
    }],
    ['SEO', (evidence: BrowserCertificationEvidence) => {
      evidence.seo.pages[0].openGraph.url = 'https://example.com/wrong/'
    }],
    ['Lighthouse', (evidence: BrowserCertificationEvidence) => {
      evidence.lighthouse.runs[0].performance = 0.79
    }],
    ['redirect', (evidence: BrowserCertificationEvidence) => {
      evidence.redirects.criticalRoutes[0].finalUrl =
        'https://example.com/wrong/'
    }],
  ])('blocks public certification on failed %s evidence', (_name, mutate) => {
    const evidence = passingEvidence()
    mutate(evidence)
    expect(certifyBrowserEvidence(certificationInput(evidence)).passed).toBe(
      false
    )
  })
})
