import type { Json, Tables } from '@/types/supabase'
import type {
  SiteForgeApprovalStatus,
  SiteForgeAssetRole,
  SiteForgeCurationStatus,
  SiteForgeRightsStatus,
} from './contracts'

export const clearedRightsStatuses = new Set<SiteForgeRightsStatus>([
  'owned',
  'licensed',
  'generated',
])

export const usableCurationStatuses = new Set<SiteForgeCurationStatus>([
  'approved',
  'selected',
  'in_use',
])

export type AssetGateInput = {
  approval_status: string
  curation_status: string
  rights_status: string
  expires_at: string | null
  duplicate_of?: string | null
}

export type AssetUsability = {
  usable: boolean
  blockers: string[]
  advisories: string[]
}

// Solo-operator doctrine: rights, curation, and expiry are recorded as passive
// advisory data and never block usage. Only approval and duplicate identity gate.
export function getAssetUsability(
  asset: AssetGateInput,
  now = new Date()
): AssetUsability {
  const blockers: string[] = []
  const advisories: string[] = []
  if (asset.approval_status !== 'approved') blockers.push('approval_required')
  if (
    !usableCurationStatuses.has(
      asset.curation_status as SiteForgeCurationStatus
    )
  ) {
    advisories.push('curation_pending')
  }
  if (
    !clearedRightsStatuses.has(asset.rights_status as SiteForgeRightsStatus)
  ) {
    advisories.push('rights_unrecorded')
  }
  if (asset.expires_at && new Date(asset.expires_at) <= now) {
    advisories.push('rights_expired')
  }
  if (asset.duplicate_of) blockers.push('duplicate')
  return { usable: blockers.length === 0, blockers, advisories }
}

export function assertAssetCanBeUsed(
  asset: AssetGateInput,
  now = new Date()
): void {
  const result = getAssetUsability(asset, now)
  if (!result.usable) {
    throw new Error(
      `Asset is not usable: ${result.blockers.join(', ')}`
    )
  }
}

export type AssetPatchInput = {
  curationStatus?: SiteForgeCurationStatus
  approvalStatus?: SiteForgeApprovalStatus
  rightsStatus?: SiteForgeRightsStatus
  rightsMetadata?: Record<string, unknown>
  expiresAt?: string | null
  altText?: string | null
  focalPoint?: { x: number; y: number } | null
  cropSuggestion?: {
    aspectRatio: string
    x: number
    y: number
    width: number
    height: number
  } | null
  qualityScore?: number | null
  heroRank?: number | null
  assetRole?: SiteForgeAssetRole
  rejectionReason?: string | null
  duplicateOf?: string | null
  usageManifest?: Array<{
    websiteId?: string
    pagePath: string
    slot: string
    usedAt: string
  }>
}

export function buildValidatedAssetUpdate(input: {
  current: Pick<
    Tables<'content_assets'>,
    | 'approval_status'
    | 'curation_status'
    | 'rights_status'
    | 'expires_at'
    | 'rights_metadata'
    | 'duplicate_of'
  >
  patch: AssetPatchInput
  userId: string
  now?: Date
}): Record<string, unknown> {
  const now = input.now || new Date()
  const next = {
    approval_status:
      input.patch.approvalStatus ?? input.current.approval_status,
    curation_status:
      input.patch.curationStatus ?? input.current.curation_status,
    rights_status: input.patch.rightsStatus ?? input.current.rights_status,
    expires_at:
      input.patch.expiresAt === undefined
        ? input.current.expires_at
        : input.patch.expiresAt,
    duplicate_of:
      input.patch.duplicateOf === undefined
        ? input.current.duplicate_of
        : input.patch.duplicateOf,
  }

  // Rights and expiry are passive metadata (solo-operator doctrine); they no
  // longer gate approval or selection. Only structural integrity is enforced.
  if (
    next.curation_status === 'selected' ||
    next.curation_status === 'in_use'
  ) {
    if (next.approval_status !== 'approved') {
      throw new Error('Selected assets must be approved')
    }
  }

  if (
    next.curation_status === 'rejected' &&
    !input.patch.rejectionReason?.trim()
  ) {
    throw new Error('Rejected assets require a rejection reason')
  }
  if (next.curation_status === 'in_use' && next.duplicate_of) {
    throw new Error('Duplicate assets cannot be marked in use')
  }

  const update: Record<string, unknown> = {}
  if (input.patch.curationStatus !== undefined) {
    update.curation_status = input.patch.curationStatus
  }
  if (input.patch.approvalStatus !== undefined) {
    update.approval_status = input.patch.approvalStatus
    update.approved_by =
      input.patch.approvalStatus === 'approved' ? input.userId : null
    update.approved_at =
      input.patch.approvalStatus === 'approved' ? now.toISOString() : null
  }
  if (input.patch.rightsStatus !== undefined) {
    update.rights_status = input.patch.rightsStatus
  }
  if (input.patch.rightsMetadata !== undefined) {
    update.rights_metadata = input.patch.rightsMetadata as Json
  }
  if (input.patch.expiresAt !== undefined) {
    update.expires_at = input.patch.expiresAt
  }
  if (input.patch.altText !== undefined) update.alt_text = input.patch.altText
  if (input.patch.focalPoint !== undefined) {
    update.focal_point = input.patch.focalPoint as Json | null
  }
  if (input.patch.cropSuggestion !== undefined) {
    update.crop_suggestion = input.patch.cropSuggestion as Json | null
  }
  if (input.patch.qualityScore !== undefined) {
    update.quality_score = input.patch.qualityScore
  }
  if (input.patch.heroRank !== undefined) update.hero_rank = input.patch.heroRank
  if (input.patch.assetRole !== undefined) update.asset_role = input.patch.assetRole
  if (input.patch.rejectionReason !== undefined) {
    update.rejection_reason = input.patch.rejectionReason
  }
  if (input.patch.duplicateOf !== undefined) {
    update.duplicate_of = input.patch.duplicateOf
  }
  if (input.patch.usageManifest !== undefined) {
    update.usage_manifest = input.patch.usageManifest as Json
  }

  if (input.patch.curationStatus === 'rejected') {
    update.approval_status = 'rejected'
    update.approved_by = null
    update.approved_at = null
  }
  return update
}

const coverageRequirements: ReadonlyArray<{
  role: SiteForgeAssetRole
  label: string
  required: number
}> = [
  { role: 'hero', label: 'Hero image', required: 1 },
  { role: 'exterior', label: 'Building exteriors', required: 2 },
  { role: 'interior', label: 'Apartment interiors', required: 3 },
  { role: 'amenity', label: 'Amenities', required: 3 },
  { role: 'lifestyle', label: 'Lifestyle', required: 1 },
  { role: 'neighborhood', label: 'Neighborhood', required: 1 },
  { role: 'gallery', label: 'Gallery depth', required: 4 },
]

export function buildCoverageMatrix(
  assets: Array<
    AssetGateInput & {
      asset_role: string | null
      id?: string
    }
  >
) {
  const matrix = coverageRequirements.map((requirement) => {
    const roleAssets = assets.filter(
      (asset) => asset.asset_role === requirement.role
    )
    const usable = roleAssets.filter((asset) => getAssetUsability(asset).usable)
    const selected = usable.filter((asset) =>
      ['selected', 'in_use'].includes(asset.curation_status)
    )
    return {
      role: requirement.role,
      label: requirement.label,
      required: requirement.required,
      total: roleAssets.length,
      usable: usable.length,
      selected: selected.length,
      missing: Math.max(0, requirement.required - usable.length),
      covered: usable.length >= requirement.required,
    }
  })
  return {
    matrix,
    missingShots: matrix
      .filter((entry) => !entry.covered)
      .map((entry) => ({
        role: entry.role,
        label: entry.label,
        missing: entry.missing,
        instruction: `Add ${entry.missing} rights-cleared ${entry.label.toLowerCase()} shot${entry.missing === 1 ? '' : 's'}.`,
      })),
    ready: matrix.every((entry) => entry.covered),
  }
}
