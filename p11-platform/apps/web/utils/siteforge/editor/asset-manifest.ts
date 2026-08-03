import { z } from 'zod'
import type { Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'

const approvedAssetRowSchema = z.object({
  id: z.string().uuid(),
  asset_type: z.string().min(1),
  source: z.string().min(1),
  file_url: z.string().url(),
  original_url: z.string().url().nullable().optional(),
  storage_path: z.string().min(1),
  byte_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  content_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable()
    .optional(),
  file_size_bytes: z.number().int().nonnegative().nullable().optional(),
  mime_type: z.string().nullable().optional(),
  alt_text: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
  focal_point: z.unknown().nullable().optional(),
  approval_status: z.string(),
  rights_status: z.string().nullable(),
  created_at: z.string().nullable().optional(),
})

function collectReferenceStrings(value: unknown, references: Set<string>): void {
  if (typeof value === 'string') {
    references.add(value)
    try {
      const url = new URL(value)
      references.add(`${url.origin}${url.pathname}`)
    } catch {
      // Non-URL strings can still be immutable asset IDs or storage paths.
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceStrings(item, references)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectReferenceStrings(item, references)
    }
  }
}

export function buildApprovedAssetManifest(
  rows: Json,
  referencedBy?: Json
): {
  assetManifest: Json
  assetManifestHash: string
} {
  const parsed = z.array(approvedAssetRowSchema).parse(rows)
  const references = new Set<string>()
  if (referencedBy !== undefined) {
    collectReferenceStrings(referencedBy, references)
  }
  const selected =
    referencedBy === undefined
      ? parsed
      : parsed.filter((asset) =>
          [
            asset.id,
            asset.file_url,
            asset.original_url,
            asset.storage_path,
          ].some((identity) => {
            if (!identity) return false
            if (references.has(identity)) return true
            try {
              const url = new URL(identity)
              return references.has(`${url.origin}${url.pathname}`)
            } catch {
              return false
            }
          })
        )
  const assetManifest = selected
    .map((asset) => ({
      id: asset.id,
      type: asset.asset_type,
      source: asset.source,
      fileUrl: asset.file_url,
      originalUrl: asset.original_url ?? null,
      storagePath: asset.storage_path,
      byteSha256: asset.byte_sha256 || asset.content_hash,
      bytes: asset.file_size_bytes ?? null,
      mimeType: asset.mime_type ?? null,
      altText: asset.alt_text ?? null,
      caption: asset.caption ?? null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      focalPoint: (asset.focal_point ?? null) as Json,
      approvalStatus: asset.approval_status,
      rightsStatus: asset.rights_status,
      createdAt: asset.created_at ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  for (const asset of assetManifest) {
    if (
      asset.approvalStatus !== 'approved' ||
      !['owned', 'licensed', 'generated'].includes(asset.rightsStatus || '')
    ) {
      throw new Error(
        `SiteForge asset ${asset.id} is not approved and rights-cleared`
      )
    }
    if (!asset.byteSha256) {
      throw new Error(
        `SiteForge asset ${asset.id} has no immutable byte digest`
      )
    }
  }
  return {
    assetManifest: assetManifest as unknown as Json,
    assetManifestHash: hashSiteForgeContent(assetManifest),
  }
}
