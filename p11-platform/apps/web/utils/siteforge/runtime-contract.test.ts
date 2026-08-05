import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_CONFIGURATION } from '@/utils/siteforge/blueprint'
import {
  assetPreparationResultSchema,
  assetPreparationRequestSchema,
  compiledMutationPlanSchema,
  deploymentSubmissionSchema,
  deploymentStatusSchema,
  deriveAssetManifestHash,
  deriveRuntimeIdempotencyKey,
  deriveRuntimeOperationHash,
  runtimeCapabilitiesSchema,
  runtimeErrorResponseSchema,
  runtimeHealthSchema,
  runtimeStateSchema,
  type CompiledMutationPlan,
  type ImmutableRuntimeAsset,
} from './runtime-contract'

describe('SiteForge runtime v2 contract', () => {
  it('parses the shared plugin response fixtures', async () => {
    const [
      health,
      capabilities,
      state,
      preparation,
      deployment,
      staleError,
      preparationRequest,
      deploymentRequest,
    ] = await Promise.all([
      fixture('health.json'),
      fixture('capabilities.json'),
      fixture('state.json'),
      fixture('asset-preparation-result.json'),
      fixture('deployment-succeeded.json'),
      fixture('stale-remote-error.json'),
      fixture('asset-preparation-request.json'),
      fixture('deployment-request.json'),
    ])

    expect(runtimeHealthSchema.parse(health).contractVersion).toBe(2)
    expect(runtimeCapabilitiesSchema.parse(capabilities).authentication).toBe(
      'wordpress_application_password'
    )
    expect(runtimeStateSchema.parse(state).artifactId).toBe(ARTIFACT_ID)
    expect(assetPreparationResultSchema.parse(preparation).assets[0]).toMatchObject({
      attachmentId: 201,
      byteHash: 'd'.repeat(64),
    })
    expect(deploymentStatusSchema.parse(deployment)).toMatchObject({
      transactionId: TRANSACTION_ID,
      appliedContentHash: 'a'.repeat(64),
      runtimeVersion: '2.0.0',
      pageIds: { 'page:home': 101 },
      rollback: { attempted: false },
    })
    expect(runtimeErrorResponseSchema.parse(staleError).error).toMatchObject({
      code: 'stale_remote_state',
      expectedRemoteContentHash: 'f'.repeat(64),
      actualRemoteContentHash: '9'.repeat(64),
    })
    expect(
      assetPreparationRequestSchema.parse(preparationRequest).artifactId
    ).toBe(ARTIFACT_ID)
    expect(
      deploymentSubmissionSchema.parse(deploymentRequest).operationHash
    ).toBe('be380a40eee27d6266a27afc0d7e5dc2cdafedcaff7fd0da0b6b4de31afe6f32')
  })

  it('keeps artifact identity separate from asset and operation hashes', () => {
    const assets = [runtimeAsset()]
    const plan = mutationPlan()
    const assetManifestHash = deriveAssetManifestHash(assets)
    const operationHash = deriveRuntimeOperationHash(plan)

    expect(ARTIFACT_ID).not.toBe(assetManifestHash)
    expect(ARTIFACT_CONTENT_HASH).not.toBe(assetManifestHash)
    expect(operationHash).not.toBe(assetManifestHash)
    expect(operationHash).not.toBe(ARTIFACT_CONTENT_HASH)
  })

  it('ignores expiring source URLs when hashing immutable assets', () => {
    const first = runtimeAsset()
    const second = {
      ...first,
      sourceUrl: 'https://cdn.example.com/logo.png?signature=two',
    }
    expect(deriveAssetManifestHash([first])).toBe(
      deriveAssetManifestHash([second])
    )
  })

  it('binds deployment idempotency to stale remote state', () => {
    const common = {
      siteId: 'site-1',
      artifactId: ARTIFACT_ID,
      artifactContentHash: ARTIFACT_CONTENT_HASH,
      payloadHash: deriveRuntimeOperationHash(mutationPlan()),
    }
    const current = deriveRuntimeIdempotencyKey('deployment', {
      ...common,
      expectedRemoteContentHash: '1'.repeat(64),
    })
    const stale = deriveRuntimeIdempotencyKey('deployment', {
      ...common,
      expectedRemoteContentHash: '2'.repeat(64),
    })

    expect(current).toMatch(/^[a-f0-9]{64}$/)
    expect(stale).not.toBe(current)
  })

  it('accepts strict optional runtime state while preserving legacy plans', () => {
    expect(compiledMutationPlanSchema.parse(mutationPlan())).toEqual(
      mutationPlan()
    )

    const extended = {
      ...mutationPlan(),
      siteConfiguration: structuredClone(DEFAULT_SITE_CONFIGURATION),
      target: {
        mode: 'canonical_preview',
        siteUrl: 'https://wordpress.example.com',
      },
      publicRuntime: {
        enabled: true,
        apiKey: 'runtime-key',
        apiBaseUrl: 'https://app.example.com',
        websiteId: ARTIFACT_ID,
        conversionEndpoint: 'https://app.example.com/api/conversions',
        conversionKey: 'conversion-key',
        telemetryEndpoint: 'https://app.example.com/api/telemetry',
      },
      protection: { mode: 'password_noindex' },
    } as const
    expect(compiledMutationPlanSchema.parse(extended)).toMatchObject({
      siteConfiguration: DEFAULT_SITE_CONFIGURATION,
      target: { mode: 'canonical_preview' },
      publicRuntime: { enabled: true },
      protection: { mode: 'password_noindex' },
    })

    expect(
      compiledMutationPlanSchema.safeParse({
        ...extended,
        protection: { mode: 'secret-preview' },
      }).success
    ).toBe(false)
    expect(
      compiledMutationPlanSchema.safeParse({
        ...extended,
        siteConfiguration: {
          ...DEFAULT_SITE_CONFIGURATION,
          unexpected: true,
        },
      }).success
    ).toBe(false)
  })

  it('validates block variants and CSS classes as runtime capabilities', () => {
    const valid = mutationPlan()
    valid.pages[0].sections[0] = {
      ...valid.pages[0].sections[0],
      variant: 'editorial',
      cssClasses: ['editorial-copy', 'theme-dark'],
      anchor: 'section:hero',
      align: 'wide',
    }
    expect(compiledMutationPlanSchema.parse(valid).pages[0].sections[0])
      .toMatchObject({
        variant: 'editorial',
        cssClasses: ['editorial-copy', 'theme-dark'],
        anchor: 'section:hero',
        align: 'wide',
      })

    valid.pages[0].sections[0].variant = 'invented-layout'
    expect(compiledMutationPlanSchema.safeParse(valid).success).toBe(false)
  })

  it('rejects unsafe SEO and broken navigation hierarchy', () => {
    const invalidSeo = mutationPlan()
    invalidSeo.pages[0].seo = {
      title: 'Home',
      description: 'Welcome home',
      canonicalPath: 'https://attacker.example/home',
      noIndex: false,
      structuredData: ['not-json'],
    }
    expect(compiledMutationPlanSchema.safeParse(invalidSeo).success).toBe(false)

    const invalidNavigation = mutationPlan()
    invalidNavigation.navigation.items[0].parentItemKey = 'nav:missing'
    expect(
      compiledMutationPlanSchema.safeParse(invalidNavigation).success
    ).toBe(false)
  })
})

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111'
const TRANSACTION_ID = '55555555-5555-4555-8555-555555555555'
const ARTIFACT_CONTENT_HASH = 'a'.repeat(64)

function runtimeAsset(): ImmutableRuntimeAsset {
  return {
    assetId: '22222222-2222-4222-8222-222222222222',
    sourceUrl: 'https://cdn.example.com/logo.png?signature=one',
    byteHash: 'd'.repeat(64),
    bytes: 1_024,
    mimeType: 'image/png',
    filename: 'logo.png',
    role: 'logo',
    altText: 'Property logo',
    caption: null,
  }
}

function mutationPlan(): CompiledMutationPlan {
  return {
    pages: [
      {
        pageKey: 'page:home',
        slug: 'home',
        title: 'Home',
        purpose: 'Convert visitors',
        status: 'publish',
        menuOrder: 0,
        template: '',
        excerpt: '',
        seo: null,
        sections: [
          {
            sectionId: 'section:hero',
            blockName: 'acf/text-section',
            order: 0,
            variant: null,
            data: { headline: 'Welcome home' },
          },
        ],
      },
    ],
    removals: { pageKeys: [], pageSlugs: ['legacy'] },
    navigation: {
      location: 'primary',
      name: 'SiteForge Primary',
      items: [
        {
          itemKey: 'nav:home',
          label: 'Home',
          pageKey: 'page:home',
          url: null,
          parentItemKey: null,
          target: '_self',
        },
      ],
    },
    designTokens: {
      colors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
        background: '#ffffff',
        text: '#111111',
      },
      typography: {
        headingFont: 'Inter, sans-serif',
        bodyFont: 'Inter, sans-serif',
        headingWeight: 600,
      },
      spacing: {
        containerMaxWidth: '1200px',
        sectionPadding: '4rem',
      },
    },
    siteSettings: {
      siteName: 'Sunset Apartments',
      tagline: 'Welcome home',
      homepagePageKey: 'page:home',
      logoAssetId: '22222222-2222-4222-8222-222222222222',
      faviconAssetId: null,
    },
    legal: { fairHousingDisclaimer: 'Equal Housing Opportunity' },
    analytics: { consentMode: 'required' },
  }
}

async function fixture(name: string): Promise<unknown> {
  const file = path.resolve(
    process.cwd(),
    '../../../wordpress-plugin/oneclick-siteforge-runtime/fixtures/v2',
    name
  )
  return JSON.parse(await readFile(file, 'utf8')) as unknown
}
