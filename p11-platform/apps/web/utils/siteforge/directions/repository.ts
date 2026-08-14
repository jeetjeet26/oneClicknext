import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import { normalizeBrandAssetRow } from '@/utils/brandforge/normalize'
import { createServiceClient } from '@/utils/supabase/admin'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import {
  recordSharedApprovalDecision,
  type SharedApprovalDecisionStatus,
} from '@/utils/services/shared-approvals'
import {
  getSiteForgeBrief,
  loadCurrentBriefSources,
} from '@/utils/siteforge/briefs/repository'
import {
  assertMateriallyDistinctDirections,
  hashSiteForgeDirection,
  hashSiteForgeDirectionSet,
  siteForgeCreativeDirectionSchema,
  siteForgeDirectionPreviewSchema,
  type SiteForgeDirectionCandidate,
} from './contracts'
import { generateDeterministicCreativeDirections } from './generator'

type ServiceClient = SupabaseClient<Database>
type SetRow = Tables<'siteforge_creative_direction_sets'>
type DirectionRow = Tables<'siteforge_creative_directions'>
export const DIRECTION_SELECTION_APPROVAL_REASON =
  'siteforge.direction:selected_for_execution:v1'

export class SiteForgeDirectionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeDirectionError'
  }
}

export type PersistedSiteForgeDirectionSet = {
  id: string
  orgId: string
  propertyId: string
  websiteId: string
  briefVersionId: string
  version: number
  status: string
  selectionNotes: string | null
  selectedDirectionId: string | null
  contentHash: string
  approvalActionAttemptId: string | null
  confirmedApprovalId: string | null
  approvedAt: string | null
  createdAt: string
  directions: Array<SiteForgeDirectionCandidate & { id: string }>
}

function mapDirection(row: DirectionRow): SiteForgeDirectionCandidate & {
  id: string
} {
  return {
    id: row.id,
    ordinal: row.ordinal,
    name: row.name,
    direction: siteForgeCreativeDirectionSchema.parse(row.direction),
    previewManifest: siteForgeDirectionPreviewSchema.parse(row.preview_manifest),
    contentHash: row.content_hash,
  }
}

function mapSet(
  row: SetRow,
  directions: DirectionRow[]
): PersistedSiteForgeDirectionSet {
  return {
    id: row.id,
    orgId: row.org_id,
    propertyId: row.property_id,
    websiteId: row.website_id,
    briefVersionId: row.brief_version_id,
    version: row.version,
    status: row.status,
    selectionNotes: row.selection_notes,
    selectedDirectionId: row.selected_direction_id,
    contentHash: row.content_hash,
    approvalActionAttemptId: row.approval_action_attempt_id,
    confirmedApprovalId: row.confirmed_approval_id,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    directions: directions
      .sort((left, right) => left.ordinal - right.ordinal)
      .map(mapDirection),
  }
}

async function loadDirectionRows(
  setIds: string[],
  client: ServiceClient
): Promise<DirectionRow[]> {
  if (!setIds.length) return []
  const { data, error } = await client
    .from('siteforge_creative_directions')
    .select('*')
    .in('direction_set_id', setIds)
    .order('ordinal', { ascending: true })
  if (error) {
    throw new SiteForgeDirectionError(
      'Failed to load creative direction options',
      500
    )
  }
  return data || []
}

export async function listSiteForgeDirectionSets(
  input: { websiteId?: string; propertyId?: string },
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeDirectionSet[]> {
  if (!input.websiteId && !input.propertyId) {
    throw new SiteForgeDirectionError('websiteId or propertyId is required', 400)
  }
  let query = client
    .from('siteforge_creative_direction_sets')
    .select('*')
    .order('version', { ascending: false })
  query = input.websiteId
    ? query.eq('website_id', input.websiteId)
    : query.eq('property_id', input.propertyId!)
  const { data, error } = await query.limit(100)
  if (error) {
    throw new SiteForgeDirectionError(
      'Failed to load creative direction sets',
      500
    )
  }
  const rows = data || []
  const directions = await loadDirectionRows(
    rows.map(row => row.id),
    client
  )
  return rows.map(row =>
    mapSet(
      row,
      directions.filter(direction => direction.direction_set_id === row.id)
    )
  )
}

export async function getSiteForgeDirectionSet(
  directionSetId: string,
  propertyId: string,
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeDirectionSet> {
  const { data, error } = await client
    .from('siteforge_creative_direction_sets')
    .select('*')
    .eq('id', directionSetId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new SiteForgeDirectionError(
      'Creative direction set not found',
      404
    )
  }
  const directions = await loadDirectionRows([data.id], client)
  return mapSet(data, directions)
}

function validateCandidate(candidate: SiteForgeDirectionCandidate) {
  const direction = siteForgeCreativeDirectionSchema.parse(candidate.direction)
  const previewManifest = siteForgeDirectionPreviewSchema.parse(
    candidate.previewManifest
  )
  const canonicalHash = hashSiteForgeDirection({
    ordinal: candidate.ordinal,
    name: candidate.name,
    direction,
    previewManifest,
  })
  return {
    ordinal: candidate.ordinal,
    name: candidate.name.trim(),
    direction,
    previewManifest,
    contentHash: canonicalHash,
  }
}

export async function createSiteForgeDirectionSet(
  input: {
    briefVersionId: string
    propertyId: string
    userId: string
    expectedSetVersion?: number | null
    candidates?: SiteForgeDirectionCandidate[]
  },
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeDirectionSet> {
  const brief = await getSiteForgeBrief(
    input.briefVersionId,
    input.propertyId,
    client
  )
  if (brief.status !== 'approved') {
    throw new SiteForgeDirectionError(
      'Approve the exact brief before creating creative directions',
      409
    )
  }
  const currentSources = await loadCurrentBriefSources(
    { orgId: brief.orgId, propertyId: brief.propertyId },
    client
  )
  if (
    currentSources.onboardingSnapshotId !==
      brief.sources.onboardingSnapshotId ||
    currentSources.onboardingSnapshotHash !==
      brief.sources.onboardingSnapshotHash ||
    currentSources.brandAssetId !== brief.sources.brandAssetId ||
    currentSources.brandContractHash !== brief.sources.brandContractHash
  ) {
    throw new SiteForgeDirectionError(
      'Approved brief sources are stale; approve a current brief first',
      409
    )
  }
  const { data: brand, error: brandError } = await client
    .from('property_brand_assets')
    .select('*')
    .eq('id', brief.sources.brandAssetId)
    .eq('property_id', brief.propertyId)
    .eq('approval_status', 'approved')
    .single()
  if (brandError || !brand) {
    throw new SiteForgeDirectionError(
      'Pinned BrandForge contract is unavailable',
      409
    )
  }

  const generated =
    input.candidates ||
    generateDeterministicCreativeDirections({
      brief: brief.brief,
      brand: normalizeBrandAssetRow(brand as unknown as Record<string, unknown>),
      sources: {
        briefVersionId: brief.id,
        briefContentHash: brief.contentHash,
        ...brief.sources,
      },
    })
  const candidates = generated.map(validateCandidate)
  try {
    assertMateriallyDistinctDirections(candidates)
  } catch (error) {
    throw new SiteForgeDirectionError((error as Error).message, 400)
  }
  const contentHash = hashSiteForgeDirectionSet({
    briefVersionId: brief.id,
    briefContentHash: brief.contentHash,
    directionHashes: candidates.map(candidate => candidate.contentHash),
    selectedDirectionHash: null,
    selectionNotes: null,
  })

  const { data: duplicate } = await client
    .from('siteforge_creative_direction_sets')
    .select('*')
    .eq('website_id', brief.websiteId)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (duplicate) {
    if (
      !['draft', 'ready_for_review', 'approved', 'modified'].includes(
        duplicate.status
      )
    ) {
      throw new SiteForgeDirectionError(
        `Identical creative content already exists in set version ${duplicate.version}; resume that immutable set instead`,
        409
      )
    }
    return getSiteForgeDirectionSet(duplicate.id, brief.propertyId, client)
  }
  const { data: latest, error: latestError } = await client
    .from('siteforge_creative_direction_sets')
    .select('version')
    .eq('website_id', brief.websiteId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new SiteForgeDirectionError(
      'Failed to inspect creative direction history',
      500
    )
  }
  if (
    input.expectedSetVersion !== null &&
    input.expectedSetVersion !== undefined &&
    (latest?.version || 0) !== input.expectedSetVersion
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction version changed; reload before saving',
      409
    )
  }
  const version = (latest?.version || 0) + 1

  const { error: supersedeError } = await client
    .from('siteforge_creative_direction_sets')
    .update({ status: 'superseded' })
    .eq('website_id', brief.websiteId)
    .in('status', ['draft', 'ready_for_review', 'approved', 'modified'])
  if (supersedeError) {
    throw new SiteForgeDirectionError(
      'Failed to supersede the prior creative direction set',
      500
    )
  }
  const { data: created, error: createError } = await client
    .from('siteforge_creative_direction_sets')
    .insert({
      org_id: brief.orgId,
      property_id: brief.propertyId,
      website_id: brief.websiteId,
      brief_version_id: brief.id,
      version,
      status: 'draft',
      content_hash: contentHash,
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (createError || !created) {
    throw new SiteForgeDirectionError(
      'Failed to persist creative direction set',
      createError?.code === '23505' ? 409 : 500
    )
  }
  const { data: inserted, error: directionError } = await client
    .from('siteforge_creative_directions')
    .insert(
      candidates.map(candidate => ({
        direction_set_id: created.id,
        org_id: brief.orgId,
        property_id: brief.propertyId,
        website_id: brief.websiteId,
        ordinal: candidate.ordinal,
        name: candidate.name,
        direction: candidate.direction as unknown as Json,
        preview_manifest: candidate.previewManifest as unknown as Json,
        content_hash: candidate.contentHash,
      }))
    )
    .select('*')
  if (directionError || !inserted || inserted.length !== candidates.length) {
    await client
      .from('siteforge_creative_direction_sets')
      .delete()
      .eq('id', created.id)
    throw new SiteForgeDirectionError(
      'Failed to persist all creative direction options',
      500
    )
  }
  return mapSet(created, inserted)
}

export async function selectSiteForgeCreativeDirection(
  input: {
    directionSetId: string
    propertyId: string
    selectedDirectionId: string
    expectedContentHash: string
    selectionNotes?: string | null
  },
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeDirectionSet> {
  const current = await getSiteForgeDirectionSet(
    input.directionSetId,
    input.propertyId,
    client
  )
  if (!['draft', 'ready_for_review'].includes(current.status)) {
    throw new SiteForgeDirectionError(
      'Only an undecided creative direction set can be selected',
      409
    )
  }
  if (current.contentHash !== input.expectedContentHash) {
    throw new SiteForgeDirectionError(
      'Creative direction set changed; reload before selecting',
      409
    )
  }
  const selected = current.directions.find(
    direction => direction.id === input.selectedDirectionId
  )
  if (!selected) {
    throw new SiteForgeDirectionError(
      'Selected direction does not belong to this set',
      400
    )
  }
  const brief = await getSiteForgeBrief(
    current.briefVersionId,
    current.propertyId,
    client
  )
  const selectionNotes = input.selectionNotes?.trim() || null
  const contentHash = hashSiteForgeDirectionSet({
    briefVersionId: brief.id,
    briefContentHash: brief.contentHash,
    directionHashes: current.directions.map(direction => direction.contentHash),
    selectedDirectionHash: selected.contentHash,
    selectionNotes,
  })
  const { data, error } = await client
    .from('siteforge_creative_direction_sets')
    .update({
      selected_direction_id: selected.id,
      selection_notes: selectionNotes,
      content_hash: contentHash,
      status: 'ready_for_review',
      approval_action_attempt_id: null,
      confirmed_approval_id: null,
      approved_by: null,
      approved_at: null,
    })
    .eq('id', current.id)
    .eq('content_hash', current.contentHash)
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeDirectionError(
      'Creative direction changed before selection completed',
      409
    )
  }
  return mapSet(
    data,
    current.directions.map(direction => ({
      direction_set_id: current.id,
      org_id: current.orgId,
      property_id: current.propertyId,
      website_id: current.websiteId,
      created_at: current.createdAt,
      direction: direction.direction as unknown as Json,
      preview_manifest: direction.previewManifest as unknown as Json,
      content_hash: direction.contentHash,
      id: direction.id,
      name: direction.name,
      ordinal: direction.ordinal,
    }))
  )
}

export async function confirmSiteForgeCreativeDirectionSelection(
  input: {
    directionSetId: string
    propertyId: string
    selectedDirectionId: string
    expectedContentHash: string
    selectionNotes?: string | null
    reviewerProfileId: string
  },
  client: ServiceClient = createServiceClient()
) {
  const current = await getSiteForgeDirectionSet(
    input.directionSetId,
    input.propertyId,
    client
  )
  if (
    !['draft', 'ready_for_review'].includes(current.status) ||
    current.contentHash !== input.expectedContentHash
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction set changed; reload before selecting',
      409
    )
  }
  const selected = current.directions.find(
    direction => direction.id === input.selectedDirectionId
  )
  if (!selected) {
    throw new SiteForgeDirectionError(
      'Selected direction does not belong to this set',
      400
    )
  }
  const brief = await getSiteForgeBrief(
    current.briefVersionId,
    current.propertyId,
    client
  )
  const sources = await loadCurrentBriefSources(
    { orgId: brief.orgId, propertyId: brief.propertyId },
    client
  )
  if (
    brief.status !== 'approved' ||
    selected.direction.provenance.briefVersionId !== brief.id ||
    selected.direction.provenance.briefContentHash !== brief.contentHash ||
    selected.direction.provenance.onboardingSnapshotId !==
      sources.onboardingSnapshotId ||
    selected.direction.provenance.onboardingSnapshotHash !==
      sources.onboardingSnapshotHash ||
    selected.direction.provenance.brandAssetId !== sources.brandAssetId ||
    selected.direction.provenance.brandContractHash !== sources.brandContractHash
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction sources are stale; generate a new set',
      409
    )
  }
  const selectionNotes = input.selectionNotes?.trim() || null
  const contentHash = hashSiteForgeDirectionSet({
    briefVersionId: brief.id,
    briefContentHash: brief.contentHash,
    directionHashes: current.directions.map(direction => direction.contentHash),
    selectedDirectionHash: selected.contentHash,
    selectionNotes,
  })
  const { data, error } = await client.rpc(
    'confirm_siteforge_creative_direction',
    {
      p_direction_set_id: current.id,
      p_property_id: current.propertyId,
      p_selected_direction_id: selected.id,
      p_expected_content_hash: current.contentHash,
      p_confirmed_content_hash: contentHash,
      p_selection_notes: selectionNotes || '',
      p_actor_id: input.reviewerProfileId,
      p_reason: DIRECTION_SELECTION_APPROVAL_REASON,
    }
  )
  const row = data?.[0]
  if (error || !row) {
    throw new SiteForgeDirectionError(
      error?.message || 'Failed to confirm creative direction selection',
      error?.message?.includes('changed; reload') ? 409 : 500
    )
  }
  return mapSet(
    row,
    current.directions.map(direction => ({
      direction_set_id: current.id,
      org_id: current.orgId,
      property_id: current.propertyId,
      website_id: current.websiteId,
      created_at: current.createdAt,
      direction: direction.direction as unknown as Json,
      preview_manifest: direction.previewManifest as unknown as Json,
      content_hash: direction.contentHash,
      id: direction.id,
      name: direction.name,
      ordinal: direction.ordinal,
    }))
  )
}

async function ensureDirectionApprovalProposal(
  current: PersistedSiteForgeDirectionSet,
  userId: string,
  client: ServiceClient
): Promise<string> {
  if (current.approvalActionAttemptId) {
    const { data } = await client
      .from('shared_action_attempts')
      .select('id, proposal_decision_status')
      .eq('id', current.approvalActionAttemptId)
      .maybeSingle()
    if (data?.proposal_decision_status === 'proposed') return data.id
  }
  const selected = current.directions.find(
    direction => direction.id === current.selectedDirectionId
  )
  if (!selected) {
    throw new SiteForgeDirectionError(
      'Select a creative direction before requesting approval',
      409
    )
  }
  const proposal = await proposeSharedAction({
    orgId: current.orgId,
    propertyId: current.propertyId,
    domain: 'siteforge.direction',
    subjectType: 'siteforge_creative_direction_set',
    subjectId: current.id,
    dedupeKey: `siteforge-direction:${current.id}:${current.contentHash}`,
    requestedBy: userId,
    capturedBy: userId,
    payload: {
      websiteId: current.websiteId,
      directionSetId: current.id,
      contentHash: current.contentHash,
      selectedDirectionId: selected.id,
      selectedDirectionHash: selected.contentHash,
    },
    action: {
      actionType: 'siteforge.direction:confirm',
      requestPayload: {
        directionSetId: current.id,
        contentHash: current.contentHash,
        selectedDirectionId: selected.id,
        selectedDirectionHash: selected.contentHash,
      },
      executionPayload: { directionSetId: current.id },
      policyReason:
        'Explicit review of the exact selected creative direction is required.',
      confidenceScore: 1,
    },
  })
  const { error } = await client
    .from('siteforge_creative_direction_sets')
    .update({ approval_action_attempt_id: proposal.sharedActionAttemptId })
    .eq('id', current.id)
    .eq('content_hash', current.contentHash)
  if (error) {
    throw new SiteForgeDirectionError(
      'Failed to link creative direction approval proposal',
      500
    )
  }
  return proposal.sharedActionAttemptId
}

export async function decideSiteForgeCreativeDirection(
  input: {
    directionSetId: string
    propertyId: string
    reviewerProfileId: string
    contentHash: string
    selectedDirectionId: string
    decisionStatus: SharedApprovalDecisionStatus
    decisionReason: string
    modifiedDirection?: unknown
  },
  client: ServiceClient = createServiceClient()
) {
  const current = await getSiteForgeDirectionSet(
    input.directionSetId,
    input.propertyId,
    client
  )
  if (
    current.status !== 'ready_for_review' ||
    current.contentHash !== input.contentHash ||
    current.selectedDirectionId !== input.selectedDirectionId
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction selection changed; reload before deciding',
      409
    )
  }
  const selected = current.directions.find(
    direction => direction.id === current.selectedDirectionId
  )
  if (!selected) {
    throw new SiteForgeDirectionError(
      'Selected creative direction is unavailable',
      409
    )
  }
  const brief = await getSiteForgeBrief(
    current.briefVersionId,
    current.propertyId,
    client
  )
  if (
    input.decisionStatus !== 'denied' &&
    brief.status !== 'approved'
  ) {
    throw new SiteForgeDirectionError(
      'Pinned brief is no longer approved',
      409
    )
  }
  const provenance = selected.direction.provenance
  if (
    provenance.briefVersionId !== brief.id ||
    provenance.briefContentHash !== brief.contentHash
  ) {
    throw new SiteForgeDirectionError(
      'Creative direction brief identity is invalid',
      409
    )
  }
  if (input.decisionStatus !== 'denied') {
    const sources = await loadCurrentBriefSources(
      { orgId: brief.orgId, propertyId: brief.propertyId },
      client
    )
    if (
      provenance.onboardingSnapshotId !== sources.onboardingSnapshotId ||
      provenance.onboardingSnapshotHash !== sources.onboardingSnapshotHash ||
      provenance.brandAssetId !== sources.brandAssetId ||
      provenance.brandContractHash !== sources.brandContractHash
    ) {
      throw new SiteForgeDirectionError(
        'Creative direction sources are stale; generate a new set',
        409
      )
    }
  }
  const canonicalSetHash = hashSiteForgeDirectionSet({
    briefVersionId: brief.id,
    briefContentHash: brief.contentHash,
    directionHashes: current.directions.map(direction => direction.contentHash),
    selectedDirectionHash: selected.contentHash,
    selectionNotes: current.selectionNotes,
  })
  if (canonicalSetHash !== current.contentHash) {
    throw new SiteForgeDirectionError(
      'Creative direction hash is invalid; reload a trusted set',
      409
    )
  }

  const modifiedDirection =
    input.decisionStatus === 'modified'
      ? siteForgeCreativeDirectionSchema.parse(input.modifiedDirection)
      : null
  const modifiedCandidate = modifiedDirection
    ? validateCandidate({
        ...selected,
        direction: modifiedDirection,
      })
    : null
  if (modifiedCandidate?.contentHash === selected.contentHash) {
    throw new SiteForgeDirectionError(
      'Modified direction must change the selected content',
      400
    )
  }

  const actionAttemptId = await ensureDirectionApprovalProposal(
    current,
    input.reviewerProfileId,
    client
  )
  const decision = await recordSharedApprovalDecision(
    {
      propertyId: current.propertyId,
      actionAttemptId,
      reviewerProfileId: input.reviewerProfileId,
      decisionStatus: input.decisionStatus,
      decisionReason: input.decisionReason,
      modifiedPayload: modifiedCandidate
        ? {
            directionSetId: current.id,
            selectedDirection: modifiedCandidate,
          }
        : null,
      decisionPayload: {
        directionSetId: current.id,
        contentHash: current.contentHash,
        selectedDirectionId: selected.id,
        selectedDirectionHash: selected.contentHash,
      },
      policyDecision: {
        policyName: 'siteforge_creative_direction_confirmation',
        policyVersion: 'v1',
        confidenceScore: 1,
        decisionPayload: {
          briefVersionId: brief.id,
          briefContentHash: brief.contentHash,
          provenance,
        },
      },
    },
    client
  )

  if (modifiedCandidate) {
    const replacement = await createSiteForgeDirectionSet(
      {
        briefVersionId: brief.id,
        propertyId: current.propertyId,
        userId: input.reviewerProfileId,
        expectedSetVersion: current.version,
        candidates: current.directions.map(direction =>
          direction.id === selected.id ? modifiedCandidate : direction
        ),
      },
      client
    )
    return {
      ...replacement,
      decisionStatus: 'modified' as const,
      approvalId: decision.approval.id,
      actionAttemptId,
    }
  }

  const now = new Date().toISOString()
  const { data, error } = await client
    .from('siteforge_creative_direction_sets')
    .update({
      status: input.decisionStatus === 'approved' ? 'approved' : 'denied',
      confirmed_approval_id: decision.approval.id,
      approved_by:
        input.decisionStatus === 'approved'
          ? input.reviewerProfileId
          : null,
      approved_at: input.decisionStatus === 'approved' ? now : null,
    })
    .eq('id', current.id)
    .eq('content_hash', current.contentHash)
    .eq('selected_direction_id', selected.id)
    .eq('status', 'ready_for_review')
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeDirectionError(
      'Creative direction changed before the decision completed',
      409
    )
  }
  return {
    ...mapSet(
      data,
      current.directions.map(direction => ({
        direction_set_id: current.id,
        org_id: current.orgId,
        property_id: current.propertyId,
        website_id: current.websiteId,
        created_at: current.createdAt,
        direction: direction.direction as unknown as Json,
        preview_manifest: direction.previewManifest as unknown as Json,
        content_hash: direction.contentHash,
        id: direction.id,
        name: direction.name,
        ordinal: direction.ordinal,
      }))
    ),
    decisionStatus: input.decisionStatus,
    approvalId: decision.approval.id,
    actionAttemptId,
  }
}
