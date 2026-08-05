import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deriveRuntimeV3IdempotencyKey,
  type ImmutableSiteForgeRuntimeV3Release,
  type RuntimeV3AssetPreparationResult,
} from '@/utils/siteforge/runtime-contract-v3'
import {
  compileSiteForgeRuntimeV3Release,
  createSiteForgeRuntimeV3DeploymentSubmission,
} from './runtime-compiler-v3'

describe('SiteForge WordPress runtime v3 compiler', () => {
  it('compiles and freezes the exact complete release without v2 projection', async () => {
    const release = await releaseFixture()
    const before = JSON.stringify(release)
    const compiled = compileSiteForgeRuntimeV3Release({
      release,
      expectedRemoteContentHash: 'f'.repeat(64),
    })

    expect(JSON.stringify(release)).toBe(before)
    expect(compiled.release.contractVersion).toBe(3)
    expect(compiled.release.resourceGraph.globalComponents).toHaveLength(2)
    expect(compiled.release.identity).toMatchObject({
      resourceGraphHash: release.identity.resourceGraphHash,
      baseTheme: { archiveSha256: release.identity.baseTheme.archiveSha256 },
      runtimePackage: {
        archiveSha256: release.identity.runtimePackage.archiveSha256,
        manifestSha256: release.identity.runtimePackage.manifestSha256,
      },
    })
    expect(compiled.assetPreparation.contractVersion).toBe(3)
    expect(compiled.assetPreparation.assets[0]).toMatchObject({
      asset: {
        assetId: release.resourceGraph.assets[0].assetId,
        byteSha256: release.resourceGraph.assets[0].byteSha256,
      },
      source: {
        sourceUrl: release.assetSources[0].sourceUrl,
      },
    })
    expect(Object.isFrozen(compiled.release.resourceGraph)).toBe(true)
  })

  it('creates a submission bound to prepared assets and remote state', async () => {
    const expectedRemoteContentHash = 'f'.repeat(64)
    const compiled = compileSiteForgeRuntimeV3Release({
      release: await releaseFixture(),
      expectedRemoteContentHash,
    })
    const submission = createSiteForgeRuntimeV3DeploymentSubmission({
      compiled,
      assetPreparation: preparedAssets(compiled),
      expectedRemoteContentHash,
    })

    expect(submission).toMatchObject({
      contractVersion: 3,
      release: {
        contractVersion: 3,
        identity: compiled.release.identity,
      },
      expectedRemoteContentHash,
      assetPreparationId: 'preparation:fixture',
      idempotencyKey: deriveRuntimeV3IdempotencyKey('deployment', {
        identity: compiled.release.identity,
        expectedRemoteContentHash,
      }),
    })
    expect(Object.isFrozen(submission)).toBe(true)
  })

  it('rejects incomplete or cross-release asset preparation readback', async () => {
    const compiled = compileSiteForgeRuntimeV3Release({
      release: await releaseFixture(),
      expectedRemoteContentHash: null,
    })
    const incomplete = preparedAssets(compiled)
    incomplete.assets = []
    expect(() =>
      createSiteForgeRuntimeV3DeploymentSubmission({
        compiled,
        assetPreparation: incomplete,
        expectedRemoteContentHash: null,
      })
    ).toThrow('complete SiteForge v3 asset manifest')

    const wrongPackage = preparedAssets(compiled)
    wrongPackage.identity = {
      ...wrongPackage.identity,
      runtimePackage: {
        ...wrongPackage.identity.runtimePackage,
        archiveSha256: '9'.repeat(64),
      },
    }
    expect(() =>
      createSiteForgeRuntimeV3DeploymentSubmission({
        compiled,
        assetPreparation: wrongPackage,
        expectedRemoteContentHash: null,
      })
    ).toThrow('exact compiled SiteForge v3 release')

    const wrongPreparation = preparedAssets(compiled)
    wrongPreparation.idempotencyKey = '9'.repeat(64)
    expect(() =>
      createSiteForgeRuntimeV3DeploymentSubmission({
        compiled,
        assetPreparation: wrongPreparation,
        expectedRemoteContentHash: null,
      })
    ).toThrow('exact compiled SiteForge v3 preparation')
  })

  it('changes only deployment idempotency when expected remote state changes', async () => {
    const release = await releaseFixture()
    const current = compileSiteForgeRuntimeV3Release({
      release,
      expectedRemoteContentHash: '1'.repeat(64),
    })
    const stale = compileSiteForgeRuntimeV3Release({
      release: structuredClone(release),
      expectedRemoteContentHash: '2'.repeat(64),
    })

    expect(stale.release).toEqual(current.release)
    expect(stale.assetPreparation).toEqual(current.assetPreparation)
    expect(stale.deploymentIdempotencyKey).not.toBe(
      current.deploymentIdempotencyKey
    )
  })
})

function preparedAssets(
  compiled: ReturnType<typeof compileSiteForgeRuntimeV3Release>
): RuntimeV3AssetPreparationResult {
  return {
    contractVersion: 3,
    preparationId: 'preparation:fixture',
    identity: structuredClone(compiled.release.identity),
    idempotencyKey: compiled.assetPreparation.idempotencyKey,
    preparedAt: '2026-08-04T20:01:00.000Z',
    assets: compiled.release.resourceGraph.assets.map((asset, index) => ({
      assetId: asset.assetId,
      byteSha256: asset.byteSha256,
      attachmentId: index + 100,
      url: `https://wordpress.example.com/uploads/${asset.filename}`,
      mimeType: asset.mimeType,
      disposition: 'created',
    })),
  }
}

async function releaseFixture(): Promise<ImmutableSiteForgeRuntimeV3Release> {
  const file = path.resolve(
    process.cwd(),
    '../../../wordpress-plugin/oneclick-siteforge-runtime/fixtures/v3/release.json'
  )
  return JSON.parse(await readFile(file, 'utf8')) as ImmutableSiteForgeRuntimeV3Release
}
