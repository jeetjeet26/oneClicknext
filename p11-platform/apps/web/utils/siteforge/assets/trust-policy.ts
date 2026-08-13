import type { Json, Tables, TablesUpdate } from '@/types/supabase'
import { assetRoles, type SiteForgeAssetRole } from './contracts'

export const SITEFORGE_PHOTO_TRUST_POLICY =
  'siteforge-solo-operator-photo-trust'
export const SITEFORGE_PHOTO_TRUST_POLICY_VERSION = '1'

type PhotoAssetIdentity = Pick<
  Tables<'content_assets'>,
  'asset_type' | 'asset_role'
>

type TrustEvent = {
  trustedAt: string
  approvedBy: string
  intake: 'direct_upload' | 'provider_import'
  importSource: 'siteforge' | 'google_drive' | 'dropbox'
  sourceIdentity: string
  contentHash: string
  sourceId?: string
  providerFileId?: string
}

function asObject(value: Json): Record<string, Json> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {}
}

function priorTrustEvents(value: Json): Json[] {
  const events = asObject(value).siteforgeTrustEvents
  return Array.isArray(events) ? events.slice(-49) : []
}

export function isSiteForgePhotoAsset(
  asset: PhotoAssetIdentity
): asset is PhotoAssetIdentity & { asset_role: SiteForgeAssetRole } {
  return (
    asset.asset_type === 'image' &&
    assetRoles.includes(asset.asset_role as SiteForgeAssetRole)
  )
}

export function buildSiteForgePhotoTrustUpdate(input: {
  userId: string
  trustedAt: string
  sourceIdentity: string
  contentHash: string
  intake: TrustEvent['intake']
  importSource: TrustEvent['importSource']
  currentCurationStatus?: string
  currentRightsMetadata?: Json
  sourceId?: string
  providerFileId?: string
}): TablesUpdate<'content_assets'> {
  const event: TrustEvent = {
    trustedAt: input.trustedAt,
    approvedBy: input.userId,
    intake: input.intake,
    importSource: input.importSource,
    sourceIdentity: input.sourceIdentity,
    contentHash: input.contentHash,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    ...(input.providerFileId ? { providerFileId: input.providerFileId } : {}),
  }
  const existingMetadata = asObject(input.currentRightsMetadata || {})
  const curationStatus = ['selected', 'in_use'].includes(
    input.currentCurationStatus || ''
  )
    ? input.currentCurationStatus
    : 'approved'

  return {
    rights_status: 'owned',
    approval_status: 'approved',
    curation_status: curationStatus,
    expires_at: null,
    approved_by: input.userId,
    approved_at: input.trustedAt,
    rejection_reason: null,
    rights_metadata: {
      ...existingMetadata,
      siteforgeTrustPolicy: {
        name: SITEFORGE_PHOTO_TRUST_POLICY,
        version: SITEFORGE_PHOTO_TRUST_POLICY_VERSION,
      },
      siteforgeTrustEvents: [
        ...priorTrustEvents(input.currentRightsMetadata || {}),
        event,
      ],
    } as Json,
  }
}
