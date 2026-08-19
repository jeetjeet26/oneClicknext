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

type MediaReference = {
  path: string
  assetId: string | null
  url: string
}

function collectMediaReferences(
  value: unknown,
  path = '$',
  references: MediaReference[] = []
): MediaReference[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectMediaReferences(item, `${path}[${index}]`, references)
    )
    return references
  }
  if (!value || typeof value !== 'object') return references

  const record = value as Record<string, unknown>
  if (
    typeof record.url === 'string' &&
    (typeof record.alt === 'string' || typeof record.assetId === 'string')
  ) {
    references.push({
      path,
      assetId: typeof record.assetId === 'string' ? record.assetId : null,
      url: record.url,
    })
  }
  if (typeof record.image_url === 'string') {
    references.push({
      path: `${path}.image_url`,
      assetId:
        typeof record.image_asset_id === 'string'
          ? record.image_asset_id
          : null,
      url: record.image_url,
    })
  }
  for (const [key, assetId] of Object.entries(record)) {
    if (!key.endsWith('AssetId') || typeof assetId !== 'string') continue
    const prefix = key.slice(0, -'AssetId'.length)
    const url = record[`${prefix}Url`]
    if (typeof url === 'string') {
      references.push({ path: `${path}.${prefix}`, assetId, url })
    }
  }
  Object.entries(record).forEach(([key, item]) =>
    collectMediaReferences(item, `${path}.${key}`, references)
  )
  return references
}

export function assertApprovedAssetReferenceClosure(input: {
  approvedAssets: Json
  updatedBlueprint: Json
  originalBlueprint: Json
}): void {
  const assets = z.array(approvedAssetRowSchema).parse(input.approvedAssets)
  const originalReferenceCounts = new Map<string, number>()
  for (const reference of collectMediaReferences(input.originalBlueprint)) {
    const key = `${reference.assetId || ''}\u0000${reference.url}`
    originalReferenceCounts.set(
      key,
      (originalReferenceCounts.get(key) || 0) + 1
    )
  }

  for (const reference of collectMediaReferences(input.updatedBlueprint)) {
    const key = `${reference.assetId || ''}\u0000${reference.url}`
    const originalCount = originalReferenceCounts.get(key) || 0
    if (originalCount > 0) {
      originalReferenceCounts.set(key, originalCount - 1)
      continue
    }
    if (!reference.assetId) {
      throw new Error(
        `Changed SiteForge media reference requires an approved asset ID: ${reference.path}`
      )
    }
    const asset = assets.find(candidate => candidate.id === reference.assetId)
    // Rights/approval metadata is advisory (solo-operator doctrine); the
    // reference must still resolve to a real immutable asset so the editor
    // can never invent media URLs.
    if (
      !asset ||
      ![asset.file_url, asset.original_url].includes(reference.url) ||
      !(asset.byte_sha256 || asset.content_hash)
    ) {
      throw new Error(
        `Changed SiteForge media reference is not closed over a known immutable asset: ${reference.path}`
      )
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
    // Approval/rights are advisory metadata (solo-operator doctrine); only the
    // immutable byte identity is structurally required.
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
