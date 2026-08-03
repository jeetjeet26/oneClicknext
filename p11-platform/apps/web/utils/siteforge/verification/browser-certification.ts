import {
  browserCertificationEvidenceSchema,
  browserCertificationReportSchema,
  SITEFORGE_BROWSER_EVIDENCE_VERSION,
  SITEFORGE_CERTIFICATION_POLICY_VERSION,
  type BrowserCertificationCheck,
  type BrowserCertificationEvidence,
  type BrowserCertificationReport,
} from './browser-evidence'
import { evaluateConsentPolicy } from './consent-policy'

const VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const

export interface BrowserCertificationInput {
  evidence?: unknown
  expectedUrls: string[]
  criticalUrls?: string[]
  evaluatedAt?: string
}

function normalizedUrl(value: string): string {
  const url = new URL(value)
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function key(url: string, viewport?: string): string {
  return `${normalizedUrl(url)}${viewport ? `|${viewport}` : ''}`
}

function check(
  code: string,
  category: BrowserCertificationCheck['category'],
  passed: boolean,
  message: string,
  evidence: Record<string, unknown>,
  waiverClass: BrowserCertificationCheck['waiverClass'] = 'waivable'
): BrowserCertificationCheck {
  return {
    code,
    category,
    passed,
    severity: 'blocker',
    waiverClass,
    message,
    evidence,
  }
}

function missingEvidenceReport(evaluatedAt: string, issues: unknown): BrowserCertificationReport {
  return browserCertificationReportSchema.parse({
    policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
    evidenceVersion: SITEFORGE_BROWSER_EVIDENCE_VERSION,
    evaluatedAt,
    passed: false,
    evidenceAccepted: false,
    checks: [
      check(
        'evidence.browser.required',
        'evidence',
        false,
        'Complete, versioned browser evidence is required for certification.',
        { issues }
      ),
    ],
  })
}

function evaluateVisual(
  evidence: BrowserCertificationEvidence,
  expectedUrls: string[]
): BrowserCertificationCheck[] {
  const required = expectedUrls.flatMap(url =>
    VIEWPORTS.map(viewport => key(url, viewport))
  )
  const screenshots = new Set(
    evidence.screenshots.map(item => key(item.url, item.viewport))
  )
  const diffs = new Map(
    evidence.baselineDiffs.map(item => [key(item.url, item.viewport), item])
  )
  const layouts = new Map(
    evidence.layout.map(item => [key(item.url, item.viewport), item])
  )
  const missingScreenshots = required.filter(item => !screenshots.has(item))
  const missingDiffs = required.filter(item => !diffs.has(item))
  const missingLayouts = required.filter(item => !layouts.has(item))
  const failedDiffs = required.flatMap(item => {
    const diff = diffs.get(item)
    return diff && (!diff.dimensionsMatch || diff.mismatchRatio > 0.01)
      ? [{ key: item, mismatchRatio: diff.mismatchRatio, dimensionsMatch: diff.dimensionsMatch }]
      : []
  })
  const layoutFailures = required.flatMap(item => {
    const layout = layouts.get(item)
    return layout &&
      (layout.horizontalOverflowPixels > 0 || layout.cumulativeLayoutShift > 0.1)
      ? [{
          key: item,
          overflow: layout.horizontalOverflowPixels,
          cumulativeLayoutShift: layout.cumulativeLayoutShift,
        }]
      : []
  })
  return [
    check(
      'visual.viewport_manifest',
      'visual',
      missingScreenshots.length === 0,
      'Desktop, tablet, and mobile screenshots must cover every certified page.',
      { missing: missingScreenshots }
    ),
    check(
      'visual.baseline_diff',
      'visual',
      missingDiffs.length === 0 && failedDiffs.length === 0,
      'Visual baselines must exist and remain within the one-percent diff budget.',
      { missing: missingDiffs, failures: failedDiffs }
    ),
    check(
      'layout.overflow_and_shift',
      'layout',
      missingLayouts.length === 0 && layoutFailures.length === 0,
      'Certified viewports must have no horizontal overflow and CLS at or below 0.1.',
      { missing: missingLayouts, failures: layoutFailures }
    ),
  ]
}

function evaluateInteractions(
  evidence: BrowserCertificationEvidence,
  expectedUrls: string[]
): BrowserCertificationCheck[] {
  const pages = new Map(
    evidence.interactions.pages.map(page => [normalizedUrl(page.url), page])
  )
  const missing = expectedUrls
    .map(normalizedUrl)
    .filter(url => !pages.has(url))
  const failures = [...pages.entries()].flatMap(([url, page]) => {
    const forms = page.forms
      .filter(form => !form.submitted || !form.validationObserved || !form.destinationVerified)
      .map(form => form.id)
    const widgets = page.widgets
      .filter(widget => !widget.opened || !widget.usable)
      .map(widget => widget.id)
    const keyboardPassed =
      page.keyboard.traversed &&
      page.keyboard.traps.length === 0 &&
      page.keyboard.unreachableControls.length === 0
    const focusPassed =
      page.focus.visible &&
      page.focus.orderValid &&
      page.focus.obscuredControls.length === 0
    return forms.length || widgets.length || !keyboardPassed || !focusPassed
      ? [{ url, forms, widgets, keyboard: page.keyboard, focus: page.focus }]
      : []
  })
  return [
    check(
      'interaction.forms_widgets_keyboard_focus',
      'interaction',
      missing.length === 0 && failures.length === 0,
      'Forms, widgets, keyboard traversal, and focus behavior must be browser-verified.',
      { missing, failures }
    ),
  ]
}

function evaluateAccessibility(
  evidence: BrowserCertificationEvidence,
  expectedUrls: string[]
): BrowserCertificationCheck[] {
  const scans = new Map(
    evidence.accessibility.scans.map(scan => [normalizedUrl(scan.url), scan])
  )
  const missing = expectedUrls.map(normalizedUrl).filter(url => !scans.has(url))
  const criticalFindings = [...scans.values()].flatMap(scan =>
    scan.findings
      .filter(finding => finding.impact === 'critical' || finding.impact === 'serious')
      .map(finding => ({
        url: scan.url,
        ruleId: finding.ruleId,
        impact: finding.impact,
        nodes: finding.nodes.length,
      }))
  )
  return [
    check(
      'accessibility.critical_axe',
      'accessibility',
      missing.length === 0 && criticalFindings.length === 0,
      'Every page requires structured axe evidence with no serious or critical findings.',
      { missing, findings: criticalFindings },
      'critical_accessibility'
    ),
  ]
}

function evaluateLighthouse(
  evidence: BrowserCertificationEvidence,
  expectedUrls: string[]
): BrowserCertificationCheck[] {
  const mobile = new Map(
    evidence.lighthouse.runs
      .filter(run => run.formFactor === 'mobile')
      .map(run => [normalizedUrl(run.url), run])
  )
  const missing = expectedUrls.map(normalizedUrl).filter(url => !mobile.has(url))
  const failures = [...mobile.values()].filter(run =>
    run.performance < 0.8 ||
    run.accessibility < 0.9 ||
    run.bestPractices < 0.9 ||
    run.seo < 0.9 ||
    run.largestContentfulPaintMs > 2_500 ||
    run.cumulativeLayoutShift > 0.1 ||
    run.totalBlockingTimeMs > 300
  )
  return [
    check(
      'performance.lighthouse_mobile_budget',
      'performance',
      missing.length === 0 && failures.length === 0,
      'Mobile Lighthouse scores and Core Web Vitals must remain within policy budgets.',
      { missing, failures }
    ),
  ]
}

function evaluateSeo(
  evidence: BrowserCertificationEvidence,
  expectedUrls: string[]
): BrowserCertificationCheck[] {
  const pages = new Map(evidence.seo.pages.map(page => [normalizedUrl(page.url), page]))
  const missing = expectedUrls.map(normalizedUrl).filter(url => !pages.has(url))
  const pageFailures = expectedUrls.flatMap(expectedUrl => {
    const page = pages.get(normalizedUrl(expectedUrl))
    if (!page) return []
    const validJsonLd = page.jsonLd.some(item => item.valid && item.types.length > 0)
    const passed =
      page.canonicalUrl !== undefined &&
      normalizedUrl(page.canonicalUrl) === normalizedUrl(expectedUrl) &&
      Boolean(
        page.openGraph.title &&
        page.openGraph.description &&
        page.openGraph.imageUrl &&
        page.openGraph.url &&
        normalizedUrl(page.openGraph.url) === normalizedUrl(expectedUrl)
      ) &&
      validJsonLd
    return passed ? [] : [{ url: expectedUrl, page }]
  })
  const sitemapUrls = new Set(evidence.seo.sitemap.listedUrls.map(normalizedUrl))
  const missingFromSitemap = expectedUrls
    .map(normalizedUrl)
    .filter(url => !sitemapUrls.has(url))
  const infrastructurePassed =
    evidence.seo.sitemap.status >= 200 &&
    evidence.seo.sitemap.status < 300 &&
    evidence.seo.robots.status >= 200 &&
    evidence.seo.robots.status < 300 &&
    evidence.seo.robots.sitemapUrls.some(
      url => normalizedUrl(url) === normalizedUrl(evidence.seo.sitemap.url)
    ) &&
    evidence.seo.robots.blockedCriticalUrls.length === 0 &&
    missingFromSitemap.length === 0
  return [
    check(
      'seo.canonical_og_jsonld',
      'seo',
      missing.length === 0 && pageFailures.length === 0,
      'Canonical, Open Graph, and valid JSON-LD evidence is required for every page.',
      { missing, failures: pageFailures }
    ),
    check(
      'seo.sitemap_robots',
      'seo',
      infrastructurePassed,
      'Sitemap and robots evidence must expose every certified page without blocking it.',
      {
        missingFromSitemap,
        blockedCriticalUrls: evidence.seo.robots.blockedCriticalUrls,
      }
    ),
  ]
}

function redirectLoops(
  entries: BrowserCertificationEvidence['redirects']['entries']
): string[][] {
  const next = new Map(entries.map(entry => [normalizedUrl(entry.from), normalizedUrl(entry.to)]))
  const loops: string[][] = []
  for (const start of next.keys()) {
    const path: string[] = []
    const seen = new Map<string, number>()
    let current: string | undefined = start
    while (current && next.has(current)) {
      const prior = seen.get(current)
      if (prior !== undefined) {
        loops.push(path.slice(prior).concat(current))
        break
      }
      seen.set(current, path.length)
      path.push(current)
      current = next.get(current)
    }
  }
  return loops
}

function evaluateRedirects(
  evidence: BrowserCertificationEvidence,
  criticalUrls: string[]
): BrowserCertificationCheck[] {
  const critical = new Map(
    evidence.redirects.criticalRoutes.map(route => [
      normalizedUrl(route.requestedUrl),
      route,
    ])
  )
  const missing = criticalUrls.map(normalizedUrl).filter(url => !critical.has(url))
  const failures = [...critical.values()].filter(route =>
    route.status < 200 ||
    route.status >= 400 ||
    route.hops > 5
  )
  const loops = redirectLoops(evidence.redirects.entries)
  return [
    check(
      'redirects.manifest_integrity',
      'redirects',
      missing.length === 0 && failures.length === 0 && loops.length === 0,
      'Redirect manifests must be loop-free and preserve every critical route.',
      { missing, failures, loops }
    ),
  ]
}

function evaluateConsent(
  evidence: BrowserCertificationEvidence
): BrowserCertificationCheck[] {
  const decision = evaluateConsentPolicy(evidence.consent)
  return [
    check(
      'consent.script_blocking',
      'consent',
      decision.passed,
      'Non-essential scripts must remain blocked until explicit consent.',
      {
        consentPolicyVersion: decision.policyVersion,
        prematurelyLoaded: decision.prematurelyLoaded,
        failedAfterConsent: decision.failedAfterConsent,
        reasons: decision.reasons,
      },
      'legal'
    ),
  ]
}

export function certifyBrowserEvidence(
  input: BrowserCertificationInput
): BrowserCertificationReport {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString()
  const parsed = browserCertificationEvidenceSchema.safeParse(input.evidence)
  if (!parsed.success) {
    return missingEvidenceReport(evaluatedAt, parsed.error.issues)
  }

  const expectedUrls = [...new Set(input.expectedUrls.map(normalizedUrl))]
  const criticalUrls = [
    ...new Set((input.criticalUrls ?? input.expectedUrls).map(normalizedUrl)),
  ]
  const checks = [
    ...evaluateVisual(parsed.data, expectedUrls),
    ...evaluateInteractions(parsed.data, expectedUrls),
    ...evaluateAccessibility(parsed.data, expectedUrls),
    ...evaluateLighthouse(parsed.data, expectedUrls),
    ...evaluateSeo(parsed.data, expectedUrls),
    ...evaluateRedirects(parsed.data, criticalUrls),
    ...evaluateConsent(parsed.data),
  ]
  return browserCertificationReportSchema.parse({
    policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
    evidenceVersion: SITEFORGE_BROWSER_EVIDENCE_VERSION,
    evaluatedAt,
    passed: checks.every(item => item.passed || item.severity !== 'blocker'),
    evidenceAccepted: true,
    checks,
  })
}
