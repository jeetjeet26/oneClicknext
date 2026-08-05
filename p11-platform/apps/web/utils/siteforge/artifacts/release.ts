import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssetSource, AssetType, WebsiteAsset } from '@/types/siteforge'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  inspectStoredOverlayPackage,
  overlayManifestSchema,
  verifyOverlaySignature,
} from '@/utils/siteforge/editor/overlay-contract'
import {
  canonicalizeSiteForgeContent,
  hashSiteForgeContent,
} from '@/utils/siteforge/content-hash'
import type { ImmutableRuntimeAsset } from '@/utils/siteforge/runtime-contract'
import {
  isSiteForgeRuntimeBackedContractVersion,
  parseSiteForgeRuntimeContractVersion,
} from '@/utils/siteforge/runtime-dispatcher'

const SITEFORGE_RUNTIME_V3_MANIFEST_PATH =
  'oneclick-siteforge-runtime/siteforge-runtime-build-manifest.json'
const SITEFORGE_RUNTIME_V3_ARCHIVE_ROOT = 'oneclick-siteforge-runtime/'
const MAX_RUNTIME_PACKAGE_FILES = 10_001
const MAX_RUNTIME_PACKAGE_FILE_BYTES = 25_000_000
const MAX_RUNTIME_PACKAGE_EXTRACTED_BYTES = 100_000_000

const runtimeV3SignatureEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    signatureAlgorithm: z.literal('ed25519-sha256'),
    packageType: z.literal('runtime_plugin'),
    version: z
      .string()
      .regex(
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
      ),
    runtimeContractVersion: z.literal(3),
    filename: z.literal('oneclick-siteforge-runtime.zip'),
    storagePath: z.string().min(1).max(1_000),
    packageSha256: z.string().regex(/^[a-f0-9]{64}$/),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    gitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
  })
  .strict()

const runtimeV3RegistryManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    packageType: z.literal('runtime_plugin'),
    packageName: z.literal('oneclick-siteforge-runtime'),
    version: z
      .string()
      .regex(
        /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
      ),
    runtimeContractVersion: z.literal(3),
    gitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(500)
              .refine(
                value =>
                  !value.startsWith('/') &&
                  !value.includes('\\') &&
                  !value.split('/').some(part => part === '.' || part === '..'),
                'Runtime package paths must be normalized and relative'
              ),
            bytes: z.number().int().nonnegative(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict()
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = new Set<string>()
    for (const [index, file] of manifest.files.entries()) {
      if (paths.has(file.path)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'path'],
          message: 'Runtime package manifest contains a duplicate path',
        })
      }
      paths.add(file.path)
    }
  })

type RuntimePackageRecord = {
  id: string
  storage_path: string
  package_sha256: string
  package_type: string
  version: string
  manifest: Json
  manifest_sha256: string | null
  runtime_contract_version: number | null
  signature: string | null
  signature_algorithm: string | null
  signing_key_id: string | null
  publication_status: string
  revoked_at: string | null
  revocation_reason: string | null
}

type RuntimeV3RegistryManifest = z.infer<
  typeof runtimeV3RegistryManifestSchema
>

export interface VerifiedRuntimeV3PackageIdentity {
  packageId: string
  packageType: 'runtime_plugin'
  packageVersion: string
  archiveSha256: string
  archiveBytes: number
  manifestSha256: string
  manifest: RuntimeV3RegistryManifest
  signingKeyId: string
}

const assetManifestSchema = z.array(
  z.object({
    id: z.string().uuid(),
    type: z.string().min(1),
    source: z.string().min(1),
    fileUrl: z.string().url(),
    originalUrl: z.string().url().nullable().optional(),
    storagePath: z.string().min(1),
    byteSha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    altText: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    width: z.number().int().nonnegative().nullable().optional(),
    height: z.number().int().nonnegative().nullable().optional(),
    focalPoint: z.unknown().nullable().optional(),
    approvalStatus: z.literal('approved'),
    rightsStatus: z.enum(['owned', 'licensed', 'generated']),
    createdAt: z.string().nullable().optional(),
  })
)

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function isSiteForgeRuntimeV3Enabled(): boolean {
  return process.env.SITEFORGE_RUNTIME_V3_ENABLED?.trim().toLowerCase() === 'true'
}

function parseRuntimeV3PublicKeys(): Record<string, string> {
  const raw = process.env.SITEFORGE_RUNTIME_V3_PUBLIC_KEYS
  if (!raw?.trim()) {
    throw new Error('SITEFORGE_RUNTIME_V3_PUBLIC_KEYS is required for runtime v3')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('SITEFORGE_RUNTIME_V3_PUBLIC_KEYS must be valid JSON')
  }
  return z.record(z.string().min(1), z.string().min(1)).parse(parsed)
}

function runtimeV3PublicKey(value: string) {
  if (value.includes('BEGIN PUBLIC KEY')) {
    return createPublicKey(value.replace(/\\n/g, '\n'))
  }
  return createPublicKey({
    key: Buffer.from(value, 'base64'),
    format: 'der',
    type: 'spki',
  })
}

function assertRuntimeV3Signature(record: RuntimePackageRecord): void {
  if (
    record.signature_algorithm !== 'ed25519-sha256' ||
    !record.signature ||
    !record.signing_key_id
  ) {
    throw new Error('SiteForge runtime v3 package trust metadata is incomplete')
  }
  const manifest = runtimeV3RegistryManifestSchema.parse(record.manifest)
  const expectedEnvelope = runtimeV3SignatureEnvelopeSchema.parse({
    schemaVersion: 1 as const,
    signatureAlgorithm: 'ed25519-sha256' as const,
    packageType: 'runtime_plugin' as const,
    version: record.version,
    runtimeContractVersion: 3 as const,
    filename: path.posix.basename(record.storage_path),
    storagePath: record.storage_path,
    packageSha256: record.package_sha256,
    manifestSha256: record.manifest_sha256,
    gitSha: manifest.gitSha,
  })
  const publicKey = parseRuntimeV3PublicKeys()[record.signing_key_id]
  if (!publicKey) {
    throw new Error(
      `No trusted SiteForge runtime v3 public key exists for ${record.signing_key_id}`
    )
  }
  let signatureBytes: Buffer
  try {
    signatureBytes = Buffer.from(record.signature, 'base64')
  } catch {
    throw new Error('SiteForge runtime v3 package signature is invalid')
  }
  if (
    signatureBytes.byteLength !== 64 ||
    !verify(
      null,
      Buffer.from(
        sha256(Buffer.from(canonicalizeSiteForgeContent(expectedEnvelope))),
        'hex'
      ),
      runtimeV3PublicKey(publicKey),
      signatureBytes
    )
  ) {
    throw new Error('SiteForge runtime v3 package signature is invalid')
  }
}

export function inspectSiteForgeRuntimeV3Package(
  archive: Uint8Array,
  expected: {
    packageId: string
    packageVersion: string
    archiveSha256: string
    manifestSha256: string
    manifest: unknown
    signingKeyId: string
  }
): VerifiedRuntimeV3PackageIdentity {
  if (sha256(archive) !== expected.archiveSha256) {
    throw new Error('Immutable runtime_plugin package digest mismatch')
  }
  const manifest = runtimeV3RegistryManifestSchema.parse(expected.manifest)
  if (
    manifest.runtimeContractVersion !== 3 ||
    manifest.packageName !== 'oneclick-siteforge-runtime' ||
    manifest.version !== expected.packageVersion ||
    hashSiteForgeContent(manifest) !== expected.manifestSha256
  ) {
    throw new Error('SiteForge runtime v3 registry manifest identity is invalid')
  }

  let entryCount = 0
  let extractedBytes = 0
  const entries = unzipSync(archive, {
    filter: entry => {
      entryCount += 1
      extractedBytes += entry.originalSize
      if (
        entryCount > MAX_RUNTIME_PACKAGE_FILES ||
        entry.originalSize > MAX_RUNTIME_PACKAGE_FILE_BYTES ||
        extractedBytes > MAX_RUNTIME_PACKAGE_EXTRACTED_BYTES
      ) {
        throw new Error('SiteForge runtime v3 package exceeds extraction limits')
      }
      if (
        entry.name.startsWith('/') ||
        entry.name.includes('\\') ||
        entry.name.split('/').includes('..')
      ) {
        throw new Error(
          `SiteForge runtime v3 package contains unsafe entry ${entry.name}`
        )
      }
      return true
    },
  })
  const descriptor = entries[SITEFORGE_RUNTIME_V3_MANIFEST_PATH]
  if (!descriptor) {
    throw new Error('SiteForge runtime v3 package has no internal manifest')
  }
  let internalManifest: RuntimeV3RegistryManifest
  try {
    internalManifest = runtimeV3RegistryManifestSchema.parse(
      JSON.parse(strFromU8(descriptor))
    )
  } catch {
    throw new Error('SiteForge runtime v3 internal manifest is invalid')
  }
  if (
    canonicalizeSiteForgeContent(internalManifest) !==
      canonicalizeSiteForgeContent(manifest) ||
    hashSiteForgeContent(internalManifest) !== expected.manifestSha256
  ) {
    throw new Error('SiteForge runtime v3 internal manifest does not match registry')
  }

  const expectedPaths = new Set([SITEFORGE_RUNTIME_V3_MANIFEST_PATH])
  for (const file of manifest.files) {
    const archivePath = `${SITEFORGE_RUNTIME_V3_ARCHIVE_ROOT}${file.path}`
    const bytes = entries[archivePath]
    expectedPaths.add(archivePath)
    if (
      !bytes ||
      bytes.byteLength !== file.bytes ||
      sha256(bytes) !== file.sha256
    ) {
      throw new Error(
        `SiteForge runtime v3 package file does not match manifest: ${file.path}`
      )
    }
  }
  const actualPaths = Object.keys(entries).filter(name => !name.endsWith('/'))
  if (
    actualPaths.length !== expectedPaths.size ||
    actualPaths.some(name => !expectedPaths.has(name))
  ) {
    throw new Error('SiteForge runtime v3 package entries do not match manifest')
  }

  return {
    packageId: expected.packageId,
    packageType: 'runtime_plugin' as const,
    packageVersion: expected.packageVersion,
    archiveSha256: expected.archiveSha256,
    archiveBytes: archive.byteLength,
    manifestSha256: expected.manifestSha256,
    manifest,
    signingKeyId: expected.signingKeyId,
  }
}

async function verifyAssetBytes(
  url: string,
  expectedSha256: string
): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`Failed to load immutable asset bytes (${response.status})`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== expectedSha256) {
    throw new Error('Immutable SiteForge asset byte digest mismatch')
  }
}

export interface VerifiedSiteForgeRelease {
  artifact: {
    id: string
    websiteId: string
    propertyId: string
    orgId: string
    blueprint: Json
    contentHash: string
    assetManifestHash: string
    baseThemePackageSha256: string
    overlayPackageSha256: string | null
    themeOverlayId: string | null
    runtimeContractVersion: number
    runtimePackageSha256: string | null
    operationSetHash: string | null
  }
  assets: WebsiteAsset[]
  provenanceUrls: string[]
  runtimeAssets: ImmutableRuntimeAsset[]
  runtimeSelectedAssets: {
    logoAssetId: string | null
    faviconAssetId: string | null
  }
  baseThemePackage: Buffer
  runtimePackage: Buffer | null
  runtimePackageIdentity?: VerifiedRuntimeV3PackageIdentity | null
  overlayPackage: Buffer | null
  overlayContentHash: string | null
}

async function loadImmutableRuntimePackage(
  packageSha256: string,
  packageType: 'runtime_plugin' | 'base_theme',
  client: SupabaseClient<Database>,
  runtimeContractVersion?: 2 | 3
): Promise<{
  bytes: Buffer
  identity: VerifiedRuntimeV3PackageIdentity | null
} | null> {
  let query = client
    .from('siteforge_runtime_packages')
    .select(
      'id, storage_path, package_sha256, package_type, version, manifest, manifest_sha256, runtime_contract_version, signature, signature_algorithm, signing_key_id, publication_status, revoked_at, revocation_reason'
    )
    .eq('package_type', packageType)
    .eq('package_sha256', packageSha256)
  if (packageType === 'runtime_plugin' && runtimeContractVersion === 2) {
    query = query.eq('runtime_contract_version', 2)
  }
  if (packageType === 'runtime_plugin' && runtimeContractVersion === 3) {
    query = query
      .eq('runtime_contract_version', 3)
      .eq('publication_status', 'published')
      .is('revoked_at', null)
  }
  const { data: record, error } = await query.maybeSingle()
  if (error) {
    throw new Error(
      `Failed to load immutable ${packageType} identity: ${error.message}`
    )
  }
  if (!record) return null
  const packageRecord = record as RuntimePackageRecord
  if (
    runtimeContractVersion === 3 &&
    (packageRecord.runtime_contract_version !== 3 ||
      packageRecord.package_type !== 'runtime_plugin' ||
      packageRecord.package_sha256 !== packageSha256 ||
      packageRecord.publication_status !== 'published' ||
      packageRecord.revoked_at !== null ||
      packageRecord.revocation_reason !== null ||
      !packageRecord.manifest_sha256)
  ) {
    throw new Error(
      'SiteForge runtime v3 package is unpublished, revoked, or has the wrong identity'
    )
  }
  if (runtimeContractVersion === 3) {
    assertRuntimeV3Signature(packageRecord)
  }
  const { data: blob, error: downloadError } = await client.storage
    .from('siteforge-artifacts')
    .download(packageRecord.storage_path)
  if (downloadError || !blob) {
    throw new Error(
      `Failed to load immutable ${packageType} package: ${
        downloadError?.message || 'missing blob'
      }`
    )
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (sha256(bytes) !== packageRecord.package_sha256) {
    throw new Error(`Immutable ${packageType} package digest mismatch`)
  }
  const inspectedIdentity =
    runtimeContractVersion === 3 && packageRecord.manifest_sha256
      ? inspectSiteForgeRuntimeV3Package(bytes, {
          packageId: packageRecord.id,
          packageVersion: packageRecord.version,
          archiveSha256: packageRecord.package_sha256,
          manifestSha256: packageRecord.manifest_sha256,
          manifest: packageRecord.manifest,
          signingKeyId: packageRecord.signing_key_id || '',
        })
      : null
  const identity = inspectedIdentity
  return { bytes, identity }
}

export async function loadVerifiedSiteForgeRelease(
  input: {
    artifactId: string
    websiteId: string
    propertyId: string
    orgId: string
    contentHash: string
  },
  client: SupabaseClient<Database> = createServiceClient()
): Promise<VerifiedSiteForgeRelease> {
  const { data: artifact, error } = await client
    .from('siteforge_blueprint_versions')
    .select(
      'id, website_id, property_id, org_id, blueprint, content_hash, asset_manifest, asset_manifest_hash, base_theme_package_sha256, theme_overlay_id, overlay_package_sha256, runtime_contract_version, runtime_package_sha256, operation_set_hash'
    )
    .eq('id', input.artifactId)
    .eq('website_id', input.websiteId)
    .eq('property_id', input.propertyId)
    .eq('org_id', input.orgId)
    .single()
  if (
    error ||
    !artifact ||
    artifact.content_hash !== input.contentHash ||
    hashSiteForgeContent(artifact.blueprint) !== artifact.content_hash
  ) {
    throw new Error('SiteForge release artifact hash does not match')
  }
  if (!artifact.asset_manifest_hash || !artifact.base_theme_package_sha256) {
    throw new Error(
      'SiteForge artifact is missing an immutable release snapshot'
    )
  }
  const runtimeContractVersion = parseSiteForgeRuntimeContractVersion(
    artifact.runtime_contract_version
  )
  const runtimeBacked = isSiteForgeRuntimeBackedContractVersion(
    runtimeContractVersion
  )
  if (runtimeContractVersion === 3 && !isSiteForgeRuntimeV3Enabled()) {
    throw new Error(
      'SiteForge runtime v3 release loading is disabled by SITEFORGE_RUNTIME_V3_ENABLED'
    )
  }

  const manifest = assetManifestSchema.parse(artifact.asset_manifest)
  if (hashSiteForgeContent(manifest) !== artifact.asset_manifest_hash) {
    throw new Error('SiteForge artifact asset manifest hash does not match')
  }
  const preparedAssets = await Promise.all(
    manifest.map(async (asset) => {
      const { data: signed, error: signedError } = await client.storage
        .from('siteforge-artifacts')
        .createSignedUrl(asset.storagePath, 15 * 60)
      if (signedError || !signed?.signedUrl) {
        throw new Error(
          `Failed to sign immutable asset ${asset.id}: ${signedError?.message || 'missing URL'}`
        )
      }
      await verifyAssetBytes(signed.signedUrl, asset.byteSha256)
      if (runtimeBacked && (asset.bytes === null || !asset.mimeType)) {
        throw new Error(
          `SiteForge v${runtimeContractVersion} asset ${asset.id} is missing byte size or MIME type`
        )
      }
      return {
        websiteAsset: {
          id: asset.id,
          websiteId: artifact.website_id,
          assetType: asset.type as AssetType,
          source: asset.source as AssetSource,
          fileUrl: signed.signedUrl,
          fileSize: asset.bytes ?? undefined,
          mimeType: asset.mimeType ?? undefined,
          altText: asset.altText ?? undefined,
          caption: asset.caption ?? undefined,
          optimized: true,
          originalUrl: asset.originalUrl ?? undefined,
          createdAt: asset.createdAt || new Date(0).toISOString(),
        } satisfies WebsiteAsset,
        runtimeAsset: {
          assetId: asset.id,
          sourceUrl: signed.signedUrl,
          byteHash: asset.byteSha256,
          bytes: asset.bytes ?? 0,
          mimeType: asset.mimeType || 'application/octet-stream',
          filename: asset.storagePath.split('/').pop() || asset.id,
          role: asset.type,
          altText: asset.altText ?? null,
          caption: asset.caption ?? null,
        } satisfies ImmutableRuntimeAsset,
      }
    })
  )
  const assets = preparedAssets.map((asset) => asset.websiteAsset)
  const provenanceUrls = manifest.flatMap((asset) =>
    [asset.fileUrl, asset.originalUrl].filter(
      (value): value is string => typeof value === 'string'
    )
  )
  const runtimeAssets = preparedAssets.map((asset) => asset.runtimeAsset)
  const blueprintRecord = artifact.blueprint as Record<string, unknown>
  const siteConfiguration =
    blueprintRecord.siteConfiguration &&
    typeof blueprintRecord.siteConfiguration === 'object' &&
    !Array.isArray(blueprintRecord.siteConfiguration)
      ? (blueprintRecord.siteConfiguration as Record<string, unknown>)
      : {}
  const media =
    siteConfiguration.media &&
    typeof siteConfiguration.media === 'object' &&
    !Array.isArray(siteConfiguration.media)
      ? (siteConfiguration.media as Record<string, unknown>)
      : {}
  const photoManifest =
    blueprintRecord.photoManifest &&
    typeof blueprintRecord.photoManifest === 'object' &&
    !Array.isArray(blueprintRecord.photoManifest)
      ? (blueprintRecord.photoManifest as Record<string, unknown>)
      : {}
  const logoAssets =
    photoManifest.logoAssets &&
    typeof photoManifest.logoAssets === 'object' &&
    !Array.isArray(photoManifest.logoAssets)
      ? (photoManifest.logoAssets as Record<string, unknown>)
      : {}
  const directLogoId =
    typeof media.logoAssetId === 'string'
      ? media.logoAssetId
      : typeof logoAssets.primaryAssetId === 'string'
        ? logoAssets.primaryAssetId
        : null
  const directFaviconId =
    typeof media.faviconAssetId === 'string' ? media.faviconAssetId : null
  const findSelectedAsset = (
    type: string,
    directId: string | null,
    configuredUrl: unknown
  ) => {
    const byId = directId
      ? manifest.find((asset) => asset.id === directId && asset.type === type)
      : undefined
    if (directId) return byId?.id || null
    if (typeof configuredUrl !== 'string') return null
    return (
      manifest.find(
        (asset) =>
          asset.type === type &&
          (asset.fileUrl === configuredUrl ||
            asset.originalUrl === configuredUrl)
      )?.id || null
    )
  }
  const runtimeSelectedAssets = {
    logoAssetId: findSelectedAsset('logo', directLogoId, media.logoUrl),
    faviconAssetId: findSelectedAsset(
      'favicon',
      directFaviconId,
      media.faviconUrl
    ),
  }
  if (
    runtimeBacked &&
    (directLogoId || typeof media.logoUrl === 'string') &&
    !runtimeSelectedAssets.logoAssetId
  ) {
    throw new Error(
      `SiteForge v${runtimeContractVersion} artifact declares a logo without an exact immutable asset`
    )
  }
  if (
    runtimeBacked &&
    typeof media.faviconUrl === 'string' &&
    !runtimeSelectedAssets.faviconAssetId
  ) {
    throw new Error(
      `SiteForge v${runtimeContractVersion} artifact declares a favicon without an exact immutable asset`
    )
  }

  const immutableBaseThemePackage = await loadImmutableRuntimePackage(
    artifact.base_theme_package_sha256,
    'base_theme',
    client
  )
  let baseThemePackage = immutableBaseThemePackage?.bytes ?? null
  if (!baseThemePackage) {
    if (runtimeBacked) {
      throw new Error(
        `SiteForge v${runtimeContractVersion} artifact base theme package is not immutable`
      )
    }
    baseThemePackage = await readFile(
      path.resolve(process.cwd(), 'runtime-assets/oneclick-siteforge.zip')
    )
    if (sha256(baseThemePackage) !== artifact.base_theme_package_sha256) {
      throw new Error('SiteForge base theme package digest mismatch')
    }
  }

  const immutableRuntimePackage = artifact.runtime_package_sha256
    ? await loadImmutableRuntimePackage(
        artifact.runtime_package_sha256,
        'runtime_plugin',
        client,
        runtimeContractVersion === 2 || runtimeContractVersion === 3
          ? runtimeContractVersion
          : undefined
      )
    : null
  const runtimePackage = immutableRuntimePackage?.bytes ?? null
  const runtimePackageIdentity = immutableRuntimePackage?.identity ?? null
  if (runtimeBacked && !runtimePackage) {
    throw new Error(
      `SiteForge v${runtimeContractVersion} artifact runtime package is unavailable`
    )
  }

  let overlayPackage: Buffer | null = null
  let overlayContentHash: string | null = null
  if (artifact.theme_overlay_id) {
    const { data: overlay, error: overlayError } = await client
      .from('siteforge_theme_overlays')
      .select('content_hash, storage_path, package_sha256, signature, manifest')
      .eq('id', artifact.theme_overlay_id)
      .eq('website_id', artifact.website_id)
      .single()
    if (
      overlayError ||
      !overlay ||
      overlay.package_sha256 !== artifact.overlay_package_sha256
    ) {
      throw new Error('SiteForge overlay identity does not match the artifact')
    }
    const { data: packageBlob, error: downloadError } = await client.storage
      .from('siteforge-artifacts')
      .download(overlay.storage_path)
    if (downloadError || !packageBlob) {
      throw new Error(
        `Failed to load SiteForge overlay package: ${downloadError?.message || 'missing blob'}`
      )
    }
    overlayPackage = Buffer.from(await packageBlob.arrayBuffer())
    if (sha256(overlayPackage) !== overlay.package_sha256) {
      throw new Error('SiteForge overlay package digest mismatch')
    }
    const overlayIdentity =
      blueprintRecord.themeOverlayIdentity &&
      typeof blueprintRecord.themeOverlayIdentity === 'object' &&
      !Array.isArray(blueprintRecord.themeOverlayIdentity)
        ? (blueprintRecord.themeOverlayIdentity as Record<string, unknown>)
        : {}
    if (overlayIdentity.contractVersion === 1) {
      const signingSecret = process.env.SITEFORGE_OVERLAY_SIGNING_SECRET
      if (
        !signingSecret ||
        !verifyOverlaySignature({
          websiteId: artifact.website_id,
          contentHash: overlay.content_hash,
          packageSha256: overlay.package_sha256,
          signature: overlay.signature,
          signingSecret,
        })
      ) {
        throw new Error('SiteForge overlay package signature is invalid')
      }
      inspectStoredOverlayPackage(overlayPackage, {
        contentHash: overlay.content_hash,
        manifest: overlayManifestSchema.parse(overlay.manifest),
        packageSha256: overlay.package_sha256,
      })
    }
    overlayContentHash = overlay.content_hash
  }

  return {
    artifact: {
      id: artifact.id,
      websiteId: artifact.website_id,
      propertyId: artifact.property_id,
      orgId: artifact.org_id,
      blueprint: artifact.blueprint,
      contentHash: artifact.content_hash,
      assetManifestHash: artifact.asset_manifest_hash,
      baseThemePackageSha256: artifact.base_theme_package_sha256,
      overlayPackageSha256: artifact.overlay_package_sha256,
      themeOverlayId: artifact.theme_overlay_id,
      runtimeContractVersion,
      runtimePackageSha256: artifact.runtime_package_sha256,
      operationSetHash: artifact.operation_set_hash,
    },
    assets,
    provenanceUrls,
    runtimeAssets,
    runtimeSelectedAssets,
    baseThemePackage,
    runtimePackage,
    runtimePackageIdentity,
    overlayPackage,
    overlayContentHash,
  }
}
