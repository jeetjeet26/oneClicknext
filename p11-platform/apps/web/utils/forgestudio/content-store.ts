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
    validation[variant.platform] = { issues }
    return {
      revision_id: revisionRow.id,
      org_id: input.orgId,
      property_id: input.propertyId,
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

export async function setRevisionApproval(input: {
  revisionId: string
  decision: 'approved' | 'denied'
  reviewerId: string
  note?: string | null
}): Promise<Tables<'social_content_revisions'>> {
  const supabase = createServiceClient()

  const { data: revision, error: revisionError } = await supabase
    .from('social_content_revisions')
    .select('id, package_id, approval_status, claims')
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

  await supabase
    .from('social_content_packages')
    .update({
      status: input.decision === 'approved' ? 'approved' : 'in_review',
      updated_at: nowIso,
    })
    .eq('id', revision.package_id)

  return updated
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export const PUBLICATION_JOB_DOMAIN = 'forgestudio.publication'

export type ScheduleDestination = {
  connectionId: string
  scheduledFor: string
  timezone?: string
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
    .select('id, package_id, org_id, property_id, approval_status')
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
    .select('id, platform')
    .eq('revision_id', revision.id)

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
  const variantByPlatform = new Map(variants.map((variant) => [variant.platform, variant]))
  const created: Tables<'social_publications'>[] = []

  for (const destination of input.destinations) {
    const connection = connectionById.get(destination.connectionId)
    if (!connection) continue

    // 'twitter' connections publish the 'x' variant.
    const platformKey = connection.platform === 'twitter' ? 'x' : connection.platform
    const variant = variantByPlatform.get(platformKey)
    if (!variant) {
      throw new ContentStoreError(
        `Revision has no variant for platform ${platformKey} (connection ${connection.id})`,
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
        dedupe_key: `publication:${revision.id}:${connection.id}`,
        payload: {
          revisionId: revision.id,
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
          `This revision is already scheduled for connection ${connection.id}`,
          409
        )
      }
      throw new ContentStoreError(
        `Failed to enqueue publication job: ${jobError?.message || 'unknown error'}`,
        500
      )
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
        status: 'scheduled',
        max_attempts: input.maxAttempts ?? 3,
        shared_job_id: job.id,
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

  return publication
}
