import { start } from 'workflow/api'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { siteForgeCanonicalPreviewWorkflow } from '@/workflows/siteforge-canonical-preview'

type ServiceClient = SupabaseClient<Database>

export interface CanonicalPreviewQueueResult {
  status:
    | 'queued'
    | 'running'
    | 'retrying'
    | 'pending'
    | 'failed'
    | 'succeeded'
  jobId: string | null
  reason?: string
}

export function canonicalPreviewDedupeKey(
  artifactId: string,
  contentHash: string
): string {
  return `siteforge-preview:${artifactId}:${contentHash}`
}

export async function queueCanonicalPreviewAfterPublication(input: {
  service: ServiceClient
  orgId: string
  propertyId: string
  websiteId: string
  artifactId: string
  contentHash: string
  runBrowserQa?: boolean
}): Promise<CanonicalPreviewQueueResult> {
  const dedupeKey = canonicalPreviewDedupeKey(
    input.artifactId,
    input.contentHash
  )
  const { data: existing, error: existingError } = await input.service
    .from('shared_jobs')
    .select('id, lifecycle_status')
    .eq('org_id', input.orgId)
    .eq('domain', 'siteforge.preview')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  if (existingError) {
    return { status: 'pending', jobId: null, reason: existingError.message }
  }
  if (existing) {
    const status = [
      'queued',
      'running',
      'retrying',
      'failed',
      'succeeded',
    ].includes(existing.lifecycle_status)
      ? (existing.lifecycle_status as CanonicalPreviewQueueResult['status'])
      : 'pending'
    return {
      status,
      jobId: existing.id,
    }
  }

  const { data: conflicting, error: conflictError } = await input.service
    .from('shared_jobs')
    .select('id')
    .eq('domain', 'siteforge.preview')
    .in('lifecycle_status', ['queued', 'running', 'retrying'])
    .contains('payload', { websiteId: input.websiteId })
    .neq('subject_id', input.artifactId)
    .limit(1)
    .maybeSingle()
  if (conflictError || conflicting) {
    return {
      status: 'pending',
      jobId: null,
      reason:
        conflictError?.message ||
        'Another revision is currently using the canonical preview target',
    }
  }

  const { data: target, error: targetError } = await input.service
    .from('siteforge_wordpress_targets')
    .select('id')
    .eq('website_id', input.websiteId)
    .eq('target_type', 'canonical_preview')
    .eq('is_active', true)
    .maybeSingle()
  if (targetError || !target) {
    return {
      status: 'pending',
      jobId: null,
      reason: targetError?.message || 'Canonical preview target is not ready',
    }
  }

  const payload = {
    websiteId: input.websiteId,
    propertyId: input.propertyId,
    orgId: input.orgId,
    artifactId: input.artifactId,
    contentHash: input.contentHash,
    targetId: target.id,
    runBrowserQa: input.runBrowserQa === true,
  }
  const now = new Date().toISOString()
  const { data: job, error: jobError } = await input.service
    .from('shared_jobs')
    .insert({
      org_id: input.orgId,
      property_id: input.propertyId,
      domain: 'siteforge.preview',
      subject_type: 'siteforge_artifact',
      subject_id: input.artifactId,
      dedupe_key: dedupeKey,
      lifecycle_status: 'queued',
      status_reason: 'canonical_preview_queued_after_extension_approval',
      stage: 'queued',
      progress: 0,
      current_step: 'Canonical WordPress preview queued',
      payload: payload as unknown as Json,
      max_attempts: 2,
      attempt_count: 1,
      updated_at: now,
    })
    .select('id')
    .single()
  if (jobError || !job) {
    const { data: raced } = await input.service
      .from('shared_jobs')
      .select('id, lifecycle_status')
      .eq('org_id', input.orgId)
      .eq('domain', 'siteforge.preview')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    return raced
      ? {
          status: raced.lifecycle_status as CanonicalPreviewQueueResult['status'],
          jobId: raced.id,
        }
      : {
          status: 'pending',
          jobId: null,
          reason: jobError?.message || 'Preview job could not be queued',
        }
  }

  const claimedAt = new Date().toISOString()
  const { data: claimed, error: claimError } = await input.service
    .from('shared_jobs')
    .update({
      lifecycle_status: 'running',
      status_reason: 'canonical_preview_claimed_after_extension_approval',
      lease_owner: 'siteforge-canonical-preview',
      lease_expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
      heartbeat_at: claimedAt,
      started_at: claimedAt,
      updated_at: claimedAt,
    })
    .eq('id', job.id)
    .eq('lifecycle_status', 'queued')
    .select('id')
    .maybeSingle()
  if (claimError || !claimed) {
    return {
      status: 'pending',
      jobId: job.id,
      reason: claimError?.message || 'Preview target is currently busy',
    }
  }

  try {
    const run = await start(siteForgeCanonicalPreviewWorkflow, [
      { sharedJobId: job.id, ...payload },
    ])
    const { error: linkError } = await input.service
      .from('shared_jobs')
      .update({
        workflow_run_id: run.runId,
        workflow_name: 'siteForgeCanonicalPreviewWorkflow',
      })
      .eq('id', job.id)
      .eq('lease_owner', 'siteforge-canonical-preview')
    if (linkError) {
      await run.cancel()
      throw new Error(linkError.message)
    }
    return { status: 'running', jobId: job.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await input.service
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'canonical_preview_start_failed',
        stage: 'failed',
        current_step: 'Canonical preview workflow failed to start',
        error_message: message,
        finished_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    return { status: 'failed', jobId: job.id, reason: message }
  }
}
