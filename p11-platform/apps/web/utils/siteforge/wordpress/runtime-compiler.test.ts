import { describe, expect, it } from 'vitest'
import { ACACIA_REGRESSION_BASELINE_V1 as acacia } from '@/fixtures/acacia-regression.v1'
import { DEFAULT_SITE_CONFIGURATION } from '@/utils/siteforge/blueprint'
import {
  deriveAssetManifestHash,
  hashRuntimeValue,
  type AssetPreparationResult,
} from '@/utils/siteforge/runtime-contract'
import {
  compileSiteForgeRuntimeRelease,
  createSiteForgeDeploymentSubmission,
  type ImmutableSiteForgeRuntimeRelease,
} from './runtime-compiler'
import {
  createSiteForgeLegalConfigFromSnapshot,
  legalEvidenceId,
} from '@/utils/siteforge/quality/deterministic-gates'

describe('SiteForge WordPress runtime v2 compiler', () => {
  it('compiles the complete immutable desired state deterministically', () => {
    const release = makeRelease()
    const before = JSON.stringify(release)
    const first = compileSiteForgeRuntimeRelease({
      release,
      expectedRemoteContentHash: '1'.repeat(64),
    })
    const second = compileSiteForgeRuntimeRelease({
      release: structuredClone(release),
      expectedRemoteContentHash: '1'.repeat(64),
    })

    expect(second).toEqual(first)
    expect(JSON.stringify(release)).toBe(before)
    expect(first.artifactId).toBe(ARTIFACT_ID)
    expect(first.artifactContentHash).toBe(release.artifactContentHash)
    expect(first.operationHash).not.toBe(first.artifactContentHash)
    expect(first.assetManifestHash).not.toBe(first.operationHash)
    expect(Object.isFrozen(first.plan)).toBe(true)

    expect(first.plan).toMatchObject({
      removals: {
        pageKeys: ['page:legacy'],
        pageSlugs: ['old-specials'],
      },
      siteSettings: {
        homepagePageKey: 'page:home',
        logoAssetId: LOGO_ID,
        faviconAssetId: FAVICON_ID,
      },
      legal: {
        fairHousingDisclaimer: 'Equal Housing Opportunity',
      },
      analytics: {
        consentMode: 'required',
      },
      target: {
        mode: 'canonical_preview',
        siteUrl: 'https://wordpress.example.com',
      },
      protection: {
        mode: 'password_noindex',
      },
    })
    expect(first.plan.siteConfiguration).toEqual(
      release.blueprint.siteConfiguration
    )
    expect(first.plan.publicRuntime).toEqual(release.publicRuntime)
    expect(first.plan.designTokens).toEqual(
      release.blueprint.siteConfiguration?.design
    )
    expect(first.plan.navigation.items).toEqual([
      {
        itemKey: 'nav-home',
        label: 'Home',
        pageKey: 'page:home',
        url: null,
        parentItemKey: null,
        target: '_self',
      },
      {
        itemKey: 'nav-amenities',
        label: 'Amenities',
        pageKey: 'page:amenities',
        url: null,
        parentItemKey: 'nav-home',
        target: '_self',
      },
      {
        itemKey: 'nav-contact',
        label: 'Contact',
        pageKey: null,
        url: 'https://leasing.example.com/contact',
        parentItemKey: null,
        target: '_blank',
      },
    ])

    const home = first.plan.pages.find(page => page.slug === 'home')
    expect(home?.sections[0]).toEqual({
      sectionId: 'form-1',
      blockName: 'acf/form',
      order: 0,
      variant: 'card',
      cssClasses: ['conversion-card', 'theme-dark'],
      anchor: 'form-1',
      align: 'wide',
      data: {
        heading: 'Schedule a Tour',
        subheading: 'See your next home',
        benefits: 2,
        benefits_0_label: 'Fast',
        benefits_1_label: 'Easy',
        variant: 'card',
        align: 'wide',
      },
    })
  })

  it('changes only deployment idempotency when remote state becomes stale', () => {
    const release = makeRelease()
    const current = compileSiteForgeRuntimeRelease({
      release,
      expectedRemoteContentHash: '1'.repeat(64),
    })
    const stale = compileSiteForgeRuntimeRelease({
      release,
      expectedRemoteContentHash: '2'.repeat(64),
    })

    expect(stale.artifactId).toBe(current.artifactId)
    expect(stale.artifactContentHash).toBe(current.artifactContentHash)
    expect(stale.assetManifestHash).toBe(current.assetManifestHash)
    expect(stale.operationHash).toBe(current.operationHash)
    expect(stale.plan).toEqual(current.plan)
    expect(stale.deploymentIdempotencyKey).not.toBe(
      current.deploymentIdempotencyKey
    )
  })

  it('rejects mutated artifacts and non-exact selected assets', () => {
    const changed = makeRelease()
    changed.blueprint.pages[0].title = 'Changed after release'
    expect(() =>
      compileSiteForgeRuntimeRelease({
        release: changed,
        expectedRemoteContentHash: null,
      })
    ).toThrow('does not match artifactContentHash')

    const wrongLogo = makeRelease()
    wrongLogo.selectedAssets.logoAssetId = FAVICON_ID
    expect(() =>
      compileSiteForgeRuntimeRelease({
        release: wrongLogo,
        expectedRemoteContentHash: null,
      })
    ).toThrow('has immutable role favicon')
  })

  it('rejects unsupported block variants instead of normalizing them', () => {
    const release = makeRelease()
    release.blueprint.pages[0].sections[0].variant = 'invented-layout'
    release.artifactContentHash = hashRuntimeValue(release.blueprint)

    expect(() =>
      compileSiteForgeRuntimeRelease({
        release,
        expectedRemoteContentHash: null,
      })
    ).toThrow(/Unsupported acf\/form variant/)
  })

  it('rejects broken navigation hierarchy before deployment', () => {
    const release = makeRelease()
    release.blueprint.siteConfiguration!.navigation.items[0].parentId =
      'missing-parent'
    release.artifactContentHash = hashRuntimeValue(release.blueprint)

    expect(() =>
      compileSiteForgeRuntimeRelease({
        release,
        expectedRemoteContentHash: null,
      })
    ).toThrow(/navigation parent missing-parent does not exist/)
  })

  it('compiles exact approved legal data while retaining legacy rows', () => {
    const release = makeRelease()
    const legal = approvedLegal()
    release.legal = legal
    const evidenceId = legalEvidenceId(legal)
    release.blueprint.pages.push(
      ...[
        ['privacy', 'Privacy', legal.policyBodies.privacyPolicy],
        ['terms', 'Terms', legal.policyBodies.terms],
        [
          'accessibility',
          'Accessibility',
          legal.policyBodies.accessibility,
        ],
      ].map(([slug, title, body], index) => ({
        slug,
        title,
        purpose: `Publish approved ${title.toLowerCase()} policy`,
        sections: [
          {
            id: `${slug}-policy`,
            type: 'legal',
            acfBlock: 'acf/text-section' as const,
            content: { headline: title, content: body },
            reasoning: 'Publish exact approved legal policy body',
            order: index,
            evidenceIds: [evidenceId],
          },
        ],
      }))
    )
    release.artifactContentHash = hashRuntimeValue(release.blueprint)

    const compiled = compileSiteForgeRuntimeRelease({
      release,
      expectedRemoteContentHash: null,
    })
    expect(compiled.plan.legal).toEqual(legal)

    release.blueprint.pages.find(page => page.slug === 'privacy')!
      .sections[0].content.content = 'Substituted generic privacy body.'
    release.artifactContentHash = hashRuntimeValue(release.blueprint)
    expect(() =>
      compileSiteForgeRuntimeRelease({
        release,
        expectedRemoteContentHash: null,
      })
    ).toThrow('does not match its exact policy body and provenance')
  })

  it('creates an exact artifact deployment submission', () => {
    const expectedRemoteContentHash = '1'.repeat(64)
    const compiled = compileSiteForgeRuntimeRelease({
      release: makeRelease(),
      expectedRemoteContentHash,
    })
    const prepared = preparedAssets(compiled)
    const submission = createSiteForgeDeploymentSubmission({
      compiled,
      assetPreparation: prepared,
      expectedRemoteContentHash,
    })

    expect(submission).toMatchObject({
      contractVersion: 2,
      artifactId: ARTIFACT_ID,
      artifactContentHash: compiled.artifactContentHash,
      assetManifestHash: compiled.assetManifestHash,
      operationHash: compiled.operationHash,
      expectedRemoteContentHash,
      assetPreparationId: 'prep:fixture',
    })

    expect(() =>
      createSiteForgeDeploymentSubmission({
        compiled,
        assetPreparation: {
          ...prepared,
          artifactId: '99999999-9999-4999-8999-999999999999',
        },
        expectedRemoteContentHash,
      })
    ).toThrow('do not belong to the compiled SiteForge artifact')
  })

  it('keeps existing schema-v1 Acacia artifacts compatible with runtime v2 and new public runtime off', () => {
    const release = makeRelease()
    release.schemaVersion =
      acacia.siteForge.compatibility.artifactSchemaVersion
    release.siteName = acacia.property.name
    release.analytics = { enabled: false, events: [] }
    delete release.publicRuntime
    delete release.target
    delete release.protection

    const compiled = compileSiteForgeRuntimeRelease({
      release,
      expectedRemoteContentHash: null,
    })
    const submission = createSiteForgeDeploymentSubmission({
      compiled,
      assetPreparation: preparedAssets(compiled),
      expectedRemoteContentHash: null,
    })

    expect(compiled.assetPreparation.contractVersion).toBe(
      acacia.siteForge.compatibility.runtimeContractVersion
    )
    expect(submission.contractVersion).toBe(
      acacia.siteForge.compatibility.runtimeContractVersion
    )
    expect(compiled.plan.publicRuntime).toBeUndefined()
    expect(
      acacia.siteForge.existingArtifactFeatureDefaults.publicRuntime
    ).toBe(false)
  })
})

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111'
const LOGO_ID = '22222222-2222-4222-8222-222222222222'
const FAVICON_ID = '33333333-3333-4333-8333-333333333333'

function makeRelease(): ImmutableSiteForgeRuntimeRelease {
  const siteConfiguration = structuredClone(DEFAULT_SITE_CONFIGURATION)
  siteConfiguration.navigation.items = [
    {
      id: 'nav-home',
      label: 'Home',
      href: '/',
    },
    {
      id: 'nav-amenities',
      label: 'Amenities',
      href: '/amenities/',
      parentId: 'nav-home',
    },
    {
      id: 'nav-contact',
      label: 'Contact',
      href: 'https://leasing.example.com/contact',
      external: true,
    },
  ]
  const blueprint = {
    version: 7,
    updatedAt: '2026-08-03T18:00:00.000Z',
    siteConfiguration,
    pages: [
      {
        slug: 'home',
        title: 'Home',
        purpose: 'Convert visitors',
        sections: [
          {
            id: 'form-1',
            type: 'form',
            acfBlock: 'acf/form' as const,
            content: {
              headline: 'Schedule a Tour',
              subheadline: 'See your next home',
              benefits: [{ label: 'Fast' }, { label: 'Easy' }],
              align: 'wide',
            },
            reasoning: 'Primary conversion',
            order: 1,
            variant: 'card',
            cssClasses: ['conversion-card', 'theme-dark'],
          },
        ],
      },
      {
        slug: 'amenities',
        title: 'Amenities',
        purpose: 'Explain community benefits',
        sections: [
          {
            id: 'text-1',
            type: 'text',
            acfBlock: 'acf/text-section' as const,
            content: { headline: 'Designed for daily life' },
            reasoning: 'Introduce amenities',
            order: 1,
          },
        ],
      },
    ],
  }
  const assets = [
    {
      assetId: LOGO_ID,
      sourceUrl: 'https://cdn.example.com/logo.png?signature=one',
      byteHash: 'a'.repeat(64),
      bytes: 2_048,
      mimeType: 'image/png',
      filename: 'logo.png',
      role: 'logo',
      altText: 'Sunset Apartments',
      caption: null,
    },
    {
      assetId: FAVICON_ID,
      sourceUrl: 'https://cdn.example.com/favicon.png?signature=one',
      byteHash: 'b'.repeat(64),
      bytes: 512,
      mimeType: 'image/png',
      filename: 'favicon.png',
      role: 'favicon',
      altText: null,
      caption: null,
    },
  ]
  return {
    schemaVersion: 1,
    siteId: 'site-1',
    artifactId: ARTIFACT_ID,
    artifactContentHash: hashRuntimeValue(blueprint),
    assetManifestHash: deriveAssetManifestHash(assets),
    siteName: 'Sunset Apartments',
    tagline: 'Live close to everything',
    blueprint,
    assets,
    selectedAssets: {
      logoAssetId: LOGO_ID,
      faviconAssetId: FAVICON_ID,
    },
    homepageSlug: 'home',
    removals: {
      pageKeys: ['page:legacy'],
      pageSlugs: ['old-specials'],
    },
    legal: {
      fairHousingDisclaimer: 'Equal Housing Opportunity',
      privacyPolicyUrl: '/privacy/',
    },
    analytics: {
      consentMode: 'required',
      measurementId: 'G-TEST',
    },
    target: {
      mode: 'canonical_preview',
      siteUrl: 'https://wordpress.example.com',
    },
    publicRuntime: {
      enabled: true,
      apiKey: 'luma-key',
      apiBaseUrl: 'https://app.example.com',
      websiteId: ARTIFACT_ID,
      conversionEndpoint: 'https://app.example.com/api/conversions',
      conversionKey: 'conversion-key',
      telemetryEndpoint: 'https://app.example.com/api/telemetry',
    },
    protection: {
      mode: 'password_noindex',
    },
  }
}

function approvedLegal() {
  return createSiteForgeLegalConfigFromSnapshot({
    legal: {
      id: '44444444-4444-4444-8444-444444444444',
      version: 2,
      status: 'approved',
      approved_at: '2026-08-03T17:00:00.000Z',
      effective_at: '2026-08-03T18:00:00.000Z',
      privacy_policy: { text: 'Exact approved privacy policy.' },
      terms: { text: 'Exact approved terms.' },
      accessibility: { text: 'Exact approved accessibility statement.' },
      fair_housing: {
        text: 'Exact approved Equal Housing Opportunity statement.',
      },
      pricing_disclaimer: { text: 'Exact approved pricing disclaimer.' },
      analytics_consent: { text: 'Exact approved analytics consent.' },
      communications_consent: {
        text: 'Exact approved communications consent.',
      },
    },
  })
}

function preparedAssets(
  compiled: ReturnType<typeof compileSiteForgeRuntimeRelease>
): AssetPreparationResult {
  return {
    contractVersion: 2,
    preparationId: 'prep:fixture',
    siteId: compiled.siteId,
    artifactId: compiled.artifactId,
    artifactContentHash: compiled.artifactContentHash,
    assetManifestHash: compiled.assetManifestHash,
    idempotencyKey: compiled.assetPreparation.idempotencyKey,
    preparedAt: '2026-08-03T18:01:00.000Z',
    assets: compiled.assetPreparation.assets.map((asset, index) => ({
      assetId: asset.assetId,
      byteHash: asset.byteHash,
      attachmentId: index + 100,
      url: `https://site.example.com/uploads/${asset.filename}`,
      mimeType: asset.mimeType,
      disposition: 'created',
    })),
  }
}
