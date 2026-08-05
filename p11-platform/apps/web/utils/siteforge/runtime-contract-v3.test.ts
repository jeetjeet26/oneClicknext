import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { compiledMutationPlanSchema } from './runtime-contract'
import {
  deriveRuntimeV3AssetManifestHash,
  deriveRuntimeV3IdempotencyKey,
  deriveRuntimeV3OperationSetHash,
  deriveRuntimeV3PackageManifestHash,
  deriveRuntimeV3ResourceGraphHash,
  immutableSiteForgeRuntimeV3ReleaseSchema,
  runtimeV3AssetPreparationRequestSchema,
  runtimeV3CapabilitiesSchema,
  runtimeV3PackageIdentitySchema,
  runtimeV3StateSchema,
  runtimeV3V2ProjectionResponseSchema,
  type ImmutableSiteForgeRuntimeV3Release,
} from './runtime-contract-v3'

describe('SiteForge runtime v3 contract', () => {
  it('parses the shared complete-resource fixture with exact identities', async () => {
    const release = await releaseFixture()
    const parsed = immutableSiteForgeRuntimeV3ReleaseSchema.parse(release)
    const capabilities = runtimeV3CapabilitiesSchema.parse(
      await fixture('capabilities.json')
    )

    expect(parsed.contractVersion).toBe(3)
    expect(parsed.resourceGraph).toMatchObject({
      pages: [{ resourceId: 'page:home' }],
      sections: [{ resourceId: 'section:hero' }],
      globalComponents: [
        { resourceId: 'component:header' },
        { resourceId: 'component:footer' },
      ],
      chrome: { resourceId: 'chrome:primary' },
      forms: [{ resourceId: 'form:tour' }],
      redirects: [{ resourceId: 'redirect:legacy-home' }],
      responsiveRules: [{ resourceId: 'responsive:hero-mobile' }],
      accessibilityAnnotations: [{ resourceId: 'a11y:hero' }],
      seo: [{ resourceId: 'seo:home' }],
      legal: [{ resourceId: 'legal:communications' }],
      analytics: { resourceId: 'analytics:site' },
      integrations: [
        { resourceId: 'integration:luma' },
        { resourceId: 'integration:analytics' },
      ],
      assets: [{ resourceId: 'asset:hero' }],
      removals: [{ resourceId: 'page:legacy' }],
    })
    expect(parsed.identity).toMatchObject({
      baseTheme: { packageType: 'base_theme' },
      runtimePackage: { packageType: 'runtime_plugin' },
      overlays: [{ overlayId: 'overlay:aurora' }],
      extensions: [{ extensionId: 'extension:tour-widget' }],
    })
    expect(capabilities.features.completeResourceGraph).toBe(true)
    expect(
      runtimeV3StateSchema.parse(await fixture('empty-state.json'))
    ).toMatchObject({
      contractVersion: 3,
      siteId: 'site-1',
      identity: null,
    })
    expect(
      runtimeV3V2ProjectionResponseSchema.parse(
        await fixture('projection-v2.json')
      )
    ).toMatchObject({
      contractVersion: 3,
      projection: { contractVersion: 2, siteId: 'site-1' },
    })
  })

  it('derives every aggregate and package identity deterministically', async () => {
    const release = await releaseFixture()
    expect(deriveRuntimeV3ResourceGraphHash(release.resourceGraph)).toBe(
      release.identity.resourceGraphHash
    )
    expect(deriveRuntimeV3AssetManifestHash(release.resourceGraph.assets)).toBe(
      release.identity.assetManifestHash
    )
    expect(deriveRuntimeV3OperationSetHash(release.operations)).toBe(
      release.identity.operationSetHash
    )
    for (const packageIdentity of [
      release.identity.baseTheme,
      release.identity.runtimePackage,
      ...release.identity.overlays.map(item => item.package),
      ...release.identity.extensions.map(item => item.package),
    ]) {
      expect(
        deriveRuntimeV3PackageManifestHash(packageIdentity.manifest)
      ).toBe(packageIdentity.manifestSha256)
      expect(runtimeV3PackageIdentitySchema.parse(packageIdentity)).toEqual(
        packageIdentity
      )
    }
  })

  it('rejects unknown fields and never interprets v3 through v2 schemas', async () => {
    const release = await releaseFixture()
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse({
        ...release,
        futureContractField: true,
      }).success
    ).toBe(false)
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse({
        ...release,
        resourceGraph: {
          ...release.resourceGraph,
          pages: [
            {
              ...release.resourceGraph.pages[0],
              futurePageField: true,
            },
          ],
        },
      }).success
    ).toBe(false)
    expect(compiledMutationPlanSchema.safeParse(release.resourceGraph).success).toBe(
      false
    )
  })

  it('fails closed on identity, package, and graph-reference drift', async () => {
    const release = await releaseFixture()
    const wrongGraphHash = structuredClone(release)
    wrongGraphHash.identity.resourceGraphHash = 'f'.repeat(64)
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(wrongGraphHash).success
    ).toBe(false)

    const wrongManifest = structuredClone(release)
    wrongManifest.identity.runtimePackage.manifest.files[0].bytes += 1
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(wrongManifest).success
    ).toBe(false)

    const missingSection = structuredClone(release)
    missingSection.resourceGraph.pages[0].sectionIds = ['section:missing']
    missingSection.identity.resourceGraphHash = hashSiteForgeContent(
      missingSection.resourceGraph
    )
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(missingSection).success
    ).toBe(false)

    const extraAssetSource = structuredClone(release)
    extraAssetSource.assetSources.push({
      ...extraAssetSource.assetSources[0],
      assetId: '99999999-9999-4999-8999-999999999999',
    })
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(extraAssetSource).success
    ).toBe(false)
  })

  it('binds overlays to the exact base theme archive', async () => {
    const release = await releaseFixture()
    release.identity.overlays[0].appliesToBaseThemeArchiveSha256 = 'f'.repeat(64)
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(release).success
    ).toBe(false)
  })

  it('binds asset preparation to the complete exact release manifest', async () => {
    const release = await releaseFixture()
    const request = {
      contractVersion: 3 as const,
      identity: release.identity,
      idempotencyKey: deriveRuntimeV3IdempotencyKey('asset_preparation', {
        identity: release.identity,
        expectedRemoteContentHash: null,
      }),
      assets: release.resourceGraph.assets.map(asset => ({
        asset,
        source: release.assetSources.find(source => source.assetId === asset.assetId)!,
      })),
    }

    expect(runtimeV3AssetPreparationRequestSchema.parse(request)).toEqual(request)
    expect(
      runtimeV3AssetPreparationRequestSchema.safeParse({
        ...request,
        assets: [],
      }).success
    ).toBe(false)
  })

  it('rejects malformed URLs, duplicate packages, and forward dependencies', async () => {
    const malformedRedirect = await releaseFixture()
    malformedRedirect.resourceGraph.redirects[0].destination = 'https://'
    malformedRedirect.identity.resourceGraphHash = hashSiteForgeContent(
      malformedRedirect.resourceGraph
    )
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(malformedRedirect).success
    ).toBe(false)

    const duplicatePackage = await releaseFixture()
    duplicatePackage.identity.extensions[0].package.packageId =
      duplicatePackage.identity.runtimePackage.packageId
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(duplicatePackage).success
    ).toBe(false)

    const forwardDependency = await releaseFixture()
    const existing = forwardDependency.operations[0]
    forwardDependency.operations = [
      { ...existing, dependsOn: ['operation:second'] },
      {
        ...existing,
        operationId: 'operation:second',
        sequence: 1,
      },
    ]
    forwardDependency.identity.operationSetHash =
      deriveRuntimeV3OperationSetHash(forwardDependency.operations)
    expect(
      immutableSiteForgeRuntimeV3ReleaseSchema.safeParse(forwardDependency).success
    ).toBe(false)
  })
})

export async function releaseFixture(): Promise<ImmutableSiteForgeRuntimeV3Release> {
  return (await fixture('release.json')) as ImmutableSiteForgeRuntimeV3Release
}

async function fixture(name: string): Promise<unknown> {
  const file = path.resolve(
    process.cwd(),
    '../../../wordpress-plugin/oneclick-siteforge-runtime/fixtures/v3',
    name
  )
  return JSON.parse(await readFile(file, 'utf8')) as unknown
}
