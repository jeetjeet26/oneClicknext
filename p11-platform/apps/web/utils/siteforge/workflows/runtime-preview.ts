import type { Json } from '@/types/supabase'
import type { VerifiedSiteForgeRelease } from '@/utils/siteforge/artifacts/release'
import {
  deriveAssetManifestHash,
  type DeploymentStatus,
} from '@/utils/siteforge/runtime-contract'
import {
  SiteForgeRuntimeClient,
  SiteForgeRuntimeClientError,
} from '@/utils/siteforge/wordpress/runtime-client'
import {
  compileSiteForgeRuntimeRelease,
  createSiteForgeDeploymentSubmission,
} from '@/utils/siteforge/wordpress/runtime-compiler'
import {
  propertyContextFromOnboardingSnapshot,
  runtimePropertyProfile,
} from '@/utils/siteforge/property-context'
import type { SiteForgePublicRuntimeConfig } from '@/utils/siteforge/public-runtime'

function record(value: Json | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export async function deployVerifiedReleaseThroughRuntime(input: {
  release: VerifiedSiteForgeRelease
  siteUrl: string
  username: string
  applicationPassword: string
  lastVerifiedContentHash: string | null
  target?: {
    mode: 'canonical_preview' | 'staging' | 'production'
    siteUrl: string
  }
  publicRuntime?: SiteForgePublicRuntimeConfig
  protection?: {
    mode: 'noindex' | 'password_noindex' | 'public'
  }
  onProgress?: (stage: string, detail: string) => Promise<void> | void
  runtimeClient?: Pick<
    SiteForgeRuntimeClient,
    | 'getHealth'
    | 'getCapabilities'
    | 'getState'
    | 'prepareAssets'
    | 'submitDeployment'
    | 'getDeploymentStatus'
  >
}): Promise<{
  deployment: DeploymentStatus
  runtimeVersion: string
  operationHash: string
  assetBindingHash: string
  deploymentIdempotencyKey: string
}> {
  const runtime =
    input.runtimeClient ||
    new SiteForgeRuntimeClient({
      baseUrl: input.siteUrl,
      username: input.username,
      applicationPassword: input.applicationPassword,
    })
  await input.onProgress?.('runtime_health', 'Verifying WordPress runtime health')
  const [health, capabilities, state] = await Promise.all([
    runtime.getHealth(),
    runtime.getCapabilities(),
    runtime.getState(input.release.artifact.websiteId),
  ])
  if (health.status !== 'ok') {
    throw new Error(`SiteForge WordPress runtime is ${health.status}`)
  }
  if (
    input.lastVerifiedContentHash !== null &&
    state.artifactContentHash !== input.lastVerifiedContentHash
  ) {
    throw new Error(
      'WordPress runtime content changed after the last verified SiteForge deployment'
    )
  }
  if (
    capabilities.limits.maxAssetsPerPreparation <
    input.release.runtimeAssets.length
  ) {
    throw new Error('SiteForge release exceeds the WordPress runtime asset limit')
  }
  const unsupportedAsset = input.release.runtimeAssets.find(
    asset =>
      asset.bytes > capabilities.limits.maxAssetBytes ||
      !capabilities.limits.acceptedAssetMimeTypes.includes(asset.mimeType)
  )
  if (unsupportedAsset) {
    throw new Error(
      `SiteForge asset ${unsupportedAsset.assetId} exceeds WordPress runtime capabilities`
    )
  }

  const blueprint = record(input.release.artifact.blueprint)
  const propertySnapshot = record(blueprint.propertySnapshot as Json | undefined)
  const snapshotProperty = record(propertySnapshot.property as Json | undefined)
  const snapshotName = text(snapshotProperty.name, text(propertySnapshot.name))
  const propertyContext =
    Object.keys(propertySnapshot).length > 0 && snapshotName
      ? propertyContextFromOnboardingSnapshot({
          ...propertySnapshot,
          property: {
            ...snapshotProperty,
            id: text(
              snapshotProperty.id,
              text(propertySnapshot.id, input.release.artifact.propertyId)
            ),
            name: snapshotName,
          },
        })
      : null
  const pages = Array.isArray(blueprint.pages)
    ? (blueprint.pages as Array<Record<string, unknown>>)
    : []
  if (pages.length > capabilities.limits.maxPagesPerDeployment) {
    throw new Error('SiteForge release exceeds the WordPress runtime page limit')
  }
  const homepageSlug =
    pages.find(page => page.slug === 'home')?.slug || pages[0]?.slug
  if (typeof homepageSlug !== 'string') {
    throw new Error('SiteForge runtime release has no homepage')
  }
  const desiredPageKeys = new Set(
    pages
      .map(page => (typeof page.slug === 'string' ? `page:${page.slug}` : null))
      .filter((value): value is string => Boolean(value))
  )
  const removedPageKeys = Object.keys(state.pageIds)
    .filter(pageKey => !desiredPageKeys.has(pageKey))
    .sort()
  const assetBindingHash = deriveAssetManifestHash(
    input.release.runtimeAssets
  )
  const compiled = compileSiteForgeRuntimeRelease({
    release: {
      schemaVersion: 1,
      siteId: input.release.artifact.websiteId,
      artifactId: input.release.artifact.id,
      artifactContentHash: input.release.artifact.contentHash,
      assetManifestHash: assetBindingHash,
      siteName: propertyContext?.name || text(propertySnapshot.name, 'SiteForge website'),
      tagline: text(
        record(propertySnapshot.property as Json | undefined).tagline ??
          propertySnapshot.tagline
      ),
      propertyProfile: propertyContext
        ? runtimePropertyProfile(propertyContext)
        : undefined,
      blueprint: input.release.artifact.blueprint,
      assets: input.release.runtimeAssets,
      selectedAssets: input.release.runtimeSelectedAssets,
      homepageSlug,
      removals: {
        pageKeys: removedPageKeys,
        pageSlugs: removedPageKeys.map(pageKey =>
          pageKey.replace(/^page:/, '')
        ),
      },
      legal: record(blueprint.legal as Json | undefined),
      analytics: record(blueprint.analytics as Json | undefined),
      target: input.target,
      publicRuntime: input.publicRuntime,
      protection: input.protection,
    },
    expectedRemoteContentHash: state.artifactContentHash,
  })

  await input.onProgress?.(
    'preparing_assets',
    'Preparing exact immutable media bindings'
  )
  const prepared = await runtime.prepareAssets(compiled.assetPreparation)
  const submission = createSiteForgeDeploymentSubmission({
    compiled,
    assetPreparation: prepared,
    expectedRemoteContentHash: state.artifactContentHash,
  })

  await input.onProgress?.(
    'applying_wordpress_transaction',
    'Applying one idempotent WordPress transaction'
  )
  let deployment = await runtime.submitDeployment(submission)
  for (let attempt = 0; deployment.status === 'running' && attempt < 60; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000))
    deployment = await runtime.getDeploymentStatus(deployment.transactionId)
  }
  if (deployment.status !== 'succeeded') {
    throw new SiteForgeRuntimeClientError({
      failure:
        deployment.failure || {
          code: 'operation_failed',
          message: 'SiteForge WordPress transaction failed',
          retryable: false,
          stage: 'preflight',
          operationHash: submission.operationHash,
          expectedRemoteContentHash:
            submission.expectedRemoteContentHash,
        },
    })
  }
  const readback = await runtime.getState(input.release.artifact.websiteId)
  if (
    readback.artifactId !== input.release.artifact.id ||
    readback.artifactContentHash !== input.release.artifact.contentHash ||
    readback.assetManifestHash !== assetBindingHash ||
    readback.operationHash !== compiled.operationHash ||
    readback.transactionId !== deployment.transactionId
  ) {
    throw new Error('WordPress runtime exact readback does not match the artifact')
  }
  return {
    deployment,
    runtimeVersion: health.runtimeVersion,
    operationHash: compiled.operationHash,
    assetBindingHash,
    deploymentIdempotencyKey: compiled.deploymentIdempotencyKey,
  }
}
