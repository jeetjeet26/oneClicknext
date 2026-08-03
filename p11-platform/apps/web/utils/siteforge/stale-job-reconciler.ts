import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { restoreLaunchRelease } from '@/utils/siteforge/launch/service'

type ServiceClient = SupabaseClient<Database>

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
      'id, org_id, property_id, domain, subject_id, lifecycle_status, heartbeat_at, lease_expires_at, payload'
    )
    .like('domain', 'siteforge.%')
    .in('lifecycle_status', ['running', 'retrying'])
    .or(
      `lease_expires_at.lt.${nowIso},and(lease_expires_at.is.null,heartbeat_at.lt.${staleBefore})`
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
    incidentCreated: boolean
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
    const { data: terminalized, error: terminalError } = await client
      .from('shared_jobs')
      .update({
        lifecycle_status: 'failed',
        status_reason: 'stale_lease_recovered',
        stage: 'failed',
        current_step: 'Stale SiteForge workflow recovered',
        error_message:
          'Workflow heartbeat or execution lease expired before completion',
        error_details: {
          code: 'siteforge_stale_execution',
          recoveredAt: nowIso,
          previousHeartbeatAt: job.heartbeat_at,
          previousLeaseExpiresAt: job.lease_expires_at,
        } as Json,
        lease_owner: null,
        lease_expires_at: null,
        finished_at: nowIso,
        updated_at: nowIso,
      })
      .eq('id', job.id)
      .eq('lifecycle_status', job.lifecycle_status)
      .select('id')
      .maybeSingle()
    if (terminalError) {
      throw new Error(
        `Failed to recover stale SiteForge job ${job.id}: ${terminalError.message}`
      )
    }
    if (!terminalized) continue

    let restored = false
    const releaseId =
      typeof payload.releaseId === 'string' ? payload.releaseId : null
    const actorId =
      typeof payload.actorId === 'string' ? payload.actorId : null
    if (
      job.domain === 'siteforge.production-certification' &&
      releaseId &&
      actorId
    ) {
      const restore = await restoreLaunchRelease(
        {
          releaseId,
          propertyId: job.property_id,
          rationale:
            'Automatic safety restore after stale production certification workflow',
          actorId,
          requestId: job.id,
        },
        client
      )
      restored = !restore.manualRequired
    }

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
          } as Json,
        })
      if (incidentError) {
        throw new Error(
          `Failed to create stale workflow incident: ${incidentError.message}`
        )
      }
      incidentCreated = true
    }
    results.push({ jobId: job.id, domain: job.domain, restored, incidentCreated })
  }
  return {
    examined: jobs?.length || 0,
    recovered: results.length,
    results,
  }
}
