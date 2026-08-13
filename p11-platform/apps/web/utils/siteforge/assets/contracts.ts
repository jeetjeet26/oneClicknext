import { z } from 'zod'

export const assetRoles = [
  'hero',
  'amenity',
  'gallery',
  'interior',
  'exterior',
  'lifestyle',
  'neighborhood',
  'floorplan',
] as const

export const assetRoleSchema = z.enum(assetRoles)
export type SiteForgeAssetRole = z.infer<typeof assetRoleSchema>

export const curationStatuses = [
  'raw',
  'needs_review',
  'approved',
  'selected',
  'rejected',
  'generated',
  'in_use',
] as const

export const curationStatusSchema = z.enum(curationStatuses)
export type SiteForgeCurationStatus = z.infer<typeof curationStatusSchema>

export const rightsStatusSchema = z.enum([
  'unknown',
  'owned',
  'licensed',
  'generated',
  'restricted',
])
export type SiteForgeRightsStatus = z.infer<typeof rightsStatusSchema>

export const approvalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
])
export type SiteForgeApprovalStatus = z.infer<typeof approvalStatusSchema>

export const focalPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const cropSuggestionSchema = z.object({
  aspectRatio: z.enum(['16:9', '4:3', '3:2', '1:1', '3:4', '9:16']),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
})

export const usageEntrySchema = z.object({
  websiteId: z.string().uuid().optional(),
  pagePath: z.string().trim().min(1).max(500),
  slot: z.string().trim().min(1).max(200),
  usedAt: z.iso.datetime(),
})

export const assetPatchSchema = z
  .object({
    assetId: z.string().uuid(),
    curationStatus: curationStatusSchema.optional(),
    approvalStatus: approvalStatusSchema.optional(),
    rightsStatus: rightsStatusSchema.optional(),
    rightsMetadata: z.record(z.string(), z.unknown()).optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    altText: z.string().trim().max(300).nullable().optional(),
    focalPoint: focalPointSchema.nullable().optional(),
    cropSuggestion: cropSuggestionSchema.nullable().optional(),
    qualityScore: z.number().min(0).max(1).nullable().optional(),
    heroRank: z.number().int().positive().nullable().optional(),
    assetRole: assetRoleSchema.optional(),
    rejectionReason: z.string().trim().max(1_000).nullable().optional(),
    duplicateOf: z.string().uuid().nullable().optional(),
    usageManifest: z.array(usageEntrySchema).max(500).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: 'Each asset update must include at least one change',
  })

export const batchAssetPatchSchema = z
  .object({
    propertyId: z.guid(),
    updates: z.array(assetPatchSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.updates.map((update) => update.assetId)).size ===
      value.updates.length,
    { message: 'Each asset can only be updated once per batch' }
  )

export const assetSourceProviderSchema = z.enum([
  'google_drive',
  'dropbox',
])
export type AssetSourceProvider = z.infer<typeof assetSourceProviderSchema>

export const createAssetSourceSchema = z
  .object({
    propertyId: z.guid(),
    websiteId: z.string().uuid().nullable().optional(),
    provider: assetSourceProviderSchema,
    externalFolderId: z.string().trim().min(1).max(1_000),
    externalFolderName: z.string().trim().max(300).nullable().optional(),
    credentialRef: z
      .string()
      .trim()
      .regex(
        /^(?:supabase-vault:[0-9a-f-]{36}|env:SITEFORGE_ASSET_(?:GOOGLE_DRIVE|DROPBOX)_[A-Z0-9_]+)$/i,
        'Use an approved opaque credential reference'
      ),
  })
  .strict()

export const updateAssetSourceSchema = z
  .object({
    propertyId: z.guid(),
    status: z.enum(['active', 'paused', 'revoked']).optional(),
    externalFolderName: z.string().trim().max(300).nullable().optional(),
    credentialRef: z
      .string()
      .trim()
      .regex(
        /^(?:supabase-vault:[0-9a-f-]{36}|env:SITEFORGE_ASSET_(?:GOOGLE_DRIVE|DROPBOX)_[A-Z0-9_]+)$/i,
        'Use an approved opaque credential reference'
      )
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, {
    message: 'A source change is required',
  })

export const runAssetSourceSchema = z
  .object({
    propertyId: z.guid(),
  })
  .strict()
