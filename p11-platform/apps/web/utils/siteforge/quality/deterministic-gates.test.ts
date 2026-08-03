import { describe, expect, it } from 'vitest'
import type { GeneratedPage } from '@/types/siteforge'
import type { PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import type { WordPressThemeArtifact } from '@/utils/siteforge/wordpress/theme-artifact'
import {
  createDefaultSiteForgeAnalyticsConfig,
  createDefaultSiteForgeLegalConfig,
  createSiteForgeLegalConfigFromSnapshot,
  evaluateDeterministicSiteForgeQuality,
} from './deterministic-gates'
import {
  createEvidenceSafePlaceholder,
  SITEFORGE_PLACEHOLDER_EVIDENCE_ID,
} from '@/utils/siteforge/generation/evidence-safe-content'
import type { SiteForgePlan } from '@/utils/siteforge/contracts'
import {
  hashBrandForgeContract,
  normalizeBrandForgeContract,
} from '@/utils/brandforge/normalize'

const logoAssetId = '22222222-2222-4222-8222-222222222222'

describe('approved legal projection', () => {
  it('pins the approved legal identity and exact Fair Housing text', () => {
    const legal = createSiteForgeLegalConfigFromSnapshot({
      legal: {
        id: '11111111-1111-4111-8111-111111111111',
        version: 3,
        approved_at: '2026-07-31T20:00:00+00:00',
        effective_at: '2026-08-01T00:00:00+00:00',
        fair_housing: {
          text: 'This property is committed to Equal Housing Opportunity.',
        },
      },
    })

    expect(legal).toMatchObject({
      sourceConfigId: '11111111-1111-4111-8111-111111111111',
      sourceVersion: 3,
      fairHousingDisclaimer:
        'This property is committed to Equal Housing Opportunity.',
    })
    expect(legal.sourceHash).toMatch(/^[a-f0-9]{64}$/)
    expect(legal.approvedAt).toBe('2026-07-31T20:00:00.000Z')
  })

  it('fails closed without approved legal evidence', () => {
    expect(() => createSiteForgeLegalConfigFromSnapshot({ legal: null })).toThrow(
      'approved legal version'
    )
  })
})
const brandContract = normalizeBrandForgeContract({
  identity: { name: 'Example Apartments' },
  logos: {
    variants: [{
      role: 'primary',
      assetId: logoAssetId,
      url: 'https://cdn.example.com/exterior.jpg',
      alt: 'Example Apartments logo',
      restrictions: [],
    }],
  },
  colors: {
    roles: [
      { role: 'primary', name: 'Primary', hex: '#112233', usage: 'Primary' },
      { role: 'secondary', name: 'Secondary', hex: '#445566', usage: 'Secondary' },
      { role: 'accent', name: 'Accent', hex: '#778899', usage: 'Accent' },
    ],
  },
  typography: {
    roles: [
      { role: 'headline', family: 'Example Sans', weights: [700], usage: 'Headlines', fallback: 'Arial, sans-serif' },
      { role: 'body', family: 'Example Serif', weights: [400], usage: 'Body', fallback: 'Georgia, serif' },
    ],
  },
}, { origin: 'imported', approvalStatus: 'approved' })

const pages: GeneratedPage[] = [
  {
    slug: 'home',
    title: 'Home',
    purpose: 'Explore apartment homes and schedule a tour.',
    seo: {
      title: 'Apartment Homes',
      description:
        'Explore available apartment homes, amenities, neighborhood details, and ways to contact the leasing team.',
      canonicalPath: '/',
      noIndex: false,
      structuredData: ['WebPage', 'ApartmentComplex'],
    },
    sections: [
      {
        id: 'intro',
        type: 'intro',
        acfBlock: 'acf/text-section',
        content: {
          headline: 'A considered place to call home',
          content: 'Explore apartment features documented by the property team.',
          layout: 'center',
          background: 'white',
        },
        reasoning: 'Introduce verified property details',
        order: 0,
        evidenceIds: ['property-profile-1'],
      },
    ],
  },
]

const photo = {
  id: 'photo-1',
  sourceAssetId: logoAssetId,
  assetId: '11111111-1111-4111-8111-111111111111',
  contentHash: 'a'.repeat(64),
  altText: 'Apartment community exterior',
  url: 'https://cdn.example.com/exterior.jpg',
  type: 'uploaded' as const,
  category: 'hero',
  quality: 9,
  scene: 'Exterior',
  rightsStatus: 'owned' as const,
  approvalStatus: 'approved' as const,
}
const photoManifest: PhotoManifest = {
  photos: [photo],
  byCategory: {
    hero: [photo],
    amenities: [],
    lifestyle: [],
    gallery: [],
    logos: [],
  },
  assignments: {},
  stats: { uploaded: 1, generated: 0, fromBrandForge: 0, total: 1 },
}
const themeArtifact = {
  theme: { slug: 'oneclick-siteforge' },
  contentHash: 'b'.repeat(64),
  designTokens: {
    colors: {
      primary: '#112233',
      secondary: '#445566',
      accent: '#778899',
    },
    typography: {
      headingFont: 'Example Sans',
      bodyFont: 'Example Serif',
    },
  },
  fontAssets: [
    { role: 'headline', family: 'Example Sans', weights: [700], source: 'fallback', fallback: 'Arial, sans-serif', preload: false },
    { role: 'body', family: 'Example Serif', weights: [400], source: 'fallback', fallback: 'Georgia, serif', preload: false },
  ],
} as unknown as WordPressThemeArtifact
const confirmedPlan = {
  brandSnapshot: {
    assetId: '33333333-3333-4333-8333-333333333333',
    contractVersion: '1.0',
    contractHash: hashBrandForgeContract(brandContract),
    origin: 'imported',
    contract: brandContract,
  },
  enabledCapabilities: [],
  analyticsStrategy: { enabled: false },
  conversionStrategy: { primaryAction: 'contact' },
  pages: [
    {
      slug: 'home',
      title: 'Home',
      sections: [{ id: 'intro', block: 'acf/text-section' }],
    },
  ],
} as unknown as SiteForgePlan

function evaluate(
  candidatePages = pages,
  overrides: Partial<
    Parameters<typeof evaluateDeterministicSiteForgeQuality>[0]
  > = {},
) {
  return evaluateDeterministicSiteForgeQuality({
    pages: candidatePages,
    confirmedPlan,
    photoManifest,
    themeArtifact,
    legal: createDefaultSiteForgeLegalConfig(),
    analytics: createDefaultSiteForgeAnalyticsConfig(),
    evaluatedAt: '2026-07-30T18:00:00.000Z',
    ...overrides,
  })
}

describe('deterministic SiteForge quality gates', () => {
  it('passes evidence-grounded, compliant output inside explicit budgets', () => {
    const report = evaluate()
    expect(report.passed).toBe(true)
    expect(report.checks.every((check) => check.passed)).toBe(true)
  })

  it('blocks discriminatory audience language deterministically', () => {
    const modified = structuredClone(pages)
    modified[0].sections[0].content.content =
      'This safe neighborhood is perfect for young professionals.'
    const report = evaluate(modified)
    expect(report.passed).toBe(false)
    expect(
      report.checks.find((check) => check.id === 'fair_housing_language')
    ).toEqual(expect.objectContaining({ passed: false, severity: 'blocker' }))
  })

  it('blocks factual copy without trusted evidence references', () => {
    const modified = structuredClone(pages)
    modified[0].sections[0].evidenceIds = []
    const report = evaluate(modified)
    expect(report.passed).toBe(false)
    expect(
      report.checks.find((check) => check.id === 'factual_evidence')
    ).toEqual(expect.objectContaining({ passed: false }))
  })

  it('blocks output that changes the confirmed page or section structure', () => {
    const modified = structuredClone(pages)
    modified[0].sections[0].acfBlock = 'acf/content-grid'
    const report = evaluate(modified)

    expect(report.passed).toBe(false)
    expect(
      report.checks.find((check) => check.id === 'confirmed_plan_fidelity')
    ).toEqual(expect.objectContaining({ passed: false, severity: 'blocker' }))
  })

  it('accepts an explicit evidence-safe placeholder', () => {
    const modified = structuredClone(pages)
    modified[0].sections[0].content = createEvidenceSafePlaceholder(
      'acf/text-section',
      'Welcome',
      'home-intro-002'
    ) || {}
    modified[0].sections[0].evidenceIds = [
      SITEFORGE_PLACEHOLDER_EVIDENCE_ID,
    ]

    expect(evaluate(modified).passed).toBe(true)
  })

  it('rejects placeholder policy evidence attached to factual copy', () => {
    const modified = structuredClone(pages)
    modified[0].sections[0].evidenceIds = [
      SITEFORGE_PLACEHOLDER_EVIDENCE_ID,
    ]

    expect(evaluate(modified).passed).toBe(false)
  })

  it('blocks a changed contract behind the pinned brand hash', () => {
    const changedPlan = structuredClone(confirmedPlan)
    changedPlan.brandSnapshot!.contract.colors.roles[0].hex = '#FFFFFF'
    const report = evaluate(pages, { confirmedPlan: changedPlan })
    expect(report.checks.find(check => check.id === 'pinned_brand_hash'))
      .toEqual(expect.objectContaining({ passed: false, severity: 'blocker' }))
  })

  it('blocks substituted brand tokens', () => {
    const changedTheme = structuredClone(themeArtifact)
    changedTheme.designTokens.colors.primary = '#FFFFFF'
    changedTheme.designTokens.typography.headingFont = 'Substitute Sans'
    const report = evaluate(pages, { themeArtifact: changedTheme })
    expect(report.checks.find(check => check.id === 'exact_brand_tokens'))
      .toEqual(expect.objectContaining({ passed: false }))
  })

  it('blocks assets without approval and cleared rights', () => {
    const changedManifest = structuredClone(photoManifest)
    changedManifest.photos[0].approvalStatus = 'pending'
    changedManifest.photos[0].rightsStatus = 'unknown'
    const report = evaluate(pages, { photoManifest: changedManifest })
    expect(report.checks.find(check => check.id === 'asset_rights_and_approval'))
      .toEqual(expect.objectContaining({ passed: false }))
  })

  it('allows an unchanged legacy asset while enforcing metadata on replacements', () => {
    const legacyManifest = structuredClone(photoManifest)
    legacyManifest.photos[0].approvalStatus = 'pending'
    legacyManifest.photos[0].rightsStatus = 'unknown'

    const unchangedReport = evaluate(pages, {
      photoManifest: structuredClone(legacyManifest),
      legacyAssetBaseline: legacyManifest,
    })
    expect(
      unchangedReport.checks.find(
        check => check.id === 'asset_rights_and_approval'
      )
    ).toEqual(expect.objectContaining({ passed: true }))

    const replacementManifest = structuredClone(legacyManifest)
    replacementManifest.photos[0].url =
      'https://cdn.example.com/replacement.jpg'
    replacementManifest.photos[0].contentHash = 'c'.repeat(64)
    const replacementReport = evaluate(pages, {
      photoManifest: replacementManifest,
      legacyAssetBaseline: legacyManifest,
    })
    expect(
      replacementReport.checks.find(
        check => check.id === 'asset_rights_and_approval'
      )
    ).toEqual(expect.objectContaining({ passed: false }))
  })

  it('blocks capabilities absent from the pinned readiness snapshot', () => {
    const changedPlan = structuredClone(confirmedPlan)
    changedPlan.enabledCapabilities = ['crm']
    changedPlan.onboardingSnapshot = {
      id: '44444444-4444-4444-8444-444444444444',
      contentHash: 'c'.repeat(64),
      enabledCapabilities: [],
    }
    const report = evaluate(pages, { confirmedPlan: changedPlan })
    expect(report.checks.find(check => check.id === 'enabled_capability_readiness'))
      .toEqual(expect.objectContaining({ passed: false }))
  })

  it('blocks implicit font substitution without an approved fallback', () => {
    const changedTheme = structuredClone(themeArtifact)
    changedTheme.fontAssets[0].fallback = 'Helvetica, sans-serif'
    const report = evaluate(pages, { themeArtifact: changedTheme })
    expect(report.checks.find(check => check.id === 'font_license_and_fallback'))
      .toEqual(expect.objectContaining({ passed: false }))
  })
})
