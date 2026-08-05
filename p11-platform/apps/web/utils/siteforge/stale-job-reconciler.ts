import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { requestLaunchRestore } from '@/utils/siteforge/launch/service'

type ServiceClient = SupabaseClient<Database>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function decideStaleJobOutcome(input: {
  cancelRequested: boolean
  attemptCount: number
  maxAttempts: number
  publicationClaimed?: boolean
}): 'retrying' | 'failed' | 'cancelled' {
  if (input.cancelRequested) return 'cancelled'
  if (input.publicationClaimed) return 'failed'
  return input.attemptCount < input.maxAttempts ? 'retrying' : 'failed'
}

export async function reconcileStaleSiteForgeJobs(
  options: {
    now?: Date
    heartbeatTimeoutMs?: number
    limit?: number
  } = {},
  client: ServiceClient = createServiceClient()
) {
  const now = options.now || new Date()
  const staleBefore = new Date(
    now.getTime() - (options.heartbeatTimeoutMs || 15 * 60_000)
  ).toISOString()
  const nowIso = now.toISOString()
  const { data: jobs, error } = await client
    .from('shared_jobs')
    .select(
      'id, org_id, property_id, domain, subject_id, lifecycle_status, status_reason, heartbeat_at, lease_expires_at, payload, attempt_count, max_attempts, cancel_requested, updated_at'
    )
    .like('domain', 'siteforge.%')
    .in('lifecycle_status', ['queued', 'running', 'retrying'])
    .or(
      `lease_expires_at.lt.${nowIso},and(lease_expires_at.is.null,heartbeat_at.lt.${staleBefore}),and(lease_expires_at.is.null,heartbeat_at.is.null,updated_at.lt.${staleBefore})`
    )
    .order('updated_at', { ascending: true })
    .limit(Math.max(1, Math.min(options.limit || 100, 250)))
  if (error) {
    throw new Error(`Failed to load stale SiteForge jobs: ${error.message}`)
  }

  const results: Array<{
    jobId: string
    domain: string
    restored: boolean
    restoreRequested: boolean
    incidentCreated: boolean
    terminalStatus: 'retrying' | 'failed' | 'cancelled'
  }> = []
  for (const job of jobs || []) {
    if (!job.property_id) continue
    const payload = record(job.payload)
    const websiteId =
      typeof payload.websiteId === 'string'
        ? payload.websiteId
        : job.domain === 'siteforge.generation' ||
            job.domain === 'siteforge.semantic_edit'
          ? job.subject_id
          : null
    const artifactId =
      typeof payload.artifactId === 'string' ? payload.artifactId : null
    const terminalStatus: 'retrying' | 'failed' | 'cancelled' =
      decideStaleJobOutcome({
        cancelRequested: job.cancel_requested,
        attemptCount: job.attempt_count,
        maxAttempts: job.max_attempts,
        publicationClaimed: job.status_reason === 'publication_claimed',
      })
    const retrying = terminalStatus === 'retrying'
    const { data: terminalized, error: terminalError } = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: terminalStatus,
        status_reason:
          job.status_reason === 'publication_claimed'
            ? 'publication_outcome_ambiguous'
            : retrying
              ? 'stale_lease_retry_scheduled'
              : 'stale_lease_recovered',
        stage: retrying ? 'retrying' : terminalStatus,
        current_step: retrying
          ? 'Stale SiteForge workflow scheduled for retry'
          : 'Stale SiteForge workflow recovered',
        error_message:
          job.status_reason === 'publication_claimed'
            ? 'Publication outcome is ambiguous; reload the editor and verify the current immutable revision before retrying'
            : 'Workflow heartbeat or execution lease expired before completion',
        error_details: {
          code: 'siteforge_stale_execution',
          publicationOutcomeAmbiguous:
            job.status_reason === 'publication_claimed',
          recoveredAt: nowIso,
          previousHeartbeatAt: job.heartbeat_at,
          previousLeaseExpiresAt: job.lease_expires_at,
        } as Json,
        lease_owner: null,
        lease_expires_at: null,
        heartbeat_at: null,
        attempt_count: retrying ? job.attempt_count + 1 : job.attempt_count,
        retry_at: retrying ? nowIso : null,
        available_at: retrying ? nowIso : undefined,
        finished_at: retrying ? null : nowIso,
        updated_at: nowIso,
      })
      .eq('id', job.id)
      .eq('lifecycle_status', job.lifecycle_status)
      .eq('updated_at', job.updated_at)
      .select('id')
      .maybeSingle()
    if (terminalError) {
      throw new Error(
        `Failed to recover stale SiteForge job ${job.id}: ${terminalError.message}`
      )
    }
    if (!terminalized) continue

    if (job.domain === 'siteforge.semantic_edit') {
      const messageStatus = retrying ? 'running' : terminalStatus
      const { error: messageError } = await client
        .from('siteforge_edit_messages')
        .update({
          status: messageStatus,
          content: retrying
            ? 'The edit execution stalled and is scheduled for a safe retry.'
            : job.status_reason === 'publication_claimed'
              ? 'The publication outcome is ambiguous. Reload the editor to verify the current immutable revision before retrying.'
              : `The edit ${terminalStatus === 'cancelled' ? 'was cancelled' : 'failed after its execution lease expired'}.`,
          failure_code: retrying
            ? null
            : job.status_reason === 'publication_claimed'
              ? 'publication_outcome_ambiguous'
              : 'siteforge_stale_execution',
          failure_message: retrying
            ? null
            : 'Semantic edit execution lease expired before completion',
          completed_at: retrying ? null : nowIso,
        })
        .eq('shared_job_id', job.id)
        .in('status', ['queued', 'running'])
      if (messageError) {
        console.error('[siteforge_stale_reconciler] message recovery failed', {
          jobId: job.id,
          error: messageError.message,
        })
      }
    }

    const restored = false
    let restoreRequested = false
    const releaseId =
      typeof payload.releaseId === 'string' ? payload.releaseId : null
    const actorId =
      typeof payload.actorId === 'string' ? payload.actorId : null
    let incidentCreated = false
    if (websiteId) {
      const { error: incidentError } = await client
        .from('siteforge_incidents')
        .insert({
          org_id: job.org_id,
          property_id: job.property_id,
          website_id: websiteId,
          artifact_id: artifactId,
          dedupe_key: `stale-job:${job.id}`,
          severity:
            job.domain === 'siteforge.production-certification'
              ? 'critical'
              : 'high',
          status: 'open',
          category: 'workflow_stalled',
          title: 'SiteForge workflow execution expired',
          summary: `${job.domain} stopped heartbeating and was moved to a recoverable failed state.`,
          evidence: {
            jobId: job.id,
            domain: job.domain,
            heartbeatAt: job.heartbeat_at,
            leaseExpiresAt: job.lease_expires_at,
            restored,
            restoreRequested:
              job.domain === 'siteforge.production-certification',
            retryScheduled: retrying,
            attemptCount: job.attempt_count,
            maxAttempts: job.max_attempts,
          } as Json,
        })
      if (incidentError) {
        if (incidentError.code !== '23505') {
          console.error('[siteforge_stale_reconciler] incident creation failed', {
            jobId: job.id,
            error: incidentError.message,
          })
        }
      } else {
        incidentCreated = true
      }
    }
    if (
      job.domain === 'siteforge.production-certification' &&
      releaseId &&
      actorId
    ) {
      try {
        await requestLaunchRestore(
          {
            releaseId,
            propertyId: job.property_id,
            rationale:
              'Operator restore required after stale production certification workflow',
            actorId,
            requestId: job.id,
            source: 'stale_job',
          },
          client
        )
        restoreRequested = true
      } catch (restoreError) {
        console.error('[siteforge_stale_reconciler] restore request failed', {
          jobId: job.id,
          error:
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError),
        })
      }
    }
    results.push({
      jobId: job.id,
      domain: job.domain,
      restored,
      restoreRequested,
      incidentCreated,
      terminalStatus,
    })
  }
  return {
    examined: jobs?.length || 0,
    recovered: results.length,
    results,
  }
}
