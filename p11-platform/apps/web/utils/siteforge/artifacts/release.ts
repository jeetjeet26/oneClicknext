import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AssetSource, AssetType, WebsiteAsset } from '@/types/siteforge'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import type { ImmutableRuntimeAsset } from '@/utils/siteforge/runtime-contract'

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
    approvalStatus: z.literal('approved'),
    rightsStatus: z.enum(['owned', 'licensed', 'generated']),
    createdAt: z.string().nullable().optional(),
  })
)

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
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
  runtimeAssets: ImmutableRuntimeAsset[]
  runtimeSelectedAssets: {
    logoAssetId: string | null
    faviconAssetId: string | null
  }
  baseThemePackage: Buffer
  runtimePackage: Buffer | null
  overlayPackage: Buffer | null
  overlayContentHash: string | null
}

async function loadImmutableRuntimePackage(
  packageSha256: string,
  packageType: 'runtime_plugin' | 'base_theme',
  client: SupabaseClient<Database>
): Promise<Buffer | null> {
  const { data: record, error } = await client
    .from('siteforge_runtime_packages')
    .select('storage_path, package_sha256')
    .eq('package_type', packageType)
    .eq('package_sha256', packageSha256)
    .maybeSingle()
  if (error) {
    throw new Error(
      `Failed to load immutable ${packageType} identity: ${error.message}`
    )
  }
  if (!record) return null
  const { data: blob, error: downloadError } = await client.storage
    .from('siteforge-artifacts')
    .download(record.storage_path)
  if (downloadError || !blob) {
    throw new Error(
      `Failed to load immutable ${packageType} package: ${
        downloadError?.message || 'missing blob'
      }`
    )
  }
  const bytes = Buffer.from(await blob.arrayBuffer())
  if (sha256(bytes) !== record.package_sha256) {
    throw new Error(`Immutable ${packageType} package digest mismatch`)
  }
  return bytes
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
      if (
        artifact.runtime_contract_version >= 2 &&
        (asset.bytes === null || !asset.mimeType)
      ) {
        throw new Error(
          `SiteForge v2 asset ${asset.id} is missing byte size or MIME type`
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
    artifact.runtime_contract_version >= 2 &&
    (directLogoId || typeof media.logoUrl === 'string') &&
    !runtimeSelectedAssets.logoAssetId
  ) {
    throw new Error(
      'SiteForge v2 artifact declares a logo without an exact immutable asset'
    )
  }
  if (
    artifact.runtime_contract_version >= 2 &&
    typeof media.faviconUrl === 'string' &&
    !runtimeSelectedAssets.faviconAssetId
  ) {
    throw new Error(
      'SiteForge v2 artifact declares a favicon without an exact immutable asset'
    )
  }

  let baseThemePackage = await loadImmutableRuntimePackage(
    artifact.base_theme_package_sha256,
    'base_theme',
    client
  )
  if (!baseThemePackage) {
    if (artifact.runtime_contract_version >= 2) {
      throw new Error(
        'SiteForge v2 artifact base theme package is not immutable'
      )
    }
    baseThemePackage = await readFile(
      path.resolve(process.cwd(), 'runtime-assets/oneclick-siteforge.zip')
    )
    if (sha256(baseThemePackage) !== artifact.base_theme_package_sha256) {
      throw new Error('SiteForge base theme package digest mismatch')
    }
  }

  const runtimePackage = artifact.runtime_package_sha256
    ? await loadImmutableRuntimePackage(
        artifact.runtime_package_sha256,
        'runtime_plugin',
        client
      )
    : null
  if (artifact.runtime_contract_version >= 2 && !runtimePackage) {
    throw new Error('SiteForge v2 artifact runtime package is unavailable')
  }

  let overlayPackage: Buffer | null = null
  let overlayContentHash: string | null = null
  if (artifact.theme_overlay_id) {
    const { data: overlay, error: overlayError } = await client
      .from('siteforge_theme_overlays')
      .select('content_hash, storage_path, package_sha256, signature')
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
      runtimeContractVersion: artifact.runtime_contract_version,
      runtimePackageSha256: artifact.runtime_package_sha256,
      operationSetHash: artifact.operation_set_hash,
    },
    assets,
    runtimeAssets,
    runtimeSelectedAssets,
    baseThemePackage,
    runtimePackage,
    overlayPackage,
    overlayContentHash,
  }
}
