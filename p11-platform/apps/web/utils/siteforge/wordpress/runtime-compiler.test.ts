import { describe, expect, it } from 'vitest'
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
    })
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
      variant: null,
      data: {
        heading: 'Schedule a Tour',
        subheading: 'See your next home',
        benefits: 2,
        benefits_0_label: 'Fast',
        benefits_1_label: 'Easy',
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
            },
            reasoning: 'Primary conversion',
            order: 1,
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
  }
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
