/**
 * ForgeStudio editorial domain store.
 *
 * Canonical lifecycle:
 *   brief → package → immutable revisions → per-channel variants
 *   approved revision + connection + time → publication → attempts
 *
 * Invariants enforced here:
 * - Revisions are immutable; editing creates a new revision and supersedes
 *   prior pending/approved revisions (cancelling their scheduled publications).
 * - Only the approved, current revision of a package can be scheduled.
 * - One live publication per (revision, connection) — backed by a partial
 *   unique index in the database.
 */

import { createServiceClient } from '@/utils/supabase/admin'
import type { Json, Tables, TablesInsert } from '@/types/supabase'
import { createHash } from 'node:crypto'
import {
  findUnsupportedClaims,
  revisionContentSchema,
  validateVariant,
  type RevisionContent,
} from '@/utils/forgestudio/content-contract'

export class ContentStoreError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ContentStoreError'
    this.statusCode = statusCode
  }
}

function contentHash(content: RevisionContent): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  )
}

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export type CreateBriefInput = {
  orgId: string
  propertyId: string
  createdBy: string | null
  title: string
  objective: string
  topic?: string | null
  audience?: string | null
  sourceFacts?: unknown[]
  constraints?: Record<string, unknown>
  channels?: string[]
  connectionIds?: string[]
  assetIds?: string[]
  formatPlan?: unknown[]
  schedulingWindow?: Record<string, unknown>
}

export async function createBrief(input: CreateBriefInput): Promise<Tables<'social_content_briefs'>> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('social_content_briefs')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      created_by: input.createdBy,
      title: input.title,
      objective: input.objective,
      topic: input.topic ?? null,
      audience: input.audience ?? null,
      source_facts: (input.sourceFacts ?? []) as Json,
      constraints: (input.constraints ?? {}) as Json,
      channels: input.channels ?? [],
      connection_ids: input.connectionIds ?? [],
      asset_ids: input.assetIds ?? [],
      format_plan: (input.formatPlan ?? []) as Json,
      scheduling_window: (input.schedulingWindow ?? {}) as Json,
      status: 'draft',
    })
    .select('*')
    .single()

  if (error || !data) {
    throw new ContentStoreError(`Failed to create brief: ${error?.message || 'unknown error'}`, 500)
  }
  return data
}

export async function setBriefStatus(
  briefId: string,
  status: 'draft' | 'generating' | 'generated' | 'archived'
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('social_content_briefs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', briefId)
  if (error) {
    throw new ContentStoreError(`Failed to update brief status: ${error.message}`, 500)
  }
}

// ---------------------------------------------------------------------------
// Packages + revisions + variants
// ---------------------------------------------------------------------------

type RevisionAuthor =
  | { kind: 'llm' }
  | { kind: 'user'; userId: string }

export type CreateRevisionInput = {
  content: RevisionContent
  author: RevisionAuthor
  contextSnapshotId?: string | null
  generationMetadata?: Record<string, unknown>
}

export type CreatePackageInput = CreateRevisionInput & {
  orgId: string
  propertyId: string
  briefId?: string | null
  createdBy?: string | null
}

async function insertRevisionWithVariants(input: {
  packageId: string
  orgId: string
  propertyId: string
  revisionNumber: number
  revision: CreateRevisionInput
}): Promise<Tables<'social_content_revisions'>> {
  const supabase = createServiceClient()
  const content = revisionContentSchema.parse(input.revision.content)
  const validation: Record<string, unknown> = {}

  const { data: revisionRow, error: revisionError } = await supabase
    .from('social_content_revisions')
    .insert({
      package_id: input.packageId,
      org_id: input.orgId,
      property_id: input.propertyId,
      revision_number: input.revisionNumber,
      authored_by_kind: input.revision.author.kind,
      authored_by: input.revision.author.kind === 'user' ? input.revision.author.userId : null,
      content: content as unknown as Json,
      content_hash: contentHash(content),
      context_snapshot_id: input.revision.contextSnapshotId ?? null,
      generation_metadata: (input.revision.generationMetadata ?? {}) as Json,
      claims: content.claims as unknown as Json,
      approval_status: 'pending',
    })
    .select('*')
    .single()

  if (revisionError || !revisionRow) {
    throw new ContentStoreError(
      `Failed to create revision: ${revisionError?.message || 'unknown error'}`,
      500
    )
  }

  const variantRows: TablesInsert<'social_content_variants'>[] = content.variants.map((variant) => {
    const issues = validateVariant(variant)
    const variantKey = variant.variantKey === 'primary'
      ? `${variant.platform}:${variant.contentFormat}:${variant.sequenceIndex + 1}`
      : variant.variantKey
    validation[variantKey] = { issues }
    return {
      revision_id: revisionRow.id,
      org_id: input.orgId,
      property_id: input.propertyId,
      variant_key: variantKey,
      sequence_index: variant.sequenceIndex,
      platform: variant.platform,
      caption: variant.caption,
      hashtags: variant.hashtags,
      call_to_action: variant.callToAction ?? null,
      link_url: variant.linkUrl ?? null,
      asset_ids: variant.assetIds,
      media_urls: variant.mediaUrls,
      alt_text: variant.altText ?? null,
      content_format: variant.contentFormat,
      platform_options: (variant.platformOptions ?? {}) as Json,
      storyboard: variant.storyboard as unknown as Json,
      overlay_text: variant.overlayText,
      safe_area: variant.safeArea as unknown as Json,
      subtitle_text: variant.subtitleText ?? null,
      thumbnail_asset_id: variant.thumbnailAssetId ?? null,
      validation: { issues: issues } as unknown as Json,
    }
  })

  const { error: variantError } = await supabase
    .from('social_content_variants')
    .insert(variantRows)

  if (variantError) {
    throw new ContentStoreError(`Failed to create variants: ${variantError.message}`, 500)
  }

  return revisionRow
}

export async function createPackageWithRevision(
  input: CreatePackageInput
): Promise<{ pkg: Tables<'social_content_packages'>; revision: Tables<'social_content_revisions'> }> {
  const supabase = createServiceClient()
  const content = revisionContentSchema.parse(input.content)

  const { data: pkg, error: pkgError } = await supabase
    .from('social_content_packages')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      brief_id: input.briefId ?? null,
      concept_summary: content.conceptSummary,
      status: 'in_review',
      created_by: input.createdBy ?? null,
    })
    .select('*')
    .single()

  if (pkgError || !pkg) {
    throw new ContentStoreError(`Failed to create package: ${pkgError?.message || 'unknown error'}`, 500)
  }

  const revision = await insertRevisionWithVariants({
    packageId: pkg.id,
    orgId: input.orgId,
    propertyId: input.propertyId,
    revisionNumber: 1,
    revision: input,
  })

  await supabase
    .from('social_content_packages')
    .update({ current_revision_id: revision.id, updated_at: new Date().toISOString() })
    .eq('id', pkg.id)

  return { pkg: { ...pkg, current_revision_id: revision.id }, revision }
}

/**
 * Create a new revision for a package. Supersedes all pending/approved prior
 * revisions and cancels their not-yet-published publications, so an edited
 * post can never ship under a stale approval.
 */
export async function addRevision(
  packageId: string,
  input: CreateRevisionInput
): Promise<Tables<'social_content_revisions'>> {
  const supabase = createServiceClient()

  const { data: pkg, error: pkgError } = await supabase
    .from('social_content_packages')
    .select('id, org_id, property_id')
    .eq('id', packageId)
    .single()

  if (pkgError || !pkg) {
    throw new ContentStoreError('Package not found', 404)
  }

  const { data: latest, error: latestError } = await supabase
    .from('social_content_revisions')
    .select('revision_number')
    .eq('package_id', packageId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestError) {
    throw new ContentStoreError(`Failed to load revisions: ${latestError.message}`, 500)
  }

  const nextNumber = (latest?.revision_number ?? 0) + 1

  // Supersede prior editable revisions before creating the new one.
  const { data: supersededRevisions, error: supersedeError } = await supabase
    .from('social_content_revisions')
    .update({ approval_status: 'superseded' })
    .eq('package_id', packageId)
    .in('approval_status', ['pending', 'approved'])
    .select('id')

  if (supersedeError) {
    throw new ContentStoreError(`Failed to supersede prior revisions: ${supersedeError.message}`, 500)
  }

  const supersededIds = (supersededRevisions || []).map((row) => row.id)
  if (supersededIds.length > 0) {
    const cancelledAt = new Date().toISOString()
    const { data: cancelledPublications, error: cancelError } = await supabase
      .from('social_publications')
      .update({
        status: 'cancelled',
        cancelled_at: cancelledAt,
        last_error: 'Revision superseded by an edit',
        updated_at: cancelledAt,
      })
      .in('revision_id', supersededIds)
      .in('status', ['scheduled', 'queued'])
      .select('id, shared_job_id')

    if (cancelError) {
      throw new ContentStoreError(
        `Failed to cancel publications for superseded revisions: ${cancelError.message}`,
        500
      )
    }

    const jobIds = (cancelledPublications || [])
      .map((row) => row.shared_job_id)
      .filter((id): id is string => Boolean(id))
    if (jobIds.length > 0) {
      await supabase
        .from('shared_jobs')
        .update({
          lifecycle_status: 'cancelled',
          status_reason: 'revision_superseded',
          finished_at: cancelledAt,
          updated_at: cancelledAt,
        })
        .in('id', jobIds)
        .in('lifecycle_status', ['queued', 'retrying'])
    }
  }

  const revision = await insertRevisionWithVariants({
    packageId,
    orgId: pkg.org_id,
    propertyId: pkg.property_id,
    revisionNumber: nextNumber,
    revision: input,
  })

  await supabase
    .from('social_content_packages')
    .update({
      current_revision_id: revision.id,
      concept_summary: input.content.conceptSummary,
      status: 'in_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', packageId)

  return revision
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

async function recordRevisionDecisionGovernance(input: {
  revision: {
    id: string
    org_id: string
    property_id: string
    context_snapshot_id: string | null
  }
  reviewerId: string
  decision: 'approved' | 'denied' | 'modified'
  note?: string | null
  validationIssueCount: number
}): Promise<string> {
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const { data: job, error: jobError } = await supabase
    .from('shared_jobs')
    .insert({
      org_id: input.revision.org_id,
      property_id: input.revision.property_id,
      domain: 'forgestudio.revision-approval',
      subject_type: 'social_content_revision',
      subject_id: input.revision.id,
      lifecycle_status: input.decision === 'denied' ? 'cancelled' : 'succeeded',
      status_reason: `revision_${input.decision}`,
      dedupe_key: `revision-decision:${input.revision.id}`,
      payload: {
        revisionId: input.revision.id,
        decision: input.decision,
      } as Json,
      context_snapshot_id: input.revision.context_snapshot_id,
      attempt_count: 1,
      max_attempts: 1,
      started_at: now,
      finished_at: now,
      stage: 'completed',
      progress: 100,
      current_step: `Revision ${input.decision}`,
    })
    .select('id')
    .single()
  if (jobError || !job) {
    throw new ContentStoreError(`Failed to record approval job: ${jobError?.message || 'unknown error'}`, 500)
  }

  const { data: action, error: actionError } = await supabase
    .from('shared_action_attempts')
    .insert({
      job_id: job.id,
      org_id: input.revision.org_id,
      property_id: input.revision.property_id,
      action_type: 'review_social_content_revision',
      lifecycle_status: input.decision === 'denied' ? 'cancelled' : 'succeeded',
      proposal_decision_status: input.decision,
      execution_status: input.decision === 'denied' ? 'cancelled' : 'executed',
      requested_by: input.reviewerId,
      reviewed_by: input.reviewerId,
      request_payload: { revisionId: input.revision.id } as Json,
      execution_payload: { decision: input.decision, note: input.note ?? null } as Json,
      execution_result: { validationIssueCount: input.validationIssueCount } as Json,
      policy_snapshot: {
        policy: 'forgestudio.content-safety',
        version: '2026-08-13',
        deterministicValidationPassed: input.validationIssueCount === 0,
      } as Json,
      confidence_score: input.validationIssueCount === 0 ? 1 : 0,
      policy_reason: input.note ?? `Exact revision ${input.decision}`,
      proposed_at: now,
      decided_at: now,
      executed_at: now,
    })
    .select('id')
    .single()
  if (actionError || !action) {
    await supabase.from('shared_jobs').update({
      lifecycle_status: 'failed',
      status_reason: 'action_ledger_failed',
      error_message: actionError?.message ?? 'unknown error',
    }).eq('id', job.id)
    throw new ContentStoreError('Failed to record approval action ledger', 500)
  }

  const decisionReason = input.note?.trim() || `Exact revision ${input.decision}`
  const [approvalResult, policyResult] = await Promise.all([
    supabase.from('shared_approvals').insert({
      action_attempt_id: action.id,
      org_id: input.revision.org_id,
      property_id: input.revision.property_id,
      decision_status: input.decision,
      decision_reason: decisionReason,
      reviewer_profile_id: input.reviewerId,
      decision_payload: { revisionId: input.revision.id } as Json,
    }),
    supabase.from('shared_policy_decisions').insert({
      org_id: input.revision.org_id,
      property_id: input.revision.property_id,
      job_id: job.id,
      action_attempt_id: action.id,
      policy_name: 'forgestudio.content-safety',
      policy_version: '2026-08-13',
      decision_status: input.decision,
      decision_reason: decisionReason,
      confidence_score: input.validationIssueCount === 0 ? 1 : 0,
      decision_payload: {
        deterministicValidationPassed: input.validationIssueCount === 0,
        validationIssueCount: input.validationIssueCount,
      } as Json,
    }),
  ])
  if (approvalResult.error || policyResult.error) {
    throw new ContentStoreError('Failed to record shared approval or policy decision', 500)
  }
  return action.id
}

export async function recordRevisionModificationGovernance(input: {
  revisionId: string
  reviewerId: string
  reason: string
}): Promise<void> {
  const supabase = createServiceClient()
  const { data: revision, error } = await supabase
    .from('social_content_revisions')
    .select('id, org_id, property_id, context_snapshot_id')
    .eq('id', input.revisionId)
    .single()
  if (error || !revision) {
    throw new ContentStoreError('Edited revision not found for governance', 404)
  }
  const actionId = await recordRevisionDecisionGovernance({
    revision,
    reviewerId: input.reviewerId,
    decision: 'modified',
    note: input.reason,
    validationIssueCount: 0,
  })
  const { error: linkError } = await supabase
    .from('social_content_revisions')
    .update({ shared_action_attempt_id: actionId })
    .eq('id', input.revisionId)
  if (linkError) {
    throw new ContentStoreError('Failed to link edited revision to governance history', 500)
  }
}

export async function setRevisionApproval(input: {
  revisionId: string
  decision: 'approved' | 'denied'
  reviewerId: string
  note?: string | null
}): Promise<Tables<'social_content_revisions'>> {
  const supabase = createServiceClient()

  const { data: revision, error: revisionError } = await supabase
    .from('social_content_revisions')
    .select('id, package_id, org_id, property_id, context_snapshot_id, approval_status, claims')
    .eq('id', input.revisionId)
    .single()

  if (revisionError || !revision) {
    throw new ContentStoreError('Revision not found', 404)
  }

  if (revision.approval_status !== 'pending') {
    throw new ContentStoreError(
      `Only pending revisions can be reviewed (current status: ${revision.approval_status})`,
      409
    )
  }

  let validationIssueCount = 0
  if (input.decision === 'approved') {
    const claims = revisionContentSchema.shape.claims.parse(revision.claims ?? [])
    const unsupported = findUnsupportedClaims(claims)
    if (unsupported.length > 0) {
      throw new ContentStoreError(
        `Cannot approve: ${unsupported.length} sensitive claim(s) lack citations (${unsupported
          .map((claim) => claim.type)
          .join(', ')})`,
        409
      )
    }

    const { data: variants, error: variantsError } = await supabase
      .from('social_content_variants')
      .select('variant_key, sequence_index, platform, caption, hashtags, call_to_action, link_url, asset_ids, media_urls, alt_text, content_format, platform_options, storyboard, overlay_text, safe_area, subtitle_text, thumbnail_asset_id')
      .eq('revision_id', input.revisionId)
    if (variantsError || !variants?.length) {
      throw new ContentStoreError('Cannot approve: revision variants are unavailable', 409)
    }
    const issues = variants.flatMap((variant) => validateVariant({
      variantKey: variant.variant_key,
      sequenceIndex: variant.sequence_index,
      platform: variant.platform as RevisionContent['variants'][number]['platform'],
      caption: variant.caption,
      hashtags: variant.hashtags ?? [],
      callToAction: variant.call_to_action,
      linkUrl: variant.link_url,
      assetIds: variant.asset_ids ?? [],
      mediaUrls: variant.media_urls ?? [],
      altText: variant.alt_text,
      contentFormat: variant.content_format as RevisionContent['variants'][number]['contentFormat'],
      platformOptions: (variant.platform_options ?? {}) as Record<string, unknown>,
      storyboard: (variant.storyboard ?? []) as RevisionContent['variants'][number]['storyboard'],
      overlayText: variant.overlay_text ?? [],
      safeArea: (variant.safe_area ?? {}) as RevisionContent['variants'][number]['safeArea'],
      subtitleText: variant.subtitle_text,
      thumbnailAssetId: variant.thumbnail_asset_id,
    }))
    validationIssueCount = issues.length
    if (issues.length > 0) {
      throw new ContentStoreError(
        `Cannot approve: ${issues.map((issue) => issue.code).join(', ')}`,
        409
      )
    }
  }

  const nowIso = new Date().toISOString()
  const { data: updated, error: updateError } = await supabase
    .from('social_content_revisions')
    .update({
      approval_status: input.decision,
      approved_by: input.reviewerId,
      approved_at: nowIso,
      approval_note: input.note ?? null,
    })
    .eq('id', input.revisionId)
    .eq('approval_status', 'pending')
    .select('*')
    .single()

  if (updateError || !updated) {
    throw new ContentStoreError('Revision review failed (it may have been reviewed concurrently)', 409)
  }

  let sharedActionAttemptId: string
  try {
    sharedActionAttemptId = await recordRevisionDecisionGovernance({
      revision,
      reviewerId: input.reviewerId,
      decision: input.decision,
      note: input.note,
      validationIssueCount,
    })
  } catch (error) {
    await supabase
      .from('social_content_revisions')
      .update({
        approval_status: 'pending',
        approved_by: null,
        approved_at: null,
        approval_note: null,
      })
      .eq('id', input.revisionId)
      .eq('approval_status', input.decision)
    throw error
  }

  const { data: governed, error: governanceLinkError } = await supabase
    .from('social_content_revisions')
    .update({ shared_action_attempt_id: sharedActionAttemptId })
    .eq('id', input.revisionId)
    .select('*')
    .single()
  if (governanceLinkError || !governed) {
    throw new ContentStoreError('Revision decision was recorded but governance linkage failed', 500)
  }

  await supabase
    .from('social_content_packages')
    .update({
      status: input.decision === 'approved' ? 'approved' : 'in_review',
      updated_at: nowIso,
    })
    .eq('id', revision.package_id)

  return governed
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export const PUBLICATION_JOB_DOMAIN = 'forgestudio.publication'

async function createPublicationGovernance(input: {
  jobId: string
  orgId: string
  propertyId: string
  revisionId: string
  connectionId: string
  scheduledFor: string
  requestedBy: string | null
  approvedBy: string | null
  approvalNote: string | null
  contextSnapshotId: string | null
  experimentKey?: string
  experimentGroup?: 'control' | 'treatment'
}): Promise<string> {
  const supabase = createServiceClient()
  const now = new Date().toISOString()
  const reviewerId = input.approvedBy ?? input.requestedBy
  if (!reviewerId) {
    throw new ContentStoreError('Publication governance requires a reviewer identity', 409)
  }
  const { data: action, error: actionError } = await supabase
    .from('shared_action_attempts')
    .insert({
      job_id: input.jobId,
      org_id: input.orgId,
      property_id: input.propertyId,
      action_type: 'publish_social_content_revision',
      lifecycle_status: 'queued',
      proposal_decision_status: 'approved',
      execution_status: 'approved_pending_execution',
      requested_by: input.requestedBy,
      reviewed_by: input.approvedBy,
      request_payload: {
        revisionId: input.revisionId,
        connectionId: input.connectionId,
        scheduledFor: input.scheduledFor,
        experimentKey: input.experimentKey ?? null,
        experimentGroup: input.experimentGroup ?? null,
      } as Json,
      execution_payload: {
        revisionId: input.revisionId,
        connectionId: input.connectionId,
        scheduledFor: input.scheduledFor,
        experimentKey: input.experimentKey ?? null,
        experimentGroup: input.experimentGroup ?? null,
      } as Json,
      policy_snapshot: {
        policy: 'forgestudio.social-publishing',
        version: '2026-08-13',
        exactRevisionApproved: true,
        contextSnapshotId: input.contextSnapshotId,
        experimentKey: input.experimentKey ?? null,
        experimentGroup: input.experimentGroup ?? null,
        rollback: 'cancel_before_remote_publish',
      } as Json,
      rollback_metadata: {
        supportedBeforeRemotePublish: true,
        operation: 'cancel_publication',
      } as Json,
      confidence_score: 1,
      policy_reason: input.approvalNote ?? 'Exact revision approved for scheduled publication',
      proposed_at: now,
      decided_at: now,
    })
    .select('id')
    .single()
  if (actionError || !action) {
    throw new ContentStoreError('Failed to create publication action ledger', 500)
  }

  const reason = input.approvalNote?.trim() || 'Exact revision approved for scheduled publication'
  const [approvalResult, policyResult] = await Promise.all([
    supabase.from('shared_approvals').insert({
      action_attempt_id: action.id,
      org_id: input.orgId,
      property_id: input.propertyId,
      decision_status: 'approved',
      decision_reason: reason,
      reviewer_profile_id: reviewerId,
      decision_payload: {
        revisionId: input.revisionId,
        connectionId: input.connectionId,
      } as Json,
    }),
    supabase.from('shared_policy_decisions').insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      job_id: input.jobId,
      action_attempt_id: action.id,
      policy_name: 'forgestudio.social-publishing',
      policy_version: '2026-08-13',
      decision_status: 'approved',
      decision_reason: reason,
      confidence_score: 1,
      decision_payload: {
        exactRevisionApproved: true,
        scheduledFor: input.scheduledFor,
        experimentKey: input.experimentKey ?? null,
        experimentGroup: input.experimentGroup ?? null,
      } as Json,
    }),
  ])
  if (approvalResult.error || policyResult.error) {
    throw new ContentStoreError('Failed to bind publication approval and policy records', 500)
  }
  return action.id
}

export type ScheduleDestination = {
  connectionId: string
  variantId?: string
  scheduledFor: string
  timezone?: string
  experimentKey?: string
  experimentGroup?: 'control' | 'treatment'
}

export async function schedulePublications(input: {
  revisionId: string
  destinations: ScheduleDestination[]
  createdBy: string | null
  maxAttempts?: number
}): Promise<Tables<'social_publications'>[]> {
  const supabase = createServiceClient()

  const { data: revision, error: revisionError } = await supabase
    .from('social_content_revisions')
    .select('id, package_id, org_id, property_id, approval_status, approved_by, approval_note, context_snapshot_id')
    .eq('id', input.revisionId)
    .single()

  if (revisionError || !revision) {
    throw new ContentStoreError('Revision not found', 404)
  }

  if (revision.approval_status !== 'approved') {
    throw new ContentStoreError('Only approved revisions can be scheduled', 409)
  }

  const { data: pkg } = await supabase
    .from('social_content_packages')
    .select('current_revision_id')
    .eq('id', revision.package_id)
    .single()

  if (pkg?.current_revision_id !== revision.id) {
    throw new ContentStoreError('Only the current revision of a package can be scheduled', 409)
  }

  const { data: variants, error: variantsError } = await supabase
    .from('social_content_variants')
    .select('id, platform, variant_key, sequence_index')
    .eq('revision_id', revision.id)
    .order('sequence_index', { ascending: true })

  if (variantsError || !variants?.length) {
    throw new ContentStoreError('Revision has no channel variants', 409)
  }

  const connectionIds = [...new Set(input.destinations.map((d) => d.connectionId))]
  const { data: connections, error: connectionsError } = await supabase
    .from('social_connections')
    .select('id, platform, is_active, property_id')
    .in('id', connectionIds)
    .eq('property_id', revision.property_id)
    .eq('is_active', true)

  if (connectionsError || (connections || []).length !== connectionIds.length) {
    throw new ContentStoreError(
      'Some destinations are invalid, inactive, or belong to another property',
      400
    )
  }

  const connectionById = new Map((connections || []).map((conn) => [conn.id, conn]))
  const variantsByPlatform = new Map<string, typeof variants>()
  for (const variant of variants) {
    variantsByPlatform.set(
      variant.platform,
      [...(variantsByPlatform.get(variant.platform) ?? []), variant]
    )
  }
  const created: Tables<'social_publications'>[] = []

  for (const destination of input.destinations) {
    const connection = connectionById.get(destination.connectionId)
    if (!connection) continue

    // 'twitter' connections publish the 'x' variant.
    const platformKey = connection.platform === 'twitter' ? 'x' : connection.platform
    const platformVariants = variantsByPlatform.get(platformKey) ?? []
    const variant = destination.variantId
      ? platformVariants.find((candidate) => candidate.id === destination.variantId)
      : platformVariants[0]
    if (!variant) {
      throw new ContentStoreError(
        `Revision has no matching variant for platform ${platformKey} (connection ${connection.id})`,
        409
      )
    }

    const scheduledForMs = Date.parse(destination.scheduledFor)
    if (Number.isNaN(scheduledForMs)) {
      throw new ContentStoreError(`Invalid scheduled time: ${destination.scheduledFor}`, 400)
    }

    const scheduledForIso = new Date(scheduledForMs).toISOString()

    // Durable queue entry first; the worker claims it via claim_shared_jobs.
    const { data: job, error: jobError } = await supabase
      .from('shared_jobs')
      .insert({
        org_id: revision.org_id,
        property_id: revision.property_id,
        domain: PUBLICATION_JOB_DOMAIN,
        subject_type: 'social_publication',
        subject_id: null,
        lifecycle_status: 'queued',
        status_reason: 'scheduled',
        dedupe_key: `publication:${revision.id}:${variant.id}:${connection.id}`,
        payload: {
          revisionId: revision.id,
          variantId: variant.id,
          connectionId: connection.id,
          scheduledFor: scheduledForIso,
        } as Json,
        attempt_count: 0,
        max_attempts: input.maxAttempts ?? 3,
        available_at: scheduledForIso,
      })
      .select('id')
      .single()

    if (jobError || !job?.id) {
      if (isUniqueViolation(jobError)) {
        throw new ContentStoreError(
          `This format variant is already scheduled for connection ${connection.id}`,
          409
        )
      }
      throw new ContentStoreError(
        `Failed to enqueue publication job: ${jobError?.message || 'unknown error'}`,
        500
      )
    }

    let sharedActionAttemptId: string
    try {
      sharedActionAttemptId = await createPublicationGovernance({
        jobId: job.id,
        orgId: revision.org_id,
        propertyId: revision.property_id,
        revisionId: revision.id,
        connectionId: connection.id,
        scheduledFor: scheduledForIso,
        requestedBy: input.createdBy,
        approvedBy: revision.approved_by,
        approvalNote: revision.approval_note,
        contextSnapshotId: revision.context_snapshot_id,
        experimentKey: destination.experimentKey,
        experimentGroup: destination.experimentGroup,
      })
    } catch (error) {
      await supabase
        .from('shared_jobs')
        .update({
          lifecycle_status: 'cancelled',
          status_reason: 'publication_governance_failed',
          error_message: error instanceof Error ? error.message : String(error),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      throw error
    }

    const { data: publication, error: publicationError } = await supabase
      .from('social_publications')
      .insert({
        org_id: revision.org_id,
        property_id: revision.property_id,
        package_id: revision.package_id,
        revision_id: revision.id,
        variant_id: variant.id,
        connection_id: connection.id,
        platform: platformKey,
        scheduled_for: scheduledForIso,
        timezone: destination.timezone ?? 'UTC',
        experiment_key: destination.experimentKey ?? null,
        experiment_group: destination.experimentGroup ?? null,
        status: 'scheduled',
        max_attempts: input.maxAttempts ?? 3,
        shared_job_id: job.id,
        shared_action_attempt_id: sharedActionAttemptId,
        created_by: input.createdBy,
      })
      .select('*')
      .single()

    if (publicationError || !publication) {
      // Roll the queue entry back so a retry can succeed cleanly.
      await supabase
        .from('shared_jobs')
        .update({
          lifecycle_status: 'cancelled',
          status_reason: 'publication_insert_failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)

      if (isUniqueViolation(publicationError)) {
        throw new ContentStoreError(
          `This revision is already scheduled for connection ${connection.id}`,
          409
        )
      }
      throw new ContentStoreError(
        `Failed to create publication: ${publicationError?.message || 'unknown error'}`,
        500
      )
    }

    // Link the job back to the publication for observability.
    await supabase
      .from('shared_jobs')
      .update({ subject_id: publication.id, updated_at: new Date().toISOString() })
      .eq('id', job.id)

    created.push(publication)
  }

  const nowIso = new Date().toISOString()
  await supabase
    .from('social_content_packages')
    .update({ status: 'scheduled', updated_at: nowIso })
    .eq('id', revision.package_id)

  return created
}

export async function cancelPublication(publicationId: string): Promise<Tables<'social_publications'>> {
  const supabase = createServiceClient()
  const nowIso = new Date().toISOString()

  const { data: publication, error } = await supabase
    .from('social_publications')
    .update({
      status: 'cancelled',
      cancelled_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', publicationId)
    .in('status', ['scheduled', 'queued'])
    .select('*')
    .single()

  if (error || !publication) {
    throw new ContentStoreError(
      'Publication cannot be cancelled (not found or already publishing/published)',
      409
    )
  }

  if (publication.shared_job_id) {
    await supabase
      .from('shared_jobs')
      .update({
        lifecycle_status: 'cancelled',
        status_reason: 'publication_cancelled',
        finished_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', publication.shared_job_id)
      .in('lifecycle_status', ['queued', 'retrying'])
  }
  if (publication.shared_action_attempt_id) {
    await supabase
      .from('shared_action_attempts')
      .update({
        lifecycle_status: 'cancelled',
        execution_status: 'cancelled',
        error_message: 'Publication cancelled before remote execution',
        updated_at: nowIso,
      })
      .eq('id', publication.shared_action_attempt_id)
  }

  return publication
}

export async function reschedulePublication(
  publicationId: string,
  scheduledFor: string
): Promise<Tables<'social_publications'>> {
  const supabase = createServiceClient()
  const scheduledForMs = Date.parse(scheduledFor)
  if (Number.isNaN(scheduledForMs)) {
    throw new ContentStoreError(`Invalid scheduled time: ${scheduledFor}`, 400)
  }
  const scheduledForIso = new Date(scheduledForMs).toISOString()
  const nowIso = new Date().toISOString()

  const { data: publication, error } = await supabase
    .from('social_publications')
    .update({ scheduled_for: scheduledForIso, updated_at: nowIso })
    .eq('id', publicationId)
    .in('status', ['scheduled', 'queued'])
    .select('*')
    .single()

  if (error || !publication) {
    throw new ContentStoreError(
      'Publication cannot be rescheduled (not found or already publishing/published)',
      409
    )
  }

  if (publication.shared_job_id) {
    await supabase
      .from('shared_jobs')
      .update({ available_at: scheduledForIso, updated_at: nowIso })
      .eq('id', publication.shared_job_id)
      .in('lifecycle_status', ['queued', 'retrying'])
  }
  if (publication.shared_action_attempt_id) {
    await supabase
      .from('shared_action_attempts')
      .update({
        execution_payload: {
          publicationId,
          scheduledFor: scheduledForIso,
          rescheduledAt: nowIso,
        } as Json,
        policy_reason: 'Approved publication rescheduled within operator control',
        updated_at: nowIso,
      })
      .eq('id', publication.shared_action_attempt_id)
  }

  return publication
}

export async function retryPublication(
  publicationId: string
): Promise<Tables<'social_publications'>> {
  const supabase = createServiceClient()
  const nowIso = new Date().toISOString()
  const { data: publication, error } = await supabase
    .from('social_publications')
    .update({
      status: 'queued',
      last_error: null,
      error_classification: null,
      updated_at: nowIso,
    })
    .eq('id', publicationId)
    .eq('status', 'failed')
    .select('*')
    .single()
  if (error || !publication) {
    throw new ContentStoreError('Only failed publications can be retried', 409)
  }

  if (publication.shared_job_id) {
    await supabase
      .from('shared_jobs')
      .update({
        lifecycle_status: 'retrying',
        status_reason: 'operator_retry',
        available_at: nowIso,
        retry_at: nowIso,
        finished_at: null,
        error_message: null,
        updated_at: nowIso,
      })
      .eq('id', publication.shared_job_id)
  }
  if (publication.shared_action_attempt_id) {
    await supabase
      .from('shared_action_attempts')
      .update({
        lifecycle_status: 'retrying',
        execution_status: 'approved_pending_execution',
        error_message: null,
        updated_at: nowIso,
      })
      .eq('id', publication.shared_action_attempt_id)
  }
  return publication
}
