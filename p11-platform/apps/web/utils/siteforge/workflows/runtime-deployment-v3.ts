import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import {
  isSiteForgeRuntimeV3Enabled,
  type VerifiedSiteForgeRelease,
} from '@/utils/siteforge/artifacts/release'
import {
  deriveRuntimeV3AssetManifestHash,
  deriveRuntimeV3OperationSetHash,
  deriveRuntimeV3PackageManifestHash,
  deriveRuntimeV3ResourceGraphHash,
  immutableSiteForgeRuntimeV3ReleaseSchema,
  type ImmutableSiteForgeRuntimeV3Release,
  type RuntimeV3DeploymentStatus,
  type RuntimeV3State,
} from '@/utils/siteforge/runtime-contract-v3'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { compileSiteForgeRuntimeV3Descriptor } from '@/utils/siteforge/runtime-release-compiler'
import type { SiteForgePublicRuntimeConfig } from '@/utils/siteforge/public-runtime'
import {
  compileSiteForgeRuntimeV3Release,
  createSiteForgeRuntimeV3DeploymentSubmission,
} from '@/utils/siteforge/wordpress/runtime-compiler-v3'
import {
  SiteForgeRuntimeV3Client,
  SiteForgeRuntimeV3ClientError,
} from '@/utils/siteforge/wordpress/runtime-client-v3'
import {
  SshWordPressInstaller,
  type WordPressSshCredentials,
} from '@/utils/siteforge/wordpress/wordpress-installer'

export type SiteForgeRuntimeV3Environment =
  | 'canonical_preview'
  | 'staging'
  | 'production'

type RuntimeV3Target = Pick<
  Tables<'siteforge_wordpress_targets'>,
  | 'id'
  | 'org_id'
  | 'property_id'
  | 'website_id'
  | 'target_type'
  | 'site_url'
  | 'protection_mode'
  | 'runtime_contract_version'
  | 'runtime_package_sha256'
  | 'runtime_manifest_sha256'
  | 'last_verified_content_hash'
  | 'metadata'
>

type RuntimeV3Rollout = Pick<
  Tables<'siteforge_runtime_target_rollouts'>,
  | 'target_id'
  | 'org_id'
  | 'property_id'
  | 'website_id'
  | 'requested_contract_version'
  | 'runtime_package_sha256'
  | 'status'
  | 'rolled_back_at'
>

type RuntimeV3Client = Pick<
  SiteForgeRuntimeV3Client,
  | 'getHealth'
  | 'getCapabilities'
  | 'getState'
  | 'verifyInstalledPackageIdentity'
  | 'prepareAssets'
  | 'submitDeployment'
  | 'getDeploymentStatus'
>

type RuntimeV3Installer = Pick<
  SshWordPressInstaller,
  | 'ensureInstalled'
  | 'getActiveTheme'
  | 'installThemeOverlay'
  | 'restoreActiveTheme'
>

export interface SiteForgeRuntimeV3DeploymentResult {
  deployment: RuntimeV3DeploymentStatus
  state: RuntimeV3State
  runtimeVersion: string
  runtimeManifestSha256: string
  operationSetHash: string
  assetManifestHash: string
  deploymentIdempotencyKey: string
  deploymentId: string
  evidence: Json
}

export interface DeployArtifactBoundRuntimeV3Input {
  release: VerifiedSiteForgeRelease
  target: RuntimeV3Target
  deploymentId?: string
  sharedJobId?: string | null
  approvalId?: string | null
  environment: SiteForgeRuntimeV3Environment
  siteUrl: string
  adminUrl: string
  username: string
  applicationPassword: string
  ssh: WordPressSshCredentials
  acfProLicenseKey: string
  reuseInstalledAcfPro?: boolean
  publicRuntime: SiteForgePublicRuntimeConfig
  protection: {
    mode: 'noindex' | 'password_noindex' | 'public'
    passwordReference?: string | null
  }
  expectedRemoteContentHash?: string | null
  client: SupabaseClient<Database>
  assertActive?: () => Promise<void>
  onProgress?: (stage: string, detail: string) => Promise<void> | void
  runtimeClient?: RuntimeV3Client
  installer?: RuntimeV3Installer
  sleep?: (milliseconds: number) => Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function runtimeDescriptor(release: VerifiedSiteForgeRelease): Record<string, unknown> {
  const blueprint = record(release.artifact.blueprint)
  const descriptor =
    blueprint.runtimeV3Release ?? blueprint.runtimeV3 ?? blueprint.runtime_v3
  const parsed = record(descriptor)
  if (Object.keys(parsed).length) return parsed
  if (!release.assetManifest) {
    throw new Error(
      'SiteForge runtime v3 artifact is missing its immutable asset manifest'
    )
  }
  return compileSiteForgeRuntimeV3Descriptor({
    blueprint: release.artifact.blueprint,
    assetManifest: release.assetManifest,
  }) as unknown as Record<string, unknown>
}

function packageIdentity(input: {
  packageId: string
  packageType: 'base_theme' | 'theme_overlay'
  archiveSha256: string
  archiveBytes: number
  packageName: string
  filename: string
}) {
  const manifest = {
    schemaVersion: 1 as const,
    contractVersion: 3 as const,
    packageName: input.packageName,
    packageVersion: '1.0.0',
    files: [
      {
        path: input.filename,
        byteSha256: input.archiveSha256,
        bytes: input.archiveBytes,
        mode: 'file' as const,
      },
    ],
  }
  return {
    packageId: input.packageId,
    packageType: input.packageType,
    archiveSha256: input.archiveSha256,
    archiveBytes: input.archiveBytes,
    manifestSha256: deriveRuntimeV3PackageManifestHash(manifest),
    manifest,
  }
}

function verifiedPackageIdentities(
  release: VerifiedSiteForgeRelease,
  declaredIdentity: Record<string, unknown>
) {
  const runtime = release.runtimePackageIdentity
  if (!runtime) {
    throw new Error('Verified runtime v3 package identity is unavailable')
  }
  const declaredRuntimePackage = record(declaredIdentity.runtimePackage)
  const runtimePackage = Object.keys(declaredRuntimePackage).length
    ? declaredRuntimePackage
    : (() => {
        const manifest = {
          schemaVersion: 1 as const,
          contractVersion: 3 as const,
          packageName: runtime.manifest.packageName,
          packageVersion: runtime.packageVersion,
          files: runtime.manifest.files.map(file => ({
            path: file.path,
            byteSha256: file.sha256,
            bytes: file.bytes,
            mode: 'file' as const,
          })),
        }
        return {
          packageId: runtime.packageId,
          packageType: 'runtime_plugin' as const,
          archiveSha256: runtime.archiveSha256,
          archiveBytes: runtime.archiveBytes,
          manifestSha256: deriveRuntimeV3PackageManifestHash(manifest),
          manifest,
        }
      })()
  const declaredBaseTheme = record(declaredIdentity.baseTheme)
  const baseTheme = Object.keys(declaredBaseTheme).length
    ? declaredBaseTheme
    : packageIdentity({
        packageId: `base-theme:${release.artifact.baseThemePackageSha256.slice(0, 24)}`,
        packageType: 'base_theme',
        archiveSha256: release.artifact.baseThemePackageSha256,
        archiveBytes: release.baseThemePackage.byteLength,
        packageName: 'oneclick-siteforge-theme',
        filename: 'oneclick-siteforge.zip',
      })
  const normalizedOverlays =
    release.artifact.overlayPackageSha256 &&
    release.artifact.themeOverlayId &&
    release.overlayPackage &&
    release.overlayContentHash
      ? [
          {
            overlayId: release.artifact.themeOverlayId,
            contentHash: release.overlayContentHash,
            themeSlug: runtimeV3OverlayThemeSlug(release.overlayContentHash),
            appliesToBaseThemeArchiveSha256:
              release.artifact.baseThemePackageSha256,
            package: packageIdentity({
              packageId: `overlay-package:${release.artifact.themeOverlayId}`,
              packageType: 'theme_overlay',
              archiveSha256: release.artifact.overlayPackageSha256,
              archiveBytes: release.overlayPackage.byteLength,
              packageName: 'siteforge-theme-overlay',
              filename: 'siteforge-theme-overlay.zip',
            }),
          },
        ]
      : []
  const declaredOverlays = Array.isArray(declaredIdentity.overlays)
    ? declaredIdentity.overlays
    : []
  const overlays = declaredOverlays.length
    ? declaredOverlays
    : normalizedOverlays
  return { runtimePackage, baseTheme, overlays }
}

function runtimeId(prefix: string, value: string): string {
  return `${prefix}:${value.replace(/[^A-Za-z0-9._:-]+/g, '-')}`.slice(0, 240)
}

export function runtimeV3OverlayThemeSlug(contentHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error('Runtime v3 overlay content hash is invalid')
  }
  return `oneclick-siteforge-overlay-${contentHash.slice(0, 12)}`
}

function assertExactPackageIdentities(
  release: VerifiedSiteForgeRelease,
  candidate: ImmutableSiteForgeRuntimeV3Release
): void {
  const runtimeIdentity = release.runtimePackageIdentity
  if (
    !release.runtimePackage ||
    !runtimeIdentity ||
    candidate.identity.runtimePackage.packageId !== runtimeIdentity.packageId ||
    release.artifact.runtimePackageSha256 !== runtimeIdentity.archiveSha256 ||
    candidate.identity.runtimePackage.packageId !== runtimeIdentity.packageId ||
    candidate.identity.runtimePackage.archiveSha256 !==
      runtimeIdentity.archiveSha256 ||
    candidate.identity.runtimePackage.archiveBytes !==
      release.runtimePackage.byteLength ||
    candidate.identity.runtimePackage.manifest.packageVersion !==
      runtimeIdentity.packageVersion
  ) {
    throw new Error(
      'SiteForge runtime v3 artifact does not match the published signed runtime package identity'
    )
  }
  const candidateFiles = new Map(
    candidate.identity.runtimePackage.manifest.files.map(file => [
      file.path,
      file,
    ])
  )
  if (
    runtimeIdentity.manifest.files.length > 0 &&
    (candidateFiles.size !== runtimeIdentity.manifest.files.length ||
      runtimeIdentity.manifest.files.some(file => {
        const candidateFile = candidateFiles.get(file.path)
        return (
          !candidateFile ||
          candidateFile.bytes !== file.bytes ||
          candidateFile.byteSha256 !== file.sha256
        )
      }))
  ) {
    throw new Error(
      'SiteForge runtime v3 descriptor does not match the signed package file manifest'
    )
  }
  if (
    candidate.identity.baseTheme.archiveSha256 !==
      release.artifact.baseThemePackageSha256 ||
    candidate.identity.baseTheme.archiveBytes !==
      release.baseThemePackage.byteLength
  ) {
    throw new Error(
      'SiteForge runtime v3 artifact does not match the immutable base-theme identity'
    )
  }
  const overlays = candidate.identity.overlays
  if (release.artifact.overlayPackageSha256) {
    if (
      !release.overlayPackage ||
      overlays.length !== 1 ||
      overlays[0].overlayId !== release.artifact.themeOverlayId ||
      overlays[0].package.archiveSha256 !==
        release.artifact.overlayPackageSha256 ||
      overlays[0].package.archiveBytes !== release.overlayPackage.byteLength ||
      overlays[0].contentHash !== release.overlayContentHash ||
      overlays[0].themeSlug !==
        runtimeV3OverlayThemeSlug(release.overlayContentHash) ||
      overlays[0].appliesToBaseThemeArchiveSha256 !==
        release.artifact.baseThemePackageSha256
    ) {
      throw new Error(
        'SiteForge runtime v3 artifact does not match the immutable overlay identity'
      )
    }
  } else if (overlays.length || release.overlayPackage) {
    throw new Error(
      'SiteForge runtime v3 artifact has an unexpected overlay package identity'
    )
  }
}

export function buildArtifactBoundRuntimeV3Release(input: {
  release: VerifiedSiteForgeRelease
  target: RuntimeV3Target
  environment: SiteForgeRuntimeV3Environment
  siteUrl: string
  publicRuntime: SiteForgePublicRuntimeConfig
  protection: DeployArtifactBoundRuntimeV3Input['protection']
}): Readonly<ImmutableSiteForgeRuntimeV3Release> {
  if (input.release.artifact.runtimeContractVersion !== 3) {
    throw new Error('Artifact-bound runtime v3 deployment requires exact contract 3')
  }
  if (
    input.target.id !== input.target.id.trim() ||
    input.target.website_id !== input.release.artifact.websiteId ||
    input.target.property_id !== input.release.artifact.propertyId ||
    input.target.org_id !== input.release.artifact.orgId ||
    input.target.target_type !== input.environment
  ) {
    throw new Error('SiteForge runtime v3 target tenant or environment identity mismatch')
  }
  const descriptor = runtimeDescriptor(input.release)
  const declaredIdentity = record(descriptor.identity)
  const packages = verifiedPackageIdentities(input.release, declaredIdentity)
  const resourceGraph = descriptor.resourceGraph
  const operations = descriptor.operations
  const runtimeAssets = new Map(
    input.release.runtimeAssets.map(asset => [asset.assetId, asset])
  )
  const graphAssets = Array.isArray(record(resourceGraph).assets)
    ? (record(resourceGraph).assets as Array<Record<string, unknown>>)
    : []
  const assetSources = graphAssets.map(asset => {
    const assetId = typeof asset.assetId === 'string' ? asset.assetId : ''
    const source = runtimeAssets.get(assetId)
    if (
      !source ||
      source.byteHash !== asset.byteSha256 ||
      source.bytes !== asset.bytes ||
      source.mimeType !== asset.mimeType
    ) {
      throw new Error(
        `SiteForge runtime v3 graph asset ${assetId || 'unknown'} does not match immutable artifact bytes`
      )
    }
    return {
      assetId,
      sourceUrl: source.sourceUrl,
      byteSha256: source.byteHash,
    }
  })
  if (runtimeAssets.size !== graphAssets.length) {
    throw new Error(
      'SiteForge runtime v3 graph does not contain the complete immutable asset manifest'
    )
  }
  const resourceGraphHash = deriveRuntimeV3ResourceGraphHash(resourceGraph as never)
  const assetManifestHash = deriveRuntimeV3AssetManifestHash(graphAssets as never)
  const operationSetHash = deriveRuntimeV3OperationSetHash(
    Array.isArray(operations) ? (operations as never) : []
  )
  const candidate = immutableSiteForgeRuntimeV3ReleaseSchema.parse({
    contractVersion: 3,
    identity: {
      ...declaredIdentity,
      siteId: input.release.artifact.websiteId,
      artifactId: input.release.artifact.id,
      artifactContentHash: input.release.artifact.contentHash,
      resourceGraphHash,
      assetManifestHash,
      operationSetHash,
      baseTheme: packages.baseTheme,
      runtimePackage: packages.runtimePackage,
      overlays: packages.overlays,
      extensions: [],
    },
    resourceGraph,
    operations,
    assetSources,
    target: {
      targetId: input.target.id,
      environment: input.environment,
      siteUrl: input.siteUrl,
      protection: {
        mode: input.protection.mode,
        passwordReference:
          input.protection.mode === 'password_noindex'
            ? input.protection.passwordReference || null
            : null,
      },
      publicRuntime: {
        enabled: input.publicRuntime.enabled,
        apiBaseUrl: input.publicRuntime.apiBaseUrl,
        websiteId: input.publicRuntime.websiteId,
        keyReference: input.publicRuntime.enabled
          ? `siteforge-public-key:${input.publicRuntime.websiteId}`
          : null,
        conversionEndpoint: input.publicRuntime.conversionEndpoint,
        conversionKey: input.publicRuntime.conversionKey,
        telemetryEndpoint: input.publicRuntime.telemetryEndpoint,
        allowedOrigins: [input.siteUrl],
      },
    },
  })
  assertExactPackageIdentities(input.release, candidate)
  return candidate
}

export function assertRuntimeV3RolloutAssignment(input: {
  release: VerifiedSiteForgeRelease
  target: RuntimeV3Target
  rollout: RuntimeV3Rollout | null
}): void {
  if (!isSiteForgeRuntimeV3Enabled()) {
    throw new Error(
      'SiteForge runtime v3 deployment is disabled by SITEFORGE_RUNTIME_V3_ENABLED'
    )
  }
  const expectedPackage = input.release.artifact.runtimePackageSha256
  const rollout = input.rollout
  if (
    !expectedPackage ||
    !rollout ||
    rollout.status !== 'enabled' ||
    rollout.rolled_back_at !== null ||
    rollout.target_id !== input.target.id ||
    rollout.org_id !== input.target.org_id ||
    rollout.property_id !== input.target.property_id ||
    rollout.website_id !== input.target.website_id ||
    rollout.requested_contract_version !== 3 ||
    rollout.runtime_package_sha256 !== expectedPackage
  ) {
    throw new Error(
      'SiteForge runtime v3 target has no matching active rollout assignment'
    )
  }
}

function deploymentFailure(error: unknown): {
  code: string
  phase: string
  message: string
} {
  if (error instanceof SiteForgeRuntimeV3ClientError) {
    return {
      code: error.failure.code,
      phase: error.failure.stage || 'runtime_v3',
      message: error.message,
    }
  }
  return {
    code: 'runtime_v3_deployment_failed',
    phase: 'runtime_v3',
    message: error instanceof Error ? error.message : String(error),
  }
}

async function persistFailure(
  input: DeployArtifactBoundRuntimeV3Input,
  deploymentId: string,
  error: unknown
): Promise<void> {
  const failure = deploymentFailure(error)
  const now = new Date().toISOString()
  const [deployment, target] = await Promise.all([
    input.client
      .from('siteforge_artifact_deployments')
      .update({
        status: 'failed',
        failure_phase: failure.phase,
        failure_code: failure.code,
        certification_report: {
          status: 'failed',
          contractVersion: 3,
          environment: input.environment,
          artifactId: input.release.artifact.id,
          artifactContentHash: input.release.artifact.contentHash,
          assetManifestHash: input.release.artifact.assetManifestHash,
          operationSetHash: input.release.artifact.operationSetHash,
          baseThemePackageSha256:
            input.release.artifact.baseThemePackageSha256,
          overlayPackageSha256:
            input.release.artifact.overlayPackageSha256,
          runtimePackageSha256:
            input.release.artifact.runtimePackageSha256,
          runtimeManifestSha256:
            input.release.runtimePackageIdentity?.manifestSha256 || null,
          targetId: input.target.id,
          targetProtection: input.protection,
          expectedRemoteContentHash:
            input.expectedRemoteContentHash === undefined
              ? input.target.last_verified_content_hash
              : input.expectedRemoteContentHash,
          finalContentHash: null,
          transactionId: null,
          message: failure.message,
        } as Json,
      })
      .eq('id', deploymentId)
      .select('id')
      .maybeSingle(),
    input.client
      .from('siteforge_wordpress_targets')
      .update({ status: 'failed', updated_at: now })
      .eq('id', input.target.id)
      .select('id')
      .maybeSingle(),
  ])
  if (deployment.error || !deployment.data || target.error || !target.data) {
    throw new Error(
      `Runtime v3 failed and terminal state could not be persisted: ${
        deployment.error?.message ||
        target.error?.message ||
        'required row was not updated'
      }`,
      { cause: error }
    )
  }
}

async function seedDeployment(
  input: DeployArtifactBoundRuntimeV3Input,
  runtimeManifestSha256: string
): Promise<string> {
  const values = {
    org_id: input.release.artifact.orgId,
    property_id: input.release.artifact.propertyId,
    website_id: input.release.artifact.websiteId,
    target_id: input.target.id,
    artifact_id: input.release.artifact.id,
    artifact_content_hash: input.release.artifact.contentHash,
    asset_manifest_hash: input.release.artifact.assetManifestHash,
    base_theme_package_sha256:
      input.release.artifact.baseThemePackageSha256,
    overlay_package_sha256: input.release.artifact.overlayPackageSha256,
    operation_set_hash: input.release.artifact.operationSetHash,
    runtime_contract_version: 3,
    runtime_package_sha256: input.release.artifact.runtimePackageSha256,
    runtime_manifest_sha256: runtimeManifestSha256,
    expected_remote_content_hash:
      input.expectedRemoteContentHash === undefined
        ? input.target.last_verified_content_hash
        : input.expectedRemoteContentHash,
    ...(input.approvalId !== undefined
      ? { approval_id: input.approvalId }
      : {}),
    ...(input.sharedJobId !== undefined
      ? { shared_job_id: input.sharedJobId }
      : {}),
    status: 'deploying',
    failure_phase: null,
    failure_code: null,
    certification_report: {
      status: 'deploying',
      contractVersion: 3,
      environment: input.environment,
      artifactId: input.release.artifact.id,
      artifactContentHash: input.release.artifact.contentHash,
      assetManifestHash: input.release.artifact.assetManifestHash,
      operationSetHash: input.release.artifact.operationSetHash,
      baseThemePackageSha256:
        input.release.artifact.baseThemePackageSha256,
      overlayPackageSha256: input.release.artifact.overlayPackageSha256,
      runtimePackageSha256: input.release.artifact.runtimePackageSha256,
      runtimeManifestSha256,
      targetId: input.target.id,
      targetProtection: input.protection,
      expectedRemoteContentHash:
        input.expectedRemoteContentHash === undefined
          ? input.target.last_verified_content_hash
          : input.expectedRemoteContentHash,
      finalContentHash: null,
      transactionId: null,
    } as Json,
  }
  if (input.deploymentId) {
    const { data, error } = await input.client
      .from('siteforge_artifact_deployments')
      .update(values)
      .eq('id', input.deploymentId)
      .eq('target_id', input.target.id)
      .eq('artifact_id', input.release.artifact.id)
      .select('id')
      .maybeSingle()
    if (error || !data) {
      throw new Error(
        `Failed to seed runtime v3 deployment identity: ${
          error?.message || 'deployment row was not updated'
        }`
      )
    }
    return data.id
  }
  const { data, error } = await input.client
    .from('siteforge_artifact_deployments')
    .upsert(values, { onConflict: 'target_id,artifact_id' })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(
      `Failed to create runtime v3 deployment identity: ${
        error?.message || 'missing deployment row'
      }`
    )
  }
  return data.id
}

function assertRemoteState(
  actual: RuntimeV3State,
  expected: ImmutableSiteForgeRuntimeV3Release,
  transactionId: string
): void {
  if (
    !actual.identity ||
    hashSiteForgeContent(actual.identity) !==
      hashSiteForgeContent(expected.identity) ||
    !actual.target ||
    hashSiteForgeContent(actual.target) !== hashSiteForgeContent(expected.target) ||
    actual.transactionId !== transactionId ||
    actual.v2Projection?.artifactContentHash !==
      expected.identity.artifactContentHash ||
    actual.v2Projection?.assetManifestHash !==
      expected.identity.assetManifestHash ||
    actual.v2Projection?.operationHash !== expected.identity.operationSetHash
  ) {
    throw new Error(
      'SiteForge runtime v3 exact readback does not match artifact, package, target, or transaction identity'
    )
  }
}

export async function deployArtifactBoundRuntimeV3(
  input: DeployArtifactBoundRuntimeV3Input
): Promise<SiteForgeRuntimeV3DeploymentResult> {
  const runtimePackageIdentity = input.release.runtimePackageIdentity
  if (!runtimePackageIdentity || !input.release.runtimePackage) {
    throw new Error('SiteForge runtime v3 signed package bytes are unavailable')
  }
  const deploymentId = await seedDeployment(
    input,
    runtimePackageIdentity.manifestSha256
  )
  const expectedRemoteContentHash =
    input.expectedRemoteContentHash === undefined
      ? input.target.last_verified_content_hash
      : input.expectedRemoteContentHash
  const runtime =
    input.runtimeClient ||
    new SiteForgeRuntimeV3Client({
      baseUrl: input.siteUrl,
      username: input.username,
      applicationPassword: input.applicationPassword,
    })
  const installer = input.installer || new SshWordPressInstaller()
  let priorTheme: Awaited<ReturnType<RuntimeV3Installer['getActiveTheme']>> | null =
    null
  let themeChanged = false
  const sleep =
    input.sleep ||
    ((milliseconds: number) =>
      new Promise<void>(resolve => setTimeout(resolve, milliseconds)))

  try {
    const { data: rollout, error: rolloutError } = await input.client
      .from('siteforge_runtime_target_rollouts')
      .select(
        'target_id, org_id, property_id, website_id, requested_contract_version, runtime_package_sha256, status, rolled_back_at'
      )
      .eq('target_id', input.target.id)
      .maybeSingle()
    if (rolloutError) {
      throw new Error(
        `Failed to load SiteForge runtime v3 rollout assignment: ${rolloutError.message}`
      )
    }
    assertRuntimeV3RolloutAssignment({
      release: input.release,
      target: input.target,
      rollout,
    })
    const immutableRelease = buildArtifactBoundRuntimeV3Release(input)
    await input.assertActive?.()
    await input.onProgress?.(
      'installing_runtime_v3',
      'Installing exact signed runtime v3 and base-theme bytes'
    )
    priorTheme = await installer.getActiveTheme({ ssh: input.ssh })
    themeChanged = true
    await installer.ensureInstalled({
      ssh: input.ssh,
      runtimeContractVersion: 3,
      themeArchive: input.release.baseThemePackage,
      runtimePluginArchive: input.release.runtimePackage,
      runtimePluginIdentity: runtimePackageIdentity,
      acfProLicenseKey: input.acfProLicenseKey,
      reuseInstalledAcfPro: input.reuseInstalledAcfPro,
    })
    if (input.release.overlayPackage && input.release.overlayContentHash) {
      const activatedOverlay = await installer.installThemeOverlay({
        ssh: input.ssh,
        archive: input.release.overlayPackage,
        contentHash: input.release.overlayContentHash,
      })
      const expectedOverlay = immutableRelease.identity.overlays[0]?.themeSlug
      if (!expectedOverlay || activatedOverlay !== expectedOverlay) {
        throw new Error(
          'SiteForge runtime v3 activated overlay does not match immutable overlay identity'
        )
      }
    }
    await input.assertActive?.()
    await input.onProgress?.(
      'verifying_runtime_v3',
      'Verifying installed package and remote concurrency identity'
    )
    let repairingRemoteMaterializationDrift = false
    const statePromise = runtime
      .getState(input.release.artifact.websiteId)
      .catch(error => {
        const failure =
          error &&
          typeof error === 'object' &&
          'failure' in error &&
          error.failure &&
          typeof error.failure === 'object' &&
          'code' in error.failure
            ? error.failure
            : null
        const errorMessage =
          typeof failure?.message === 'string'
            ? failure.message
            : error instanceof Error
              ? error.message
              : ''
        const materializationDrift =
          failure?.code === 'stale_remote_state' ||
          errorMessage.includes(
            'no longer matches the active SiteForge v3 resource graph'
          )
        if (
          materializationDrift &&
          expectedRemoteContentHash !== null
        ) {
          repairingRemoteMaterializationDrift = true
          return null
        }
        throw error
      })
    const [health, state, capabilities] = await Promise.all([
      runtime.getHealth(),
      statePromise,
      runtime.getCapabilities(),
    ])
    if (
      health.status !== 'ok' &&
      !(health.status === 'degraded' && repairingRemoteMaterializationDrift)
    ) {
      throw new Error(`SiteForge runtime v3 is ${health.status}`)
    }
    if (
      health.installedRuntime.packageType !== 'runtime_plugin' ||
      health.installedRuntime.manifest.packageVersion !==
        runtimePackageIdentity.packageVersion
    ) {
      throw new Error(
        'SiteForge runtime v3 health version does not match the verified installed package'
      )
    }
    const actualRemoteContentHash = repairingRemoteMaterializationDrift
      ? expectedRemoteContentHash
      : (state?.identity?.artifactContentHash ?? null)
    if (actualRemoteContentHash !== expectedRemoteContentHash) {
      throw new Error(
        'SiteForge runtime v3 remote content hash does not match the expected target identity'
      )
    }
    const resources =
      immutableRelease.resourceGraph.pages.length +
      immutableRelease.resourceGraph.sections.length +
      immutableRelease.resourceGraph.globalComponents.length +
      immutableRelease.resourceGraph.forms.length +
      immutableRelease.resourceGraph.redirects.length +
      immutableRelease.resourceGraph.responsiveRules.length +
      immutableRelease.resourceGraph.accessibilityAnnotations.length +
      immutableRelease.resourceGraph.seo.length +
      immutableRelease.resourceGraph.legal.length +
      immutableRelease.resourceGraph.integrations.length +
      immutableRelease.resourceGraph.assets.length +
      immutableRelease.resourceGraph.removals.length +
      2
    if (
      resources > capabilities.limits.maxResourcesPerDeployment ||
      immutableRelease.operations.length >
        capabilities.limits.maxOperationsPerDeployment ||
      immutableRelease.resourceGraph.assets.length >
        capabilities.limits.maxAssetsPerPreparation
    ) {
      throw new Error('SiteForge runtime v3 release exceeds remote capabilities')
    }
    const unsupportedAsset = immutableRelease.resourceGraph.assets.find(
      asset =>
        asset.bytes > capabilities.limits.maxAssetBytes ||
        !capabilities.limits.acceptedAssetMimeTypes.includes(asset.mimeType)
    )
    if (unsupportedAsset) {
      throw new Error(
        `SiteForge runtime v3 asset ${unsupportedAsset.assetId} exceeds remote capabilities`
      )
    }

    const compiled = compileSiteForgeRuntimeV3Release({
      release: immutableRelease,
      expectedRemoteContentHash,
    })
    await input.onProgress?.(
      'preparing_runtime_v3_assets',
      'Preparing exact immutable runtime v3 asset bytes'
    )
    const prepared = await runtime.prepareAssets(compiled.assetPreparation)
    await input.assertActive?.()
    const submission = createSiteForgeRuntimeV3DeploymentSubmission({
      compiled,
      assetPreparation: prepared,
      expectedRemoteContentHash,
    })
    await input.onProgress?.(
      'applying_runtime_v3_transaction',
      'Applying the exact runtime v3 transaction'
    )
    let deployment = await runtime.submitDeployment(submission)
    for (
      let attempt = 0;
      deployment.status === 'running' && attempt < 60;
      attempt += 1
    ) {
      await sleep(1_000)
      await input.assertActive?.()
      deployment = await runtime.getDeploymentStatus(deployment.transactionId)
    }
    if (deployment.status !== 'succeeded') {
      throw new SiteForgeRuntimeV3ClientError({
        failure:
          deployment.failure || {
            code: 'operation_failed',
            message: 'SiteForge runtime v3 transaction failed',
            retryable: false,
            stage: 'transaction',
            operationSetHash: immutableRelease.identity.operationSetHash,
            expectedRemoteContentHash,
          },
      })
    }
    const { data: appliedRecord, error: appliedRecordError } = await input.client
      .from('siteforge_artifact_deployments')
      .update({
        remote_transaction_id: deployment.transactionId,
        deployment_idempotency_key: submission.idempotencyKey,
        runtime_version: deployment.runtimeVersion,
        remote_manifest_hash: deployment.appliedContentHash,
      })
      .eq('id', deploymentId)
      .select('id')
      .maybeSingle()
    if (appliedRecordError || !appliedRecord) {
      throw new Error(
        `Runtime v3 transaction completed but its identity could not be checkpointed: ${
          appliedRecordError?.message || 'deployment row was not updated'
        }`
      )
    }
    await input.assertActive?.()
    const readback = await runtime.getState(input.release.artifact.websiteId)
    assertRemoteState(readback, immutableRelease, deployment.transactionId)
    const expectedActiveTheme = immutableRelease.identity.overlays[0]?.themeSlug
      ? {
          stylesheet: immutableRelease.identity.overlays[0].themeSlug,
          template: 'oneclick-siteforge',
        }
      : {
          stylesheet: 'oneclick-siteforge',
          template: 'oneclick-siteforge',
        }
    const activeTheme = await installer.getActiveTheme({
      ssh: input.ssh,
      rememberForRollback: false,
      requireStylesheetCss: Boolean(
        immutableRelease.identity.overlays[0]?.themeSlug
      ),
    })
    if (
      activeTheme.stylesheet !== expectedActiveTheme.stylesheet ||
      activeTheme.template !== expectedActiveTheme.template
    ) {
      throw new Error(
        'SiteForge runtime v3 active WordPress theme does not match the immutable release'
      )
    }

    const completedAt = new Date().toISOString()
    const evidence = {
      contractVersion: 3,
      environment: input.environment,
      artifactId: immutableRelease.identity.artifactId,
      artifactContentHash: immutableRelease.identity.artifactContentHash,
      resourceGraphHash: immutableRelease.identity.resourceGraphHash,
      assetManifestHash: immutableRelease.identity.assetManifestHash,
      operationSetHash: immutableRelease.identity.operationSetHash,
      baseThemePackageSha256:
        immutableRelease.identity.baseTheme.archiveSha256,
      overlayPackageSha256:
        immutableRelease.identity.overlays[0]?.package.archiveSha256 || null,
      runtimePackageSha256:
        immutableRelease.identity.runtimePackage.archiveSha256,
      runtimeManifestSha256:
        immutableRelease.identity.runtimePackage.manifestSha256,
      targetId: immutableRelease.target.targetId,
      targetProtection: immutableRelease.target.protection,
      expectedRemoteContentHash,
      finalContentHash: immutableRelease.identity.artifactContentHash,
      transactionId: deployment.transactionId,
      deploymentIdempotencyKey: submission.idempotencyKey,
      verifiedAt: deployment.verification?.verifiedAt || completedAt,
    } as Json
    const metadata = {
      ...record(input.target.metadata),
      runtimeV3: evidence,
    } as Json
    const [deploymentResult, targetResult] = await Promise.all([
      input.client
        .from('siteforge_artifact_deployments')
        .update({
          status: 'ready',
          operation_set_hash: immutableRelease.identity.operationSetHash,
          runtime_contract_version: 3,
          runtime_version: deployment.runtimeVersion,
          runtime_package_sha256:
            immutableRelease.identity.runtimePackage.archiveSha256,
          runtime_manifest_sha256:
            immutableRelease.identity.runtimePackage.manifestSha256,
          remote_transaction_id: deployment.transactionId,
          deployment_idempotency_key: submission.idempotencyKey,
          remote_manifest_hash: immutableRelease.identity.artifactContentHash,
          final_verified_content_hash:
            immutableRelease.identity.artifactContentHash,
          final_verified_asset_manifest_hash:
            immutableRelease.identity.assetManifestHash,
          final_verified_runtime_manifest_sha256:
            immutableRelease.identity.runtimePackage.manifestSha256,
          deployed_url: input.siteUrl,
          admin_url: input.adminUrl,
          deployed_at: completedAt,
          failure_phase: null,
          failure_code: null,
          certification_report: {
            status: 'runtime_v3_verified',
            runtimeEvidence: evidence,
          } as Json,
        })
        .eq('id', deploymentId)
        .select('id')
        .maybeSingle(),
      input.client
        .from('siteforge_wordpress_targets')
        .update({
          status: 'ready',
          runtime_contract_version: 3,
          runtime_version: deployment.runtimeVersion,
          runtime_package_sha256:
            immutableRelease.identity.runtimePackage.archiveSha256,
          runtime_manifest_sha256:
            immutableRelease.identity.runtimePackage.manifestSha256,
          last_verified_artifact_id: immutableRelease.identity.artifactId,
          last_verified_content_hash:
            immutableRelease.identity.artifactContentHash,
          last_verified_asset_manifest_hash:
            immutableRelease.identity.assetManifestHash,
          last_verified_operation_hash:
            immutableRelease.identity.operationSetHash,
          last_verified_runtime_manifest_sha256:
            immutableRelease.identity.runtimePackage.manifestSha256,
          last_runtime_health_at: completedAt,
          protection_mode: immutableRelease.target.protection.mode,
          site_url: input.siteUrl,
          metadata,
          updated_at: completedAt,
        })
        .eq('id', input.target.id)
        .select('id')
        .maybeSingle(),
    ])
    if (
      deploymentResult.error ||
      !deploymentResult.data ||
      targetResult.error ||
      !targetResult.data
    ) {
      throw new Error(
        `Runtime v3 succeeded remotely but exact evidence could not be persisted: ${
          deploymentResult.error?.message ||
          targetResult.error?.message ||
          'required row was not updated'
        }`
      )
    }
    return {
      deployment,
      state: readback,
      runtimeVersion: deployment.runtimeVersion,
      runtimeManifestSha256:
        immutableRelease.identity.runtimePackage.manifestSha256,
      operationSetHash: immutableRelease.identity.operationSetHash,
      assetManifestHash: immutableRelease.identity.assetManifestHash,
      deploymentIdempotencyKey: submission.idempotencyKey,
      deploymentId,
      evidence,
    }
  } catch (error) {
    let terminalError =
      error instanceof SiteForgeRuntimeV3ClientError &&
      error.failure.details
        ? new Error(
            `${error.message}: ${JSON.stringify(error.failure.details)}`,
            { cause: error }
          )
        : error
    if (themeChanged && priorTheme) {
      try {
        await installer.restoreActiveTheme({
          ssh: input.ssh,
          theme: priorTheme,
        })
      } catch (restoreError) {
        terminalError = new Error(
          `Runtime v3 failed and prior WordPress theme could not be restored: ${
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError)
          }`,
          { cause: error }
        )
      }
    }
    await persistFailure(input, deploymentId, terminalError)
    throw terminalError
  }
}
