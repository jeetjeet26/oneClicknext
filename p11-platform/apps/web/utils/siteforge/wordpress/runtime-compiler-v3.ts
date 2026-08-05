import {
  SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
  freezeRuntimeV3Value,
  immutableSiteForgeRuntimeV3ReleaseSchema,
  runtimeV3AssetPreparationRequestSchema,
  runtimeV3AssetPreparationResultSchema,
  runtimeV3DeploymentSubmissionSchema,
  deriveRuntimeV3IdempotencyKey,
  type ImmutableSiteForgeRuntimeV3Release,
  type RuntimeV3AssetPreparationRequest,
  type RuntimeV3AssetPreparationResult,
  type RuntimeV3DeploymentSubmission,
} from '@/utils/siteforge/runtime-contract-v3'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

export interface CompiledSiteForgeRuntimeV3Release {
  readonly release: Readonly<ImmutableSiteForgeRuntimeV3Release>
  readonly assetPreparation: Readonly<RuntimeV3AssetPreparationRequest>
  readonly deploymentIdempotencyKey: string
}

export function compileSiteForgeRuntimeV3Release(input: {
  release: ImmutableSiteForgeRuntimeV3Release
  expectedRemoteContentHash: string | null
}): Readonly<CompiledSiteForgeRuntimeV3Release> {
  const release = immutableSiteForgeRuntimeV3ReleaseSchema.parse(input.release)
  const sourceByAssetId = new Map(
    release.assetSources.map(source => [source.assetId, source])
  )
  const assets = [...release.resourceGraph.assets]
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
    .map(asset => ({
      asset,
      source: sourceByAssetId.get(asset.assetId)!,
    }))
  const assetPreparation = runtimeV3AssetPreparationRequestSchema.parse({
    contractVersion: SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
    identity: release.identity,
    idempotencyKey: deriveRuntimeV3IdempotencyKey('asset_preparation', {
      identity: release.identity,
      expectedRemoteContentHash: null,
    }),
    assets,
  })
  const deploymentIdempotencyKey = deriveRuntimeV3IdempotencyKey('deployment', {
    identity: release.identity,
    expectedRemoteContentHash: input.expectedRemoteContentHash,
  })

  return freezeRuntimeV3Value({
    release,
    assetPreparation,
    deploymentIdempotencyKey,
  })
}

export function createSiteForgeRuntimeV3DeploymentSubmission(input: {
  compiled: CompiledSiteForgeRuntimeV3Release
  assetPreparation: RuntimeV3AssetPreparationResult
  expectedRemoteContentHash: string | null
}): Readonly<RuntimeV3DeploymentSubmission> {
  const prepared = runtimeV3AssetPreparationResultSchema.parse(
    input.assetPreparation
  )
  const compiled = input.compiled

  if (
    hashSiteForgeContent(prepared.identity) !==
    hashSiteForgeContent(compiled.release.identity)
  ) {
    throw new Error(
      'Prepared assets do not belong to the exact compiled SiteForge v3 release'
    )
  }
  if (prepared.idempotencyKey !== compiled.assetPreparation.idempotencyKey) {
    throw new Error(
      'Prepared assets do not match the exact compiled SiteForge v3 preparation'
    )
  }

  const expectedAssets = new Map(
    compiled.release.resourceGraph.assets.map(asset => [
      asset.assetId,
      asset.byteSha256,
    ])
  )
  if (
    prepared.assets.length !== expectedAssets.size ||
    prepared.assets.some(
      asset => expectedAssets.get(asset.assetId) !== asset.byteSha256
    )
  ) {
    throw new Error(
      'Prepared asset readback does not match the complete SiteForge v3 asset manifest'
    )
  }

  const expectedIdempotencyKey = deriveRuntimeV3IdempotencyKey('deployment', {
    identity: compiled.release.identity,
    expectedRemoteContentHash: input.expectedRemoteContentHash,
  })
  if (expectedIdempotencyKey !== compiled.deploymentIdempotencyKey) {
    throw new Error(
      'Expected remote content hash does not match the compiled SiteForge v3 deployment'
    )
  }

  return freezeRuntimeV3Value(
    runtimeV3DeploymentSubmissionSchema.parse({
      contractVersion: SITEFORGE_RUNTIME_V3_CONTRACT_VERSION,
      release: compiled.release,
      assetPreparationId: prepared.preparationId,
      expectedRemoteContentHash: input.expectedRemoteContentHash,
      idempotencyKey: compiled.deploymentIdempotencyKey,
    })
  )
}
