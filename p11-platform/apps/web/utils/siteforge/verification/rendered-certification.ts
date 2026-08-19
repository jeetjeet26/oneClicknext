import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { GeneratedPage } from '@/types/siteforge'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { WordPressAPIClient } from '@/utils/siteforge/wordpress-client'
import type { BrandForgeContractV1 } from '@/utils/brandforge/contracts'
import { certifyBrowserEvidence } from './browser-certification'
import {
  browserCertificationReportSchema,
  SITEFORGE_CERTIFICATION_POLICY_VERSION,
} from './browser-evidence'
import { collectBrowserCertificationEvidence } from './browser-evidence-provider'
import {
  buildCertificationBindingHash,
  type CertificationArtifactBinding,
} from './certification-binding'
import {
  compileBrandPublicationPackage,
  validateRenderedBrandInheritance,
} from '@/utils/siteforge/brand-design-compiler'
import type { SiteForgeEditAcceptanceContract } from '@/utils/siteforge/editor/edit-acceptance'

const verificationCheckSchema = z.object({
  id: z.string(),
  passed: z.boolean(),
  severity: z.enum(['blocker', 'warning']),
  message: z.string(),
  url: z.string().url().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
})

export const renderedCertificationReportSchema = z.object({
  passed: z.boolean(),
  policyVersion: z.literal(SITEFORGE_CERTIFICATION_POLICY_VERSION),
  artifactId: z.string().uuid(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  targetUrl: z.string().url(),
  verifiedAt: z.string().datetime(),
  checks: z.array(verificationCheckSchema),
  browser: browserCertificationReportSchema,
  pages: z.array(
    z.object({
      slug: z.string(),
      url: z.string().url(),
      status: z.number().int(),
      bytes: z.number().int(),
      responseMs: z.number(),
      bodyHash: z.string(),
    })
  ),
})

export type RenderedCertificationReport = z.infer<
  typeof renderedCertificationReportSchema
>

/**
 * Canonical preview is an iterative review surface: deterministic rendered
 * checks remain blocking, while browser presentation findings are recorded
 * for correction and become blocking on the public staging render. Public
 * staging and production never use this exception.
 */
export function browserFindingsAreAdvisory(input: {
  environment: 'protected_preview' | 'staging' | 'production'
  access: 'protected' | 'public'
}): boolean {
  return (
    input.environment === 'protected_preview' && input.access === 'protected'
  )
}

export function buildRenderedCertificationTruth(
  onboardingSnapshot: unknown,
  approvedImageUrls: string[],
  conversionDestination?: string,
  approvedImageDigests: string[] = [],
) {
  const snapshot = onboardingSnapshot && typeof onboardingSnapshot === 'object' && !Array.isArray(onboardingSnapshot)
    ? onboardingSnapshot as Record<string, unknown>
    : {}
  const legal = snapshot.legal && typeof snapshot.legal === 'object' && !Array.isArray(snapshot.legal)
    ? snapshot.legal as Record<string, unknown>
    : {}
  const requiredText = [
    legal.privacy_policy,
    legal.terms,
    legal.accessibility,
    legal.fair_housing,
    legal.pricing_disclaimer,
    legal.analytics_consent,
    legal.communications_consent,
  ].flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const text = (value as Record<string, unknown>).text
    return typeof text === 'string' && text.trim() ? [text] : []
  })
  return {
    legalVersion: {
      effectiveAt: typeof legal.effective_at === 'string'
        ? legal.effective_at
        : undefined,
      requiredText,
    },
    conversionDestination,
    approvedImageUrls,
    approvedImageDigests,
  }
}

function pageUrl(baseUrl: string, slug: string): string {
  return new URL(slug === 'home' ? '/' : `/${slug}/`, baseUrl).toString()
}

function renderedBlockClass(acfBlock: string): string {
  if (acfBlock === 'acf/accordion-section') return 'block-accordion'
  return acfBlock.replace('acf/', 'block-')
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin
  return [
    ...new Set(
      [...html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)].flatMap(
        (match) => {
          try {
            const url = new URL(match[1].replace(/&amp;/g, '&'), baseUrl)
            return url.origin === origin ? [url.toString()] : []
          } catch {
            return []
          }
        }
      )
    ),
  ].slice(0, 50)
}

function invalidImageLocations(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)].flatMap((match, index) => {
    const tag = match[0]
    const source = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] || ''
    const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1]?.trim() || ''
    return !source || !source.startsWith('https://') || alt.length < 3
      ? [`image:${index + 1}`]
      : []
  })
}

export async function certifyRenderedWordPressArtifact(input: {
  artifactId: string
  contentHash: string
  artifactBinding: CertificationArtifactBinding
  targetUrl: string
  credentials: { username: string; password: string }
  pages: GeneratedPage[]
  verifiedAt?: string
  environment: 'protected_preview' | 'staging' | 'production'
  access: 'protected' | 'public'
  requireIndexable: boolean
  brandContract?: BrandForgeContractV1
  legalVersion?: { effectiveAt?: string; requiredText?: string[] }
  conversionDestination?: string
  approvedImageUrls?: string[]
  approvedImageDigests?: string[]
  browserEvidence?: unknown
  editAcceptanceContract?: SiteForgeEditAcceptanceContract
  parentTargetUrl?: string
}): Promise<RenderedCertificationReport> {
  if (
    input.artifactBinding.artifactId !== input.artifactId ||
    input.artifactBinding.contentHash !== input.contentHash
  ) {
    throw new Error('Certification artifact binding does not match the artifact')
  }
  const bindingHash = buildCertificationBindingHash({
    artifact: input.artifactBinding,
    targetUrl: input.targetUrl,
    environment: input.environment,
    access: input.access,
    requireIndexable: input.requireIndexable,
  })
  const checks: z.infer<typeof verificationCheckSchema>[] = []
  const manifest = await new WordPressAPIClient(
    input.targetUrl,
    input.credentials
  ).getContentManifest()
  checks.push({
    id: 'artifact_manifest_identity',
    passed: manifest.content_hash === input.contentHash,
    severity: 'blocker',
    message:
      manifest.content_hash === input.contentHash
        ? 'Remote WordPress manifest matches the immutable artifact hash.'
        : 'Remote WordPress manifest does not match the approved artifact.',
    evidence: {
      expected: input.contentHash,
      actual: manifest.content_hash,
      pageIds: manifest.page_ids,
    },
  })

  const pageEvidence: RenderedCertificationReport['pages'] = []
  const internalLinks = new Set<string>()
  const renderedHtml: string[] = []
  const stylesheetUrls = new Set<string>()
  for (const page of input.pages) {
    const url = pageUrl(input.targetUrl, page.slug)
    const startedAt = performance.now()
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
    const responseMs = performance.now() - startedAt
    const html = await response.text()
    renderedHtml.push(html)
    for (const match of html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*href=["']([^"']+)["']/gi)) {
      try {
        stylesheetUrls.add(new URL(match[1], url).toString())
      } catch {
        // Invalid stylesheet URLs are covered by secure asset checks.
      }
    }
    const bytes = Buffer.byteLength(html, 'utf8')
    pageEvidence.push({
      slug: page.slug,
      url,
      status: response.status,
      bytes,
      responseMs,
      bodyHash: hashSiteForgeContent(html),
    })

    checks.push({
      id: `page_reachable:${page.slug}`,
      passed:
        response.ok &&
        response.headers.get('content-type')?.includes('text/html') === true,
      severity: 'blocker',
      message: response.ok
        ? `${page.title} returned rendered HTML.`
        : `${page.title} returned HTTP ${response.status}.`,
      url,
      evidence: { status: response.status, bytes, responseMs },
    })
    const missingBlocks = [
      ...new Set(
        page.sections
          .map((section) => renderedBlockClass(section.acfBlock))
          .filter((className) => !html.includes(className))
      ),
    ]
    checks.push({
      id: `critical_blocks:${page.slug}`,
      passed: missingBlocks.length === 0,
      severity: 'blocker',
      message:
        missingBlocks.length === 0
          ? 'All expected blocks rendered non-empty.'
          : 'One or more expected blocks did not render.',
      url,
      evidence: { missingBlocks },
    })
    const invalidImages = invalidImageLocations(html)
    checks.push({
      id: `meaningful_images:${page.slug}`,
      passed: invalidImages.length === 0,
      severity: 'blocker',
      message:
        invalidImages.length === 0
          ? 'Rendered images use HTTPS sources and meaningful alt text.'
          : 'Rendered images are missing HTTPS sources or meaningful alt text.',
      url,
      evidence: { invalidImages },
    })
    const insecureAssets = [
      ...html.matchAll(
        /(?:src|href)=["'](http:\/\/(?!www\.w3\.org)[^"']+)["']/gi
      ),
    ].map((match) => match[1])
    checks.push({
      id: `secure_assets:${page.slug}`,
      passed: insecureAssets.length === 0,
      severity: 'blocker',
      message:
        insecureAssets.length === 0
          ? 'No insecure rendered assets were detected.'
          : 'Insecure rendered asset URLs were detected.',
      url,
      evidence: { insecureAssets },
    })
    if (input.requireIndexable) {
      const robotsHeader = response.headers.get('x-robots-tag') || ''
      const robotsMeta =
        /<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i.exec(
          html
        )?.[1] || ''
      const noindex = /\bnoindex\b/i.test(`${robotsHeader} ${robotsMeta}`)
      checks.push({
        id: `production_indexable:${page.slug}`,
        passed: !noindex,
        severity: 'blocker',
        message: noindex
          ? 'Production page still advertises noindex.'
          : 'Production page is indexable.',
        url,
        evidence: { robotsHeader, robotsMeta },
      })
    }
    checks.push({
      id: `response_budget:${page.slug}`,
      passed: bytes <= 1_000_000 && responseMs <= 3_000,
      severity: 'blocker',
      message:
        bytes <= 1_000_000 && responseMs <= 3_000
          ? 'HTML size and server response time are within certification budgets.'
          : 'HTML size or server response time exceeds certification budgets.',
      url,
      evidence: {
        bytes,
        maximumBytes: 1_000_000,
        responseMs,
        maximumResponseMs: 3_000,
      },
    })
    extractInternalLinks(html, input.targetUrl).forEach((link) =>
      internalLinks.add(link)
    )
  }

  if (input.approvedImageUrls) {
    const approvedPaths = new Set(input.approvedImageUrls.flatMap(value => {
      try {
        return [new URL(value).pathname]
      } catch {
        return []
      }
    }))
    const renderedSources = renderedHtml.flatMap(html =>
      [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1])
    )
    const unapprovedCandidates = renderedSources.filter(value => {
      try {
        return !approvedPaths.has(new URL(value, input.targetUrl).pathname)
      } catch {
        return true
      }
    })
    const approvedDigests = new Set(input.approvedImageDigests || [])
    const unapprovedImages: string[] = []
    for (const value of [...new Set(unapprovedCandidates)]) {
      try {
        const response = await fetch(new URL(value, input.targetUrl), {
          redirect: 'follow',
          signal: AbortSignal.timeout(30_000),
        })
        const digest = response.ok
          ? createHash('sha256')
              .update(new Uint8Array(await response.arrayBuffer()))
              .digest('hex')
          : null
        if (!digest || !approvedDigests.has(digest)) {
          unapprovedImages.push(value)
        }
      } catch {
        unapprovedImages.push(value)
      }
    }
    checks.push({
      id: 'rendered_image_provenance',
      passed: unapprovedImages.length === 0,
      severity: 'blocker',
      message: unapprovedImages.length === 0
        ? 'Every rendered image belongs to the approved immutable asset manifest.'
        : 'Rendered output contains images outside the approved asset manifest.',
      evidence: { unapprovedImages },
    })
  }

  const brokenLinks: Array<{ url: string; status: number | null }> = []
  for (const url of [...internalLinks]) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status >= 400) {
        brokenLinks.push({ url, status: response.status })
      }
    } catch {
      brokenLinks.push({ url, status: null })
    }
  }
  checks.push({
    id: 'critical_internal_links',
    passed: brokenLinks.length === 0,
    severity: 'blocker',
    message:
      brokenLinks.length === 0
        ? 'All discovered internal links are reachable.'
        : 'Broken internal links were detected.',
    evidence: { checked: internalLinks.size, brokenLinks },
  })

  if (input.brandContract) {
    const cssBodies: string[] = []
    for (const url of stylesheetUrls) {
      try {
        const response = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        })
        if (response.ok) cssBodies.push(await response.text())
      } catch {
        // Missing brand tokens below fail closed.
      }
    }
    const renderSurface = [...renderedHtml, ...cssBodies].join('\n')
    const brandPublication = compileBrandPublicationPackage(input.brandContract)
    const inheritance = validateRenderedBrandInheritance(
      renderSurface,
      brandPublication,
    )
    checks.push({
      id: 'computed_brand_inheritance',
      passed: inheritance.passed,
      severity: 'blocker',
      message: inheritance.passed
        ? 'Rendered output preserves the compiled brand tokens and locked assets.'
        : 'Rendered output is missing compiled brand tokens or locked assets.',
      evidence: {
        contractHash: brandPublication.contractHash,
        violations: inheritance.violations,
      },
    })

    const primaryLogo = input.brandContract.logos.variants.find(logo => logo.role === 'primary')
    const logoPassed = Boolean(
      primaryLogo?.url && renderedHtml.some(html => html.includes(primaryLogo.url!)),
    )
    checks.push({
      id: 'rendered_logo_identity',
      passed: logoPassed,
      severity: 'blocker',
      message: logoPassed
        ? 'The approved primary logo rendered.'
        : 'The approved primary logo did not render.',
      evidence: { expectedUrl: primaryLogo?.url },
    })
    const favicon = input.brandContract.logos.variants.find(logo => logo.role === 'favicon')
    if (favicon?.url) {
      const faviconPassed = renderedHtml.some(html =>
        /rel=["'][^"']*(?:icon|shortcut icon)[^"']*["']/i.test(html)
        && html.includes(favicon.url!),
      )
      checks.push({
        id: 'rendered_favicon_identity',
        passed: faviconPassed,
        severity: 'blocker',
        message: faviconPassed ? 'The approved favicon rendered.' : 'The approved favicon did not render.',
        evidence: { expectedUrl: favicon.url },
      })
    }
  }

  if (input.legalVersion) {
    const combined = renderedHtml.join('\n')
    const missingText = (input.legalVersion.requiredText || []).filter(
      text => !combined.includes(text),
    )
    const effectiveDatePassed = !input.legalVersion.effectiveAt
      || combined.includes(input.legalVersion.effectiveAt.slice(0, 10))
    checks.push({
      id: 'rendered_legal_version',
      passed: missingText.length === 0 && effectiveDatePassed,
      severity: 'blocker',
      message: missingText.length === 0 && effectiveDatePassed
        ? 'Approved legal text and effective version rendered.'
        : 'Rendered legal text does not match the approved version.',
      evidence: { missingText, effectiveAt: input.legalVersion.effectiveAt },
    })
  }

  if (input.conversionDestination) {
    const conversionPassed = renderedHtml.some(html =>
      html.includes(input.conversionDestination!),
    )
    checks.push({
      id: 'conversion_destination',
      passed: conversionPassed,
      severity: 'blocker',
      message: conversionPassed
        ? 'The approved conversion destination rendered.'
        : 'The approved conversion destination is missing.',
      evidence: { expected: input.conversionDestination },
    })
  }

  const responsivePassed = renderedHtml.every(html =>
    /<meta\b[^>]*name=["']viewport["']/i.test(html),
  )
  checks.push({
    id: 'responsive_viewport',
    passed: responsivePassed,
    severity: 'blocker',
    message: responsivePassed
      ? 'Every rendered page declares a responsive viewport.'
      : 'One or more rendered pages is missing a responsive viewport.',
  })

  const expectedUrls = input.pages.map(page =>
    pageUrl(input.targetUrl, page.slug)
  )
  const browserEvidence =
    input.browserEvidence ??
    await collectBrowserCertificationEvidence({
      targetUrl: input.targetUrl,
      expectedUrls,
      credentials: input.credentials,
      environment: input.environment,
      access: input.access,
      requireIndexable: input.requireIndexable,
      artifact: input.artifactBinding,
      bindingHash,
      editAcceptanceContract: input.editAcceptanceContract,
      parentTargetUrl: input.parentTargetUrl,
    })
  const browser = certifyBrowserEvidence({
    evidence: browserEvidence,
    targetUrl: input.targetUrl,
    expectedUrls,
    criticalUrls: expectedUrls,
    evaluatedAt: input.verifiedAt,
    environment: input.environment,
    access: input.access,
    requireIndexable: input.requireIndexable,
    artifact: input.artifactBinding,
    bindingHash,
    editAcceptanceContract: input.editAcceptanceContract,
  })
  const advisoryBrowserFindings = browserFindingsAreAdvisory(input)
  checks.push(
    ...browser.checks.map(browserCheck => ({
      id: `browser:${browserCheck.code}`,
      passed: browserCheck.passed,
      severity: advisoryBrowserFindings
        ? ('warning' as const)
        : browserCheck.severity,
      message: browserCheck.message,
      evidence: {
        category: browserCheck.category,
        waiverClass: browserCheck.waiverClass,
        ...browserCheck.evidence,
      },
    }))
  )

  return renderedCertificationReportSchema.parse({
    passed: !checks.some(
      (check) => check.severity === 'blocker' && !check.passed
    ),
    policyVersion: SITEFORGE_CERTIFICATION_POLICY_VERSION,
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    bindingHash,
    evidenceHash: hashSiteForgeContent(browserEvidence ?? null),
    targetUrl: input.targetUrl,
    verifiedAt: input.verifiedAt || new Date().toISOString(),
    checks,
    browser,
    pages: pageEvidence,
  })
}
