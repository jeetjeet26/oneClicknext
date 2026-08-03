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

export const siteForgeLegalConfigSchema = z
  .object({
    equalHousingOpportunity: z.literal(true),
    fairHousingDisclaimer: z.string().min(20).max(1_000),
    privacyPath: z.string().startsWith('/'),
    termsPath: z.string().startsWith('/'),
    accessibilityPath: z.string().startsWith('/'),
    sourceConfigId: z.string().min(1).optional(),
    sourceVersion: z.number().int().positive().optional(),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    approvedAt: z.string().datetime().optional(),
  })
  .strict()

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
export type SiteForgeAnalyticsConfig = z.infer<
  typeof siteForgeAnalyticsConfigSchema
>
export type DeterministicQualityReport = z.infer<
  typeof deterministicQualityReportSchema
>

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

export function createDefaultSiteForgeLegalConfig(): SiteForgeLegalConfig {
  return {
    equalHousingOpportunity: true,
    fairHousingDisclaimer:
      'This community supports the principles of the Fair Housing Act and Equal Opportunity Housing.',
    privacyPath: '/privacy',
    termsPath: '/terms',
    accessibilityPath: '/accessibility',
  }
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
  const fairHousing =
    legal?.fair_housing &&
    typeof legal.fair_housing === 'object' &&
    !Array.isArray(legal.fair_housing)
      ? (legal.fair_housing as Record<string, unknown>)
      : {}
  const disclaimer =
    typeof fairHousing.text === 'string' ? fairHousing.text.trim() : ''
  if (
    !legal ||
    typeof legal.id !== 'string' ||
    typeof legal.version !== 'number' ||
    typeof legal.approved_at !== 'string' ||
    typeof legal.effective_at !== 'string' ||
    disclaimer.length < 20
  ) {
    throw new Error(
      'Pinned onboarding snapshot is missing an approved legal version and Fair Housing text'
    )
  }
  return siteForgeLegalConfigSchema.parse({
    ...createDefaultSiteForgeLegalConfig(),
    fairHousingDisclaimer: disclaimer,
    sourceConfigId: legal.id,
    sourceVersion: legal.version,
    sourceHash: hashSiteForgeContent(legal),
    approvedAt: new Date(legal.approved_at).toISOString(),
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
  photoManifest: PhotoManifest
  legacyAssetBaseline?: PhotoManifest
  themeArtifact: WordPressThemeArtifact
  legal: SiteForgeLegalConfig
  analytics: SiteForgeAnalyticsConfig
  evaluatedAt?: string
}): DeterministicQualityReport {
  const checks: z.infer<typeof qualityCheckSchema>[] = []
  if (input.confirmedPlan) {
    const expectedPageSignatures = input.confirmedPlan.pages.map(page => ({
      slug: page.slug,
      title: page.title,
      sections: page.sections.map(section => ({
        id: section.id,
        block: section.block,
      })),
    }))
    const actualPageSignatures = input.pages.map(page => ({
      slug: page.slug,
      title: page.title,
      sections: page.sections.map(section => ({
        id: section.id,
        block: section.acfBlock,
      })),
    }))
    const fidelityPassed =
      JSON.stringify(actualPageSignatures) === JSON.stringify(expectedPageSignatures)
    checks.push({
      id: 'confirmed_plan_fidelity',
      category: 'fidelity',
      passed: fidelityPassed,
      severity: 'blocker',
      message: fidelityPassed
        ? 'Generated page and section structure exactly matches the confirmed plan.'
        : 'Generated page or section structure diverged from the confirmed plan.',
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
      const colorFailures = contract.colors.roles.flatMap(color => {
        if (!['primary', 'secondary', 'accent'].includes(color.role)) return []
        return tokenColors[color.role]?.toLowerCase() === color.hex.toLowerCase()
          ? []
          : [`colors.${color.role}`]
      })
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

  const legal = siteForgeLegalConfigSchema.safeParse(input.legal)
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
    passed: legal.success && formsWithoutConsent.length === 0,
    severity: 'blocker',
    message:
      legal.success && formsWithoutConsent.length === 0
        ? 'Legal paths, Fair Housing disclosure, and form consent are present.'
        : 'Legal configuration or explicit form consent is incomplete.',
    locations: formsWithoutConsent,
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
  ])
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
          isEvidenceSafePlaceholder(section.acfBlock, section.content))
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
