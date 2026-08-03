import { describe, expect, it } from 'vitest'
import { certifyBrowserEvidence } from './browser-certification'
import {
  SITEFORGE_BROWSER_EVIDENCE_VERSION,
  type BrowserCertificationEvidence,
} from './browser-evidence'

const url = 'https://example.com/'
const hash = 'a'.repeat(64)

function passingEvidence(): BrowserCertificationEvidence {
  const viewports = [
    ['desktop', 1440, 1000],
    ['tablet', 768, 1024],
    ['mobile', 390, 844],
  ] as const
  return {
    evidenceVersion: SITEFORGE_BROWSER_EVIDENCE_VERSION,
    capturedAt: '2026-07-31T20:00:00.000Z',
    screenshots: viewports.map(([viewport, width, height]) => ({
      url,
      viewport,
      width,
      height,
      storagePath: `${viewport}.png`,
      sha256: hash,
    })),
    baselineDiffs: viewports.map(([viewport]) => ({
      url,
      viewport,
      baselineSha256: hash,
      actualSha256: hash,
      mismatchRatio: 0,
      dimensionsMatch: true,
      diffStoragePath: `${viewport}-diff.png`,
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
        linksTested: 4,
        buttonsTested: 2,
        forms: [{
          id: 'lead-form',
          submitted: true,
          validationObserved: true,
          destinationVerified: true,
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
        engineVersion: '4.10.0',
        findings: [],
      }],
    },
    lighthouse: {
      runs: [{
        url,
        formFactor: 'mobile',
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
        url: 'https://example.com/sitemap.xml',
        status: 200,
        listedUrls: [url],
      },
      robots: {
        url: 'https://example.com/robots.txt',
        status: 200,
        sitemapUrls: ['https://example.com/sitemap.xml'],
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
  it('passes complete evidence across all certification surfaces', () => {
    const report = certifyBrowserEvidence({
      evidence: passingEvidence(),
      expectedUrls: [url],
      evaluatedAt: '2026-07-31T20:01:00.000Z',
    })

    expect(report.passed).toBe(true)
    expect(report.evidenceAccepted).toBe(true)
    expect(report.checks.map(check => check.code)).toEqual(
      expect.arrayContaining([
        'visual.viewport_manifest',
        'interaction.forms_widgets_keyboard_focus',
        'accessibility.critical_axe',
        'performance.lighthouse_mobile_budget',
        'seo.canonical_og_jsonld',
        'redirects.manifest_integrity',
        'consent.script_blocking',
      ])
    )
  })

  it('fails closed when browser evidence is absent', () => {
    const report = certifyBrowserEvidence({
      expectedUrls: [url],
      evaluatedAt: '2026-07-31T20:01:00.000Z',
    })

    expect(report.passed).toBe(false)
    expect(report.evidenceAccepted).toBe(false)
    expect(report.checks[0].code).toBe('evidence.browser.required')
  })

  it('blocks redirect loops, premature scripts, and critical axe findings', () => {
    const evidence = passingEvidence()
    evidence.redirects.entries = [{
      from: 'https://example.com/a',
      to: 'https://example.com/b',
      status: 301,
    }, {
      from: 'https://example.com/b',
      to: 'https://example.com/a',
      status: 301,
    }]
    evidence.consent.scripts[0].loadedBeforeConsent = true
    evidence.accessibility.scans[0].findings.push({
      ruleId: 'button-name',
      impact: 'critical',
      description: 'Buttons must have discernible text',
      nodes: [{ target: ['button'], html: '<button></button>' }],
    })

    const report = certifyBrowserEvidence({ evidence, expectedUrls: [url] })

    expect(report.passed).toBe(false)
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'redirects.manifest_integrity', passed: false }),
      expect.objectContaining({ code: 'consent.script_blocking', passed: false }),
      expect.objectContaining({
        code: 'accessibility.critical_axe',
        passed: false,
        waiverClass: 'critical_accessibility',
      }),
    ]))
  })
})
