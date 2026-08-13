import { createServiceClient } from '@/utils/supabase/admin'
import { createHash } from 'node:crypto'
import type { Tables, TablesInsert } from '@/types/supabase'
import type {
  AssetSource,
  AssetType,
  WebsiteAsset,
} from '@/types/siteforge'
import type { Photo, PhotoManifest } from '@/utils/siteforge/agents/photo-agent'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { assertAssetCanBeUsed } from './curation'

type ServiceClient = ReturnType<typeof createServiceClient>
const MAX_SITEFORGE_ASSET_BYTES = 25 * 1024 * 1024

async function fetchAssetDigest(url: string): Promise<{
  byteSha256: string
  bytes: number
  mimeType: string | null
  data: Uint8Array
}> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`Failed to snapshot SiteForge asset bytes (${response.status})`)
  }
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_SITEFORGE_ASSET_BYTES) {
    throw new Error('SiteForge asset exceeds immutable snapshot size limit')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_SITEFORGE_ASSET_BYTES) {
    throw new Error('SiteForge asset exceeds immutable snapshot size limit')
  }
  return {
    byteSha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    mimeType: response.headers.get('content-type'),
    data: bytes,
  }
}

function extensionForMimeType(mimeType: string | null): string {
  const normalized = mimeType?.split(';')[0].trim().toLowerCase()
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  }
  const extension = normalized ? extensions[normalized] : null
  if (!extension) throw new Error(`Unsupported SiteForge asset MIME type: ${mimeType}`)
  return extension
}

export function mapWebsiteAssetRow(
  row: Tables<'website_assets'>
): WebsiteAsset {
  return {
    id: row.id,
    websiteId: row.website_id,
    assetType: row.asset_type as AssetType,
    source: row.source as AssetSource,
    fileUrl: row.file_url,
    fileSize: row.file_size_bytes ?? undefined,
    mimeType: row.mime_type ?? undefined,
    wpMediaId: row.wp_media_id ?? undefined,
    altText: row.alt_text ?? undefined,
    caption: row.caption ?? undefined,
    optimized: row.optimized ?? false,
    originalUrl: row.original_url ?? undefined,
    createdAt: row.created_at || new Date(0).toISOString(),
  }
}

function assetTypeForPhoto(
  category: string
): TablesInsert<'website_assets'>['asset_type'] {
  switch (category) {
    case 'hero':
      return 'hero_image'
    case 'amenity':
    case 'amenities':
      return 'amenity_photo'
    case 'logo':
    case 'logos':
      return 'logo'
    default:
      return 'lifestyle_photo'
  }
}

function assetSourceForPhoto(
  type: Photo['type']
): TablesInsert<'website_assets'>['source'] {
  if (type === 'brandforge') return 'brandforge'
  if (type === 'generated') return 'generated'
  return 'uploaded'
}

export async function persistSiteForgeAssets(
  websiteId: string,
  manifest: PhotoManifest,
  supabase: ServiceClient = createServiceClient()
): Promise<PhotoManifest> {
  const persisted = new Map<
    string,
    {
      assetId: string
      contentHash: string
      altText: string
      sourceAssetId?: string
      rightsStatus: Photo['rightsStatus']
      approvalStatus: Photo['approvalStatus']
    }
  >()
  const sourceIds = [...new Set(manifest.photos.flatMap(photo => {
    const candidate = photo.sourceAssetId || photo.id
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
      ? [candidate]
      : []
  }))]
  const { data: sourceAssets, error: sourceAssetError } = sourceIds.length
    ? await supabase
        .from('content_assets')
        .select('id, property_id, content_hash, rights_status, approval_status, curation_status, expires_at, duplicate_of')
        .in('id', sourceIds)
    : { data: [], error: null }
  if (sourceAssetError) {
    throw new Error(`Failed to validate SiteForge source assets: ${sourceAssetError.message}`)
  }
  const sourceAssetsById = new Map((sourceAssets || []).map(asset => [asset.id, asset]))

  for (const photo of manifest.photos) {
    const isPlaceholder = photo.id.startsWith('siteforge-placeholder-')
    const sourceAssetId = photo.sourceAssetId || (
      sourceAssetsById.has(photo.id) ? photo.id : undefined
    )
    const sourceAsset = sourceAssetId ? sourceAssetsById.get(sourceAssetId) : undefined
    if ((photo.type === 'uploaded' || (photo.type === 'brandforge' && sourceAssetId))) {
      if (!sourceAsset) {
        throw new Error(`SiteForge source asset ${sourceAssetId || photo.id} is unavailable`)
      }
      try {
        assertAssetCanBeUsed(sourceAsset)
      } catch {
        throw new Error(`SiteForge source asset ${sourceAsset.id} is not approved and rights-cleared`)
      }
    }
    const rightsStatus: Photo['rightsStatus'] = sourceAsset
      ? sourceAsset.rights_status as Photo['rightsStatus']
      : photo.type === 'generated' || photo.type === 'brandforge'
        ? 'generated'
        : 'unknown'
    const approvalStatus: Photo['approvalStatus'] = sourceAsset
      ? sourceAsset.approval_status as Photo['approvalStatus']
      : photo.type === 'brandforge' || isPlaceholder
        ? 'approved'
        : 'pending'
    const contentHash = hashSiteForgeContent({
      sourceId: photo.id,
      url: photo.url,
      type: photo.type,
      category: photo.category,
      prompt: photo.prompt || null,
    })
    const altText =
      photo.scene?.trim() ||
      `${photo.category.replace(/[-_]/g, ' ')} photograph`
    const byteSnapshot = await fetchAssetDigest(photo.url)
    const storagePath = `assets/${byteSnapshot.byteSha256}.${extensionForMimeType(
      byteSnapshot.mimeType
    )}`
    const { error: uploadError } = await supabase.storage
      .from('siteforge-artifacts')
      .upload(storagePath, byteSnapshot.data, {
        contentType: byteSnapshot.mimeType || undefined,
        upsert: false,
      })
    if (
      uploadError &&
      !uploadError.message.toLowerCase().includes('already exists')
    ) {
      throw new Error(
        `Failed to snapshot SiteForge asset ${photo.id}: ${uploadError.message}`
      )
    }

    const { data: existing } = await supabase
      .from('website_assets')
      .select('id, byte_sha256, storage_path')
      .eq('website_id', websiteId)
      .eq('content_hash', contentHash)
      .maybeSingle()

    let assetId = existing?.id || null
    if (
      assetId &&
      (existing?.byte_sha256 !== byteSnapshot.byteSha256 ||
        existing.storage_path !== storagePath)
    ) {
      const { error: digestError } = await supabase
        .from('website_assets')
        .update({
          byte_sha256: byteSnapshot.byteSha256,
          file_size_bytes: byteSnapshot.bytes,
          mime_type: byteSnapshot.mimeType,
          storage_path: storagePath,
        })
        .eq('id', assetId)
      if (digestError) {
        throw new Error(
          `Failed to persist SiteForge asset digest ${photo.id}: ${digestError.message}`
        )
      }
    }
    if (!assetId) {
      const { data: created, error } = await supabase
        .from('website_assets')
        .insert({
          website_id: websiteId,
          source_asset_id:
            sourceAssetId || null,
          asset_type: assetTypeForPhoto(photo.category),
          source: assetSourceForPhoto(photo.type),
          file_url: photo.url,
          content_hash: contentHash,
          byte_sha256: byteSnapshot.byteSha256,
          file_size_bytes: byteSnapshot.bytes,
          mime_type: byteSnapshot.mimeType,
          storage_path: storagePath,
          alt_text: altText,
          optimized: false,
          rights_status: rightsStatus,
          approval_status: approvalStatus,
          generation_prompt: photo.prompt || null,
          quality_score: photo.quality,
          metadata: {
            sourcePhotoId: photo.id,
            sourceAssetId: sourceAssetId || null,
            scene: photo.scene || null,
            category: photo.category,
            placeholder: isPlaceholder,
          },
        })
        .select('id')
        .single()

      if (error || !created) {
        if (error?.code === '23505') {
          const { data: raced } = await supabase
            .from('website_assets')
            .select('id')
            .eq('website_id', websiteId)
            .eq('content_hash', contentHash)
            .single()
          assetId = raced?.id || null
        } else {
          throw new Error(
            `Failed to persist SiteForge asset ${photo.id}: ${error?.message || 'unknown error'}`
          )
        }
      } else {
        assetId = created.id
      }
    }

    if (!assetId) {
      throw new Error(`SiteForge asset ${photo.id} has no durable identity`)
    }
    persisted.set(photo.id, {
      assetId,
      contentHash,
      altText,
      sourceAssetId,
      rightsStatus,
      approvalStatus,
    })
  }

  const enrich = (photo: Photo): Photo => ({
    ...photo,
    ...persisted.get(photo.id),
  })

  return {
    ...manifest,
    photos: manifest.photos.map(enrich),
    byCategory: {
      hero: manifest.byCategory.hero.map(enrich),
      amenities: manifest.byCategory.amenities.map(enrich),
      lifestyle: manifest.byCategory.lifestyle.map(enrich),
      gallery: manifest.byCategory.gallery.map(enrich),
      logos: manifest.byCategory.logos.map(enrich),
    },
  }
}
