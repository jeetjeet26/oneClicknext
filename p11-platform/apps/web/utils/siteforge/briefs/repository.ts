import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json, Tables } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { proposeSharedAction } from '@/utils/services/shared-executor'
import {
  recordSharedApprovalDecision,
  type SharedApprovalDecisionStatus,
} from '@/utils/services/shared-approvals'
import {
  assertSiteForgeBriefApprovable,
  hashSiteForgeBrief,
  siteForgeBriefContradictionsSchema,
  siteForgeBriefSchema,
  type SiteForgeBrief,
  type SiteForgeBriefContradiction,
  type SiteForgeBriefSourceIdentity,
} from './contracts'
import {
  hashBrandForgeContract,
  normalizeBrandAssetRow,
} from '@/utils/brandforge/normalize'

type ServiceClient = SupabaseClient<Database>
type BriefRow = Tables<'siteforge_brief_versions'>

export class SiteForgeBriefError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message)
    this.name = 'SiteForgeBriefError'
  }
}

export type PersistedSiteForgeBrief = {
  id: string
  websiteId: string
  propertyId: string
  orgId: string
  version: number
  status: BriefRow['status']
  brief: SiteForgeBrief
  unresolvedContradictions: SiteForgeBriefContradiction[]
  sources: SiteForgeBriefSourceIdentity
  contentHash: string
  approvalActionAttemptId: string | null
  confirmedApprovalId: string | null
  decisionReason: string | null
  approvedAt: string | null
  createdAt: string
}

function mapBrief(row: BriefRow): PersistedSiteForgeBrief {
  if (
    !row.onboarding_snapshot_id ||
    !row.onboarding_snapshot_hash ||
    !row.brand_asset_id ||
    !row.brand_contract_hash
  ) {
    throw new SiteForgeBriefError(
      'Stored brief is missing pinned source identities',
      500
    )
  }
  return {
    id: row.id,
    websiteId: row.website_id,
    propertyId: row.property_id,
    orgId: row.org_id,
    version: row.version,
    status: row.status,
    brief: siteForgeBriefSchema.parse(row.brief),
    unresolvedContradictions: siteForgeBriefContradictionsSchema.parse(
      row.unresolved_contradictions
    ),
    sources: {
      onboardingSnapshotId: row.onboarding_snapshot_id,
      onboardingSnapshotHash: row.onboarding_snapshot_hash,
      brandAssetId: row.brand_asset_id,
      brandContractHash: row.brand_contract_hash,
    },
    contentHash: row.content_hash,
    approvalActionAttemptId: row.approval_action_attempt_id,
    confirmedApprovalId: row.confirmed_approval_id,
    decisionReason: row.decision_reason,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  }
}

async function loadWebsite(
  websiteId: string,
  client: ServiceClient
): Promise<{ id: string; org_id: string; property_id: string }> {
  const { data, error } = await client
    .from('property_websites')
    .select('id, org_id, property_id')
    .eq('id', websiteId)
    .single()
  if (error || !data) {
    throw new SiteForgeBriefError('SiteForge website not found', 404)
  }
  return data
}

export async function loadCurrentBriefSources(
  input: { orgId: string; propertyId: string },
  client: ServiceClient = createServiceClient()
): Promise<SiteForgeBriefSourceIdentity> {
  const { data: onboarding, error } = await client
    .from('property_onboarding_snapshots')
    .select(
      'id, org_id, property_id, content_hash, brand_asset_id, brand_contract_hash, unresolved_conflicts'
    )
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .eq('status', 'approved')
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !onboarding) {
    throw new SiteForgeBriefError(
      'Approve an onboarding snapshot before creating a SiteForge brief',
      409
    )
  }
  if (
    Array.isArray(onboarding.unresolved_conflicts) &&
    onboarding.unresolved_conflicts.length > 0
  ) {
    throw new SiteForgeBriefError(
      'Approved onboarding snapshot contains unresolved conflicts',
      409
    )
  }
  if (!onboarding.brand_asset_id || !onboarding.brand_contract_hash) {
    throw new SiteForgeBriefError(
      'Approved onboarding snapshot is missing a pinned BrandForge identity',
      409
    )
  }

  const { data: brand, error: brandError } = await client
    .from('property_brand_assets')
    .select('*')
    .eq('id', onboarding.brand_asset_id)
    .eq('property_id', input.propertyId)
    .single()
  if (
    brandError ||
    !brand ||
    brand.approval_status !== 'approved' ||
    !brand.contract_hash
  ) {
    throw new SiteForgeBriefError(
      'Pinned BrandForge contract is unavailable or unapproved',
      409
    )
  }
  if (brand.contract_hash !== onboarding.brand_contract_hash) {
    throw new SiteForgeBriefError(
      'BrandForge contract changed after onboarding approval; rebuild onboarding',
      409
    )
  }
  const canonicalBrandHash = hashBrandForgeContract(
    normalizeBrandAssetRow(brand as unknown as Record<string, unknown>)
  )
  if (
    canonicalBrandHash !== brand.contract_hash ||
    canonicalBrandHash !== onboarding.brand_contract_hash
  ) {
    throw new SiteForgeBriefError(
      'BrandForge contract content no longer matches its approved hash; rebuild onboarding',
      409
    )
  }

  return {
    onboardingSnapshotId: onboarding.id,
    onboardingSnapshotHash: onboarding.content_hash,
    brandAssetId: brand.id,
    brandContractHash: canonicalBrandHash,
  }
}

export async function listSiteForgeBriefVersions(
  input: { websiteId?: string; propertyId?: string },
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeBrief[]> {
  if (!input.websiteId && !input.propertyId) {
    throw new SiteForgeBriefError('websiteId or propertyId is required', 400)
  }
  let query = client
    .from('siteforge_brief_versions')
    .select('*')
    .order('created_at', { ascending: false })
  query = input.websiteId
    ? query.eq('website_id', input.websiteId)
    : query.eq('property_id', input.propertyId!)
  const { data, error } = await query.limit(100)
  if (error) {
    throw new SiteForgeBriefError('Failed to load SiteForge briefs', 500)
  }
  return (data || []).map(mapBrief)
}

export async function getSiteForgeBrief(
  briefVersionId: string,
  propertyId: string,
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeBrief> {
  const { data, error } = await client
    .from('siteforge_brief_versions')
    .select('*')
    .eq('id', briefVersionId)
    .eq('property_id', propertyId)
    .single()
  if (error || !data) {
    throw new SiteForgeBriefError('SiteForge brief version not found', 404)
  }
  return mapBrief(data)
}

export async function createSiteForgeBriefVersion(
  input: {
    websiteId: string
    userId: string
    brief: unknown
    unresolvedContradictions?: unknown
    expectedVersion?: number | null
    status?: 'draft' | 'ready_for_review'
  },
  client: ServiceClient = createServiceClient()
): Promise<PersistedSiteForgeBrief> {
  const brief = siteForgeBriefSchema.parse(input.brief)
  const unresolvedContradictions =
    siteForgeBriefContradictionsSchema.parse(
      input.unresolvedContradictions || []
    )
  const website = await loadWebsite(input.websiteId, client)
  const sources = await loadCurrentBriefSources(
    { orgId: website.org_id, propertyId: website.property_id },
    client
  )
  const contentHash = hashSiteForgeBrief({
    brief,
    unresolvedContradictions,
    sources,
  })

  const { data: duplicate } = await client
    .from('siteforge_brief_versions')
    .select('*')
    .eq('website_id', website.id)
    .eq('content_hash', contentHash)
    .maybeSingle()
  if (duplicate) {
    if (
      ['draft', 'ready_for_review', 'approved', 'modified'].includes(
        duplicate.status
      )
    ) {
      return mapBrief(duplicate)
    }
    throw new SiteForgeBriefError(
      `Identical content already exists in brief version ${duplicate.version}; resume that immutable version instead`,
      409
    )
  }

  const { data: latest, error: latestError } = await client
    .from('siteforge_brief_versions')
    .select('id, version')
    .eq('website_id', website.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new SiteForgeBriefError('Failed to inspect brief history', 500)
  }
  if (
    input.expectedVersion !== null &&
    input.expectedVersion !== undefined &&
    (latest?.version || 0) !== input.expectedVersion
  ) {
    throw new SiteForgeBriefError(
      'Brief version changed; reload before saving',
      409
    )
  }
  const version = (latest?.version || 0) + 1

  const { error: supersedeError } = await client
    .from('siteforge_brief_versions')
    .update({ status: 'superseded' })
    .eq('website_id', website.id)
    .in('status', ['draft', 'ready_for_review', 'approved', 'modified'])
  if (supersedeError) {
    throw new SiteForgeBriefError(
      'Failed to supersede the prior brief version',
      500
    )
  }

  const { data, error } = await client
    .from('siteforge_brief_versions')
    .insert({
      org_id: website.org_id,
      property_id: website.property_id,
      website_id: website.id,
      version,
      status: input.status || 'draft',
      brief: brief as unknown as Json,
      unresolved_contradictions:
        unresolvedContradictions as unknown as Json,
      onboarding_snapshot_id: sources.onboardingSnapshotId,
      onboarding_snapshot_hash: sources.onboardingSnapshotHash,
      brand_asset_id: sources.brandAssetId,
      brand_contract_hash: sources.brandContractHash,
      content_hash: contentHash,
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeBriefError(
      error?.code === '23505'
        ? 'This brief version already exists'
        : 'Failed to persist SiteForge brief version',
      error?.code === '23505' ? 409 : 500
    )
  }
  return mapBrief(data)
}

async function ensureBriefApprovalProposal(
  current: PersistedSiteForgeBrief,
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
  const proposal = await proposeSharedAction({
    orgId: current.orgId,
    propertyId: current.propertyId,
    domain: 'siteforge.brief',
    subjectType: 'siteforge_brief_version',
    subjectId: current.id,
    dedupeKey: `siteforge-brief:${current.id}:${current.contentHash}`,
    requestedBy: userId,
    capturedBy: userId,
    payload: {
      websiteId: current.websiteId,
      briefVersionId: current.id,
      version: current.version,
      contentHash: current.contentHash,
    },
    action: {
      actionType: 'siteforge.brief:confirm',
      requestPayload: {
        briefVersionId: current.id,
        contentHash: current.contentHash,
        sources: current.sources,
      },
      executionPayload: { briefVersionId: current.id },
      policyReason:
        'Explicit review of the exact brief and pinned source identities is required.',
      confidenceScore: current.unresolvedContradictions.length ? 0 : 1,
    },
  })
  const { error } = await client
    .from('siteforge_brief_versions')
    .update({ approval_action_attempt_id: proposal.sharedActionAttemptId })
    .eq('id', current.id)
    .eq('content_hash', current.contentHash)
  if (error) {
    throw new SiteForgeBriefError(
      'Failed to link the brief approval proposal',
      500
    )
  }
  return proposal.sharedActionAttemptId
}

export async function decideSiteForgeBrief(
  input: {
    briefVersionId: string
    propertyId: string
    reviewerProfileId: string
    contentHash: string
    decisionStatus: SharedApprovalDecisionStatus
    decisionReason: string
    modifiedBrief?: unknown
    unresolvedContradictions?: unknown
  },
  client: ServiceClient = createServiceClient()
) {
  const current = await getSiteForgeBrief(
    input.briefVersionId,
    input.propertyId,
    client
  )
  const currentSources =
    input.decisionStatus === 'denied'
      ? current.sources
      : await loadCurrentBriefSources(
          { orgId: current.orgId, propertyId: current.propertyId },
          client
        )
  if (input.decisionStatus === 'approved') {
    try {
      assertSiteForgeBriefApprovable({
        status: current.status,
        unresolvedContradictions: current.unresolvedContradictions,
        expectedContentHash: input.contentHash,
        actualContentHash: current.contentHash,
        pinnedSources: current.sources,
        currentSources,
      })
    } catch (error) {
      throw new SiteForgeBriefError((error as Error).message, 409)
    }
  } else if (input.contentHash !== current.contentHash) {
    throw new SiteForgeBriefError(
      'Brief content hash changed; reload before deciding',
      409
    )
  }
  if (current.status !== 'ready_for_review') {
    throw new SiteForgeBriefError(
      'Only a brief ready for review can be decided',
      409
    )
  }

  const modifiedBrief =
    input.decisionStatus === 'modified'
      ? siteForgeBriefSchema.parse(input.modifiedBrief)
      : null
  const modifiedContradictions =
    input.decisionStatus === 'modified'
      ? siteForgeBriefContradictionsSchema.parse(
          input.unresolvedContradictions || []
        )
      : null
  if (
    modifiedBrief &&
    hashSiteForgeBrief({
      brief: modifiedBrief,
      unresolvedContradictions: modifiedContradictions!,
      sources: currentSources,
    }) === current.contentHash
  ) {
    throw new SiteForgeBriefError(
      'Modified brief must change the reviewed content',
      400
    )
  }

  const actionAttemptId = await ensureBriefApprovalProposal(
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
      modifiedPayload: modifiedBrief
        ? {
            brief: modifiedBrief,
            unresolvedContradictions: modifiedContradictions,
          }
        : null,
      decisionPayload: {
        briefVersionId: current.id,
        websiteId: current.websiteId,
        contentHash: current.contentHash,
        sources: current.sources,
      },
      policyDecision: {
        policyName: 'siteforge_brief_confirmation',
        policyVersion: 'v1',
        confidenceScore: current.unresolvedContradictions.length ? 0 : 1,
        decisionPayload: {
          unresolvedContradictions: current.unresolvedContradictions,
          currentSources,
        },
      },
    },
    client
  )

  if (modifiedBrief) {
    const replacement = await createSiteForgeBriefVersion(
      {
        websiteId: current.websiteId,
        userId: input.reviewerProfileId,
        brief: modifiedBrief,
        unresolvedContradictions: modifiedContradictions,
        expectedVersion: current.version,
        status: 'ready_for_review',
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
    .from('siteforge_brief_versions')
    .update({
      status: input.decisionStatus === 'approved' ? 'approved' : 'denied',
      confirmed_approval_id: decision.approval.id,
      decision_reason: input.decisionReason.trim(),
      approved_by:
        input.decisionStatus === 'approved'
          ? input.reviewerProfileId
          : null,
      approved_at: input.decisionStatus === 'approved' ? now : null,
    })
    .eq('id', current.id)
    .eq('content_hash', current.contentHash)
    .eq('status', 'ready_for_review')
    .select('*')
    .single()
  if (error || !data) {
    throw new SiteForgeBriefError(
      'Brief changed before the decision completed',
      409
    )
  }
  return {
    ...mapBrief(data),
    decisionStatus: input.decisionStatus,
    approvalId: decision.approval.id,
    actionAttemptId,
  }
}
