import { z } from 'zod'
import type { GeneratedPage } from '@/types/siteforge'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import type { WordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  isEvidenceSafePlaceholder,
  SITEFORGE_PLACEHOLDER_EVIDENCE_ID,
} from '@/utils/siteforge/generation/evidence-safe-content'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import { hashBrandForgeContract } from '@/utils/brandforge/normalize'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const approvedLegalPolicyBodiesSchema = z
  .object({
    privacyPolicy: z.string().trim().min(1).max(100_000),
    terms: z.string().trim().min(1).max(100_000),
    accessibility: z.string().trim().min(1).max(100_000),
    fairHousing: z.string().trim().min(20).max(100_000),
    pricingDisclaimer: z.string().trim().min(1).max(100_000),
    analyticsConsent: z.string().trim().min(1).max(100_000),
    communicationsConsent: z.string().trim().min(1).max(100_000),
  })
  .strict()

export const siteForgeLegalConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceConfigId: z.string().min(1),
    sourceVersion: z.number().int().positive(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveAt: z.string().datetime(),
    approvedAt: z.string().datetime(),
    equalHousingOpportunity: z.literal(true),
    fairHousingDisclaimer: z.string().trim().min(20).max(100_000),
    privacyPath: z.string().startsWith('/'),
    termsPath: z.string().startsWith('/'),
    accessibilityPath: z.string().startsWith('/'),
    policyBodies: approvedLegalPolicyBodiesSchema,
  })
  .strict()
  .superRefine((legal, context) => {
    if (legal.fairHousingDisclaimer !== legal.policyBodies.fairHousing) {
      context.addIssue({
        code: 'custom',
        path: ['fairHousingDisclaimer'],
        message: 'Fair Housing footer text must exactly match its approved policy body',
      })
    }
  })

export const siteForgeAnalyticsConfigSchema = z
  .object({
    consentMode: z.literal('required'),
    events: z.array(z.string()).min(1),
  })
  .strict()

const qualityCheckSchema = z.object({
  id: z.string(),
  category: z.enum([
    'fair_housing',
    'legal',
    'accessibility',
    'seo',
    'analytics',
    'performance',
    'evidence',
    'fidelity',
  ]),
  passed: z.boolean(),
  severity: z.enum(['blocker', 'warning']),
  message: z.string(),
  locations: z.array(z.string()),
})

export const deterministicQualityReportSchema = z.object({
  passed: z.boolean(),
  policyVersion: z.literal('siteforge-deterministic-quality-v1'),
  evaluatedAt: z.string().datetime(),
  checks: z.array(qualityCheckSchema),
  budgets: z.object({
    pages: z.object({ actual: z.number(), maximum: z.number() }),
    sections: z.object({ actual: z.number(), maximum: z.number() }),
    images: z.object({ actual: z.number(), maximum: z.number() }),
    serializedBytes: z.object({ actual: z.number(), maximum: z.number() }),
  }),
})

export type SiteForgeLegalConfig = z.infer<typeof siteForgeLegalConfigSchema>

// Immutable artifacts created before legal provenance hardening carry only
// the original approved fields. They must remain renderable exactly as
// approved, so render/deploy paths accept this shape while quality gates for
// newly generated artifacts still require the full provenance schema above.
export const siteForgeLegacyLegalConfigSchema = z
  .object({
    equalHousingOpportunity: z.literal(true),
    fairHousingDisclaimer: z.string().trim().min(20).max(100_000),
    privacyPath: z.string().startsWith('/'),
    termsPath: z.string().startsWith('/'),
    accessibilityPath: z.string().startsWith('/'),
  })
  .strict()

export type RenderableSiteForgeLegalConfig =
  | SiteForgeLegalConfig
  | z.infer<typeof siteForgeLegacyLegalConfigSchema>

export function parseRenderableSiteForgeLegalConfig(
  value: unknown
): RenderableSiteForgeLegalConfig {
  const hardened = siteForgeLegalConfigSchema.safeParse(value)
  if (hardened.success) return hardened.data
  return siteForgeLegacyLegalConfigSchema.parse(value)
}
export type SiteForgeAnalyticsConfig = z.infer<
  typeof siteForgeAnalyticsConfigSchema
>
export type DeterministicQualityReport = z.infer<
  typeof deterministicQualityReportSchema
>

export function legalEvidenceId(legal: SiteForgeLegalConfig): string {
  return [
    'siteforge-legal',
    legal.sourceConfigId,
    legal.sourceVersion,
    legal.sourceHash,
  ].join(':')
}

const requiredAnalyticsEvents = [
  'page_view',
  'cta_click',
  'floorplan_view',
  'availability_click',
  'lead_start',
  'lead_submit',
  'tour_start',
  'tour_booked',
]

const fairHousingPatterns = [
  /\bperfect for (?:families|singles|young professionals|retirees|students)\b/i,
  /\bideal for (?:families|singles|young professionals|retirees|students)\b/i,
  /\b(?:safe|crime[- ]free) neighborhood\b/i,
  /\b(?:christian|jewish|muslim|hindu|white|black|asian|hispanic) (?:community|neighborhood)\b/i,
  /\bno (?:children|kids|disabled|section 8)\b/i,
  /\badults only\b/i,
]

function collectStrings(
  value: unknown,
  path = 'root'
): Array<{ value: string; path: string }> {
  if (typeof value === 'string') return [{ value, path }]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectStrings(item, `${path}[${index}]`)
    )
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      collectStrings(child, `${path}.${key}`)
    )
  }
  return []
}

function collectInternalLinks(
  value: unknown,
  path = 'pages'
): Array<{ href: string; path: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectInternalLinks(item, `${path}[${index}]`)
    )
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = `${path}.${key}`
    if (
      typeof child === 'string' &&
      /^(?:cta_link|redirect_url|link|url)$/i.test(key) &&
      child.trim().startsWith('/')
    ) {
      return [{ href: child.trim(), path: childPath }]
    }
    return collectInternalLinks(child, childPath)
  })
}

function normalizeInternalPath(href: string): string {
  const path = href.split(/[?#]/, 1)[0] || '/'
  return path === '/' ? '/' : path.replace(/\/+$/, '')
}

export function createDefaultSiteForgeLegalConfig(): SiteForgeLegalConfig {
  throw new Error(
    'SiteForge legal configuration must be derived from approved legal data'
  )
}

function approvedLegalBody(
  legal: Record<string, unknown>,
  key: string
): string | null {
  const document = legal[key]
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return null
  }
  const text = (document as Record<string, unknown>).text
  return typeof text === 'string' && text.trim() ? text.trim() : null
}

export function createSiteForgeLegalConfigFromSnapshot(
  onboardingSnapshot: unknown
): SiteForgeLegalConfig {
  const snapshot =
    onboardingSnapshot &&
    typeof onboardingSnapshot === 'object' &&
    !Array.isArray(onboardingSnapshot)
      ? (onboardingSnapshot as Record<string, unknown>)
      : {}
  const legal =
    snapshot.legal &&
    typeof snapshot.legal === 'object' &&
    !Array.isArray(snapshot.legal)
      ? (snapshot.legal as Record<string, unknown>)
      : null
  const policyBodies = legal
    ? {
        privacyPolicy: approvedLegalBody(legal, 'privacy_policy'),
        terms: approvedLegalBody(legal, 'terms'),
        accessibility: approvedLegalBody(legal, 'accessibility'),
        fairHousing: approvedLegalBody(legal, 'fair_housing'),
        pricingDisclaimer: approvedLegalBody(legal, 'pricing_disclaimer'),
        analyticsConsent: approvedLegalBody(legal, 'analytics_consent'),
        communicationsConsent: approvedLegalBody(
          legal,
          'communications_consent'
        ),
      }
    : null
  if (
    !legal ||
    legal.status !== 'approved' ||
    typeof legal.id !== 'string' ||
    typeof legal.version !== 'number' ||
    typeof legal.approved_at !== 'string' ||
    typeof legal.effective_at !== 'string' ||
    !policyBodies ||
    Object.values(policyBodies).some(body => body === null)
  ) {
    throw new Error(
      'Pinned onboarding snapshot is missing approved legal provenance or exact policy bodies'
    )
  }
  return siteForgeLegalConfigSchema.parse({
    schemaVersion: 1,
    sourceConfigId: legal.id,
    sourceVersion: legal.version,
    sourceHash: hashSiteForgeContent(legal),
    effectiveAt: new Date(legal.effective_at).toISOString(),
    approvedAt: new Date(legal.approved_at).toISOString(),
    equalHousingOpportunity: true,
    fairHousingDisclaimer: policyBodies.fairHousing,
    privacyPath: '/privacy',
    termsPath: '/terms',
    accessibilityPath: '/accessibility',
    policyBodies,
  })
}

export function createDefaultSiteForgeAnalyticsConfig(): SiteForgeAnalyticsConfig {
  return {
    consentMode: 'required',
    events: [...requiredAnalyticsEvents],
  }
}

export function evaluateDeterministicSiteForgeQuality(input: {
  pages: GeneratedPage[]
  confirmedPlan?: SiteForgePlan
  confirmedPlanTopologyPolicy?: 'enforce' | 'report-divergence'
  photoManifest: PhotoManifest
  legacyAssetBaseline?: PhotoManifest
  themeArtifact: WordPressThemeArtifact
  legal: SiteForgeLegalConfig
  analytics: SiteForgeAnalyticsConfig
  /**
   * Evidence ids verified by the caller against a trusted store (for example
   * knowledge-base document rows confirmed to exist for this property).
   * Membership here never bypasses the plan gate for ids the caller did not
   * explicitly verify.
   */
  additionalTrustedEvidenceIds?: readonly string[]
  evaluatedAt?: string
}): DeterministicQualityReport {
  const checks: z.infer<typeof qualityCheckSchema>[] = []
  const legal = siteForgeLegalConfigSchema.safeParse(input.legal)
  // The privacy/terms/accessibility pages are deterministic platform
  // furniture appended during finalization from the approved legal config;
  // they are verified exactly by the legal_and_consent gate below, so the
  // plan-topology comparison excludes them.
  const legalPageSlugs = new Set(
    legal.success
      ? [
          legal.data.privacyPath,
          legal.data.termsPath,
          legal.data.accessibilityPath,
        ].map(path => normalizeInternalPath(path).replace(/^\/+/, ''))
      : []
  )
  if (input.confirmedPlan) {
    const expectedPageSignatures = input.confirmedPlan.pages
      .filter(page => !legalPageSlugs.has(page.slug))
      .map(page => ({
        slug: page.slug,
        title: page.title,
        sections: page.sections.map(section => ({
          id: section.id,
          block: section.block,
        })),
      }))
    const actualPageSignatures = input.pages
      .filter(page => !legalPageSlugs.has(page.slug))
      .map(page => ({
        slug: page.slug,
        title: page.title,
        sections: page.sections.map(section => ({
          id: section.id,
          block: section.acfBlock,
        })),
      }))
    const fidelityPassed =
      JSON.stringify(actualPageSignatures) === JSON.stringify(expectedPageSignatures)
    const topologyIsBlocking =
      input.confirmedPlanTopologyPolicy !== 'report-divergence'
    checks.push({
      id: 'confirmed_plan_fidelity',
      category: 'fidelity',
      passed: fidelityPassed,
      severity: topologyIsBlocking ? 'blocker' : 'warning',
      message: fidelityPassed
        ? 'Generated page and section structure exactly matches the confirmed plan.'
        : topologyIsBlocking
          ? 'Generated page or section structure diverged from the confirmed plan.'
          : 'Post-generation structure diverges from the confirmed plan and is recorded for audit.',
      locations: fidelityPassed ? [] : ['pages'],
    })

    const brandSnapshot = input.confirmedPlan.brandSnapshot
    const brandHashPassed = Boolean(
      brandSnapshot
      && hashBrandForgeContract(brandSnapshot.contract) === brandSnapshot.contractHash,
    )
    checks.push({
      id: 'pinned_brand_hash',
      category: 'fidelity',
      passed: brandHashPassed,
      severity: 'blocker',
      message: brandHashPassed
        ? 'The approved BrandForge contract hash matches the confirmed plan.'
        : 'The confirmed plan is missing or mismatches its approved BrandForge contract.',
      locations: brandHashPassed ? [] : ['brandSnapshot'],
    })

    if (brandSnapshot) {
      const contract = brandSnapshot.contract
      const primaryLogo = contract.logos.variants.find(logo => logo.role === 'primary')
      const headline = contract.typography.roles.find(font => font.role === 'headline')
      const body = contract.typography.roles.find(font => font.role === 'body')
      const primaryColor = contract.colors.roles.find(color => color.role === 'primary')
      const complete = Boolean(primaryLogo && headline && body && primaryColor)
      checks.push({
        id: 'brand_contract_completeness',
        category: 'fidelity',
        passed: complete,
        severity: 'blocker',
        message: complete
          ? 'Required logo, color, and typography roles are approved.'
          : 'Approved brand contract is missing a primary logo, primary color, headline font, or body font.',
        locations: complete ? [] : ['brandSnapshot.contract'],
      })

      const tokenColors = input.themeArtifact.designTokens.colors
      // Approved contracts may list several hexes per role (for example a
      // gold and a sage both approved as primary). The rendered token must be
      // one of the approved hexes for its role; requiring equality with every
      // entry would make multi-color brands unsatisfiable.
      const colorFailures = (['primary', 'secondary', 'accent'] as const).flatMap(
        roleName => {
          const approvedHexes = contract.colors.roles
            .filter(color => color.role === roleName)
            .map(color => color.hex.toLowerCase())
          if (approvedHexes.length === 0) return []
          const token = tokenColors[roleName]?.toLowerCase()
          return token && approvedHexes.includes(token)
            ? []
            : [`colors.${roleName}`]
        }
      )
      const normalizeFont = (font: string) =>
        font.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
      const fontFailures = [
        ...(headline && normalizeFont(input.themeArtifact.designTokens.typography.headingFont) !== normalizeFont(headline.family)
          ? ['typography.headline']
          : []),
        ...(body && normalizeFont(input.themeArtifact.designTokens.typography.bodyFont) !== normalizeFont(body.family)
          ? ['typography.body']
          : []),
      ]
      checks.push({
        id: 'exact_brand_tokens',
        category: 'fidelity',
        passed: colorFailures.length === 0 && fontFailures.length === 0,
        severity: 'blocker',
        message: colorFailures.length === 0 && fontFailures.length === 0
          ? 'Rendered theme tokens preserve approved palette and typography roles.'
          : 'Rendered theme tokens substituted approved brand colors or fonts.',
        locations: [...colorFailures, ...fontFailures],
      })

      const fontSourceFailures = contract.typography.roles.flatMap(role => {
        const rendered = input.themeArtifact.fontAssets.find(font => font.role === role.role)
        if (!rendered) return [`fontAssets.${role.role}`]
        if (role.assetId) {
          return rendered.source === 'asset' && rendered.assetId === role.assetId
            ? []
            : [`fontAssets.${role.role}`]
        }
        return rendered.source === 'fallback' && rendered.fallback === role.fallback
          ? []
          : [`fontAssets.${role.role}`]
      })
      checks.push({
        id: 'font_license_and_fallback',
        category: 'fidelity',
        passed: fontSourceFailures.length === 0,
        severity: 'blocker',
        message: fontSourceFailures.length === 0
          ? 'Brand fonts use approved files or explicit fallback decisions.'
          : 'A brand font lacks its approved file or explicit fallback decision.',
        locations: fontSourceFailures,
      })

      const logoPassed = Boolean(
        primaryLogo
        && input.photoManifest.photos.some(photo =>
          (primaryLogo.assetId && photo.sourceAssetId === primaryLogo.assetId)
          || (primaryLogo.url && photo.url === primaryLogo.url),
        ),
      )
      checks.push({
        id: 'required_brand_logo',
        category: 'fidelity',
        passed: logoPassed,
        severity: 'blocker',
        message: logoPassed
          ? 'The approved primary logo is present in the immutable asset manifest.'
          : 'The approved primary logo is missing or was substituted.',
        locations: logoPassed ? [] : ['photoManifest.logos'],
      })
    }

    const readinessCapabilities =
      input.confirmedPlan.onboardingSnapshot?.enabledCapabilities || []
    const onboardingSnapshot = input.confirmedPlan.onboardingSnapshot
    const onboardingIdentityPassed = Boolean(
      onboardingSnapshot
      && /^[a-f0-9]{64}$/.test(onboardingSnapshot.contentHash)
    )
    checks.push({
      id: 'pinned_onboarding_identity',
      category: 'fidelity',
      passed: onboardingIdentityPassed,
      severity: 'blocker',
      message: onboardingIdentityPassed
        ? 'The approved onboarding snapshot identity remains pinned.'
        : 'The confirmed plan is missing its immutable onboarding snapshot identity.',
      locations: onboardingIdentityPassed ? [] : ['onboardingSnapshot'],
    })
    const missingCapabilities = input.confirmedPlan.enabledCapabilities.filter(
      capability => !readinessCapabilities.includes(capability),
    )
    checks.push({
      id: 'enabled_capability_readiness',
      category: 'fidelity',
      passed: missingCapabilities.length === 0,
      severity: 'blocker',
      message: missingCapabilities.length === 0
        ? 'Every enabled SiteForge capability was approved in onboarding readiness.'
        : 'SiteForge enables capabilities that were not approved in onboarding readiness.',
      locations: missingCapabilities,
    })
  }
  const allStrings = collectStrings(input.pages, 'pages')
  const fairHousingLocations = allStrings.flatMap(({ value, path }) =>
    fairHousingPatterns.some((pattern) => pattern.test(value)) ? [path] : []
  )
  checks.push({
    id: 'fair_housing_language',
    category: 'fair_housing',
    passed: fairHousingLocations.length === 0,
    severity: 'blocker',
    message:
      fairHousingLocations.length === 0
        ? 'No deterministic fair-housing language violations detected.'
        : 'Potentially discriminatory audience or neighborhood language was detected.',
    locations: fairHousingLocations,
  })

  const legalPageFailures = legal.success
    ? [
        {
          path: legal.data.privacyPath,
          body: legal.data.policyBodies.privacyPolicy,
        },
        {
          path: legal.data.termsPath,
          body: legal.data.policyBodies.terms,
        },
        {
          path: legal.data.accessibilityPath,
          body: legal.data.policyBodies.accessibility,
        },
      ].flatMap(({ path, body }) => {
        const slug = normalizeInternalPath(path).replace(/^\/+/, '')
        const matches = input.pages.filter(page => page.slug === slug)
        if (matches.length !== 1) return [`pages.${slug}`]
        const exactPolicySections = matches[0].sections.filter(
          section =>
            section.acfBlock === 'acf/text-section' &&
            section.content.content === body &&
            section.evidenceIds?.includes(
              legalEvidenceId(legal.data)
            )
        )
        return exactPolicySections.length === 1 ? [] : [`pages.${slug}.policy`]
      })
    : ['legal.provenance']
  const formsWithoutConsent = input.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.acfBlock === 'acf/form' &&
      (typeof section.content.consent_text !== 'string' ||
        section.content.consent_text.trim().length < 20)
        ? [`${page.slug}.${section.id || section.type}`]
        : []
    )
  )
  checks.push({
    id: 'legal_and_consent',
    category: 'legal',
    passed:
      legal.success &&
      legalPageFailures.length === 0 &&
      formsWithoutConsent.length === 0,
    severity: 'blocker',
    message:
      legal.success &&
      legalPageFailures.length === 0 &&
      formsWithoutConsent.length === 0
        ? 'Approved legal provenance, exact policy pages, and form consent are present.'
        : 'Approved legal provenance, exact policy pages, or explicit form consent is incomplete.',
    locations: [...legalPageFailures, ...formsWithoutConsent],
  })

  const invalidImages = input.photoManifest.photos.flatMap((photo) =>
    !photo.assetId ||
    !photo.contentHash ||
    !photo.altText ||
    !photo.url.startsWith('https://')
      ? [photo.id]
      : []
  )
  const legacyAssets = new Map(
    (input.legacyAssetBaseline?.photos || []).map(photo => [photo.id, photo])
  )
  const unapprovedAssets = input.photoManifest.photos.flatMap(photo => {
    const approved =
      photo.approvalStatus === 'approved'
      && ['owned', 'licensed', 'generated'].includes(photo.rightsStatus || '')
    const legacyAsset = legacyAssets.get(photo.id)
    const unchangedLegacyAsset =
      legacyAsset !== undefined
      && hashSiteForgeContent(photo) === hashSiteForgeContent(legacyAsset)
    return approved || unchangedLegacyAsset ? [] : [photo.id]
  })
  checks.push({
    id: 'asset_rights_and_approval',
    category: 'fidelity',
    passed: unapprovedAssets.length === 0,
    severity: 'blocker',
    message: unapprovedAssets.length === 0
      ? 'Every new or changed asset is approved and rights-cleared.'
      : 'One or more new or changed assets lacks approval or usable rights.',
    locations: unapprovedAssets,
  })
  const sectionIds = input.pages.flatMap((page) =>
    page.sections.map((section) => `${page.slug}:${section.id || ''}`)
  )
  const duplicateSectionIds = sectionIds.filter(
    (id, index) => sectionIds.indexOf(id) !== index
  )
  checks.push({
    id: 'accessible_assets_and_ids',
    category: 'accessibility',
    passed: invalidImages.length === 0 && duplicateSectionIds.length === 0,
    severity: 'blocker',
    message:
      invalidImages.length === 0 && duplicateSectionIds.length === 0
        ? 'Images have durable HTTPS assets and contextual alt text; section IDs are unique.'
        : 'Images or section identifiers violate accessibility contracts.',
    locations: [...invalidImages, ...duplicateSectionIds],
  })

  const invalidSeo = input.pages.flatMap((page) => {
    const seo = page.seo
    return !seo ||
      seo.title.length > 60 ||
      seo.description.length < 50 ||
      seo.description.length > 160 ||
      !seo.canonicalPath.startsWith('/') ||
      !seo.structuredData.includes('WebPage')
      ? [page.slug]
      : []
  })
  const slugs = input.pages.map((page) => page.slug)
  const duplicateSlugs = slugs.filter(
    (slug, index) => slugs.indexOf(slug) !== index
  )
  checks.push({
    id: 'seo_metadata',
    category: 'seo',
    passed: invalidSeo.length === 0 && duplicateSlugs.length === 0,
    severity: 'blocker',
    message:
      invalidSeo.length === 0 && duplicateSlugs.length === 0
        ? 'Canonical paths, metadata lengths, and structured-data contracts are valid.'
        : 'One or more pages have invalid SEO metadata or duplicate slugs.',
    locations: [...invalidSeo, ...duplicateSlugs],
  })

  const generatedPaths = new Set(
    input.pages.map((page) =>
      normalizeInternalPath(page.slug === 'home' ? '/' : `/${page.slug}`)
    )
  )
  const brokenInternalLinks = collectInternalLinks(input.pages).flatMap(
    ({ href, path }) =>
      generatedPaths.has(normalizeInternalPath(href))
        ? []
        : [`${path}=${href}`]
  )
  checks.push({
    id: 'internal_link_integrity',
    category: 'fidelity',
    passed: brokenInternalLinks.length === 0,
    severity: 'blocker',
    message:
      brokenInternalLinks.length === 0
        ? 'Every generated internal link resolves to a generated page slug.'
        : 'One or more generated internal links targets a missing page slug.',
    locations: brokenInternalLinks,
  })

  const analytics = siteForgeAnalyticsConfigSchema.safeParse(input.analytics)
  const missingEvents = requiredAnalyticsEvents.filter(
    (event) => !input.analytics.events.includes(event)
  )
  checks.push({
    id: 'analytics_contract',
    category: 'analytics',
    passed: analytics.success && missingEvents.length === 0,
    severity: 'blocker',
    message:
      analytics.success && missingEvents.length === 0
        ? 'Consent mode and required conversion events are configured.'
        : 'Analytics consent mode or required conversion events are missing.',
    locations: missingEvents,
  })

  const factualBlocks = new Set([
    'acf/text-section',
    'acf/content-grid',
    'acf/feature-section',
    'acf/plans-availability',
    'acf/poi',
    'acf/testimonials',
  ])
  const trustedEvidenceIds = input.confirmedPlan
    ? new Set([
        ...(input.confirmedPlan.evidence || []).map(evidence => evidence.id),
        ...(input.confirmedPlan.knownFacts || []).flatMap(
          fact => fact.evidenceIds
        ),
        ...input.confirmedPlan.pages.flatMap(page =>
          page.sections.flatMap(section => section.evidenceIds || [])
        ),
        // The approved legal config is itself trusted evidence for the exact
        // policy bodies it publishes.
        ...(legal.success ? [legalEvidenceId(legal.data)] : []),
        ...(input.additionalTrustedEvidenceIds || []),
      ])
    : null
  // Copy grounded on the pinned BrandForge contract's own positioning claims
  // cites synthetic ids in this namespace; the contract identity is verified
  // separately by the pinned_brand_hash blocker.
  const brandContextEvidencePrefix = input.confirmedPlan?.propertyId
    ? `brand-context:${input.confirmedPlan.propertyId}:`
    : null
  const ungroundedSections = input.pages.flatMap((page) =>
    page.sections.flatMap((section) => {
      if (!factualBlocks.has(section.acfBlock)) return []
      const evidenceIds = section.evidenceIds || []
      const usesPlaceholderPolicy = evidenceIds.includes(
        SITEFORGE_PLACEHOLDER_EVIDENCE_ID
      )
      const hasValidEvidence =
        evidenceIds.length > 0 &&
        (!usesPlaceholderPolicy ||
          isEvidenceSafePlaceholder(section.acfBlock, section.content)) &&
        evidenceIds.every(
          evidenceId =>
            evidenceId === SITEFORGE_PLACEHOLDER_EVIDENCE_ID ||
            trustedEvidenceIds === null ||
            trustedEvidenceIds.has(evidenceId) ||
            (brandContextEvidencePrefix !== null &&
              evidenceId.startsWith(brandContextEvidencePrefix))
        )
      return hasValidEvidence
        ? []
        : [`${page.slug}.${section.id || section.type}`]
    })
  )
  checks.push({
    id: 'factual_evidence',
    category: 'evidence',
    passed: ungroundedSections.length === 0,
    severity: 'blocker',
    message:
      ungroundedSections.length === 0
        ? 'Fact-bearing sections retain trusted evidence references.'
        : 'Fact-bearing sections are missing evidence references.',
    locations: ungroundedSections,
  })

  const sectionCount = input.pages.reduce(
    (total, page) => total + page.sections.length,
    0
  )
  const serializedBytes = Buffer.byteLength(JSON.stringify(input.pages), 'utf8')
  const budgets = {
    pages: { actual: input.pages.length, maximum: 12 },
    sections: { actual: sectionCount, maximum: 120 },
    images: { actual: input.photoManifest.photos.length, maximum: 80 },
    serializedBytes: { actual: serializedBytes, maximum: 500_000 },
  }
  const exceededBudgets = Object.entries(budgets).flatMap(
    ([name, budget]) => (budget.actual > budget.maximum ? [name] : [])
  )
  checks.push({
    id: 'performance_budgets',
    category: 'performance',
    passed: exceededBudgets.length === 0,
    severity: 'blocker',
    message:
      exceededBudgets.length === 0
        ? 'Generated payload remains within explicit performance budgets.'
        : 'Generated output exceeds one or more performance budgets.',
    locations: exceededBudgets,
  })

  if (
    input.themeArtifact.theme.slug !== 'oneclick-siteforge' ||
    !input.themeArtifact.contentHash
  ) {
    checks.push({
      id: 'theme_integrity',
      category: 'performance',
      passed: false,
      severity: 'blocker',
      message: 'Theme artifact metadata is incomplete.',
      locations: ['wordpressThemeArtifact'],
    })
  }

  return deterministicQualityReportSchema.parse({
    passed: !checks.some(
      (check) => check.severity === 'blocker' && !check.passed
    ),
    policyVersion: 'siteforge-deterministic-quality-v1',
    evaluatedAt: input.evaluatedAt || new Date().toISOString(),
    checks,
    budgets,
  })
}
