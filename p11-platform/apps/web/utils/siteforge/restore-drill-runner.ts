import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { runSiteForgeHealth } from '@/utils/siteforge/production-health'

type ServiceClient = SupabaseClient<Database>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function verifyRestore(
  drill: {
    id: string
    org_id: string
    property_id: string
    website_id: string
    expected_artifact_id: string | null
    expected_content_hash: string
  },
  client: ServiceClient
) {
  const { data: website, error } = await client
    .from('property_websites')
    .select('production_artifact_id, production_content_hash, production_url')
    .eq('id', drill.website_id)
    .single()
  if (
    error ||
    !website?.production_url ||
    website.production_artifact_id !== drill.expected_artifact_id ||
    website.production_content_hash !== drill.expected_content_hash
  ) {
    throw new Error(
      `Restored website projection does not match expected identity: ${
        error?.message || drill.website_id
      }`
    )
  }
  const health = await runSiteForgeHealth(
    {
      orgId: drill.org_id,
      propertyId: drill.property_id,
      websiteId: drill.website_id,
      artifactId: drill.expected_artifact_id,
      contentHash: drill.expected_content_hash,
      url: website.production_url,
    },
    { trigger: 'restore' }
  )
  if (!health.checks.identity.passed || !health.checks.reachability.passed) {
    throw new Error(
      'Restored production failed identity or reachability verification'
    )
  }
  return health
}

export async function processSiteForgeRestoreDrills(
  options: { limit?: number } = {},
  client: ServiceClient = createServiceClient()
) {
  const { data: drills, error } = await client
    .from('siteforge_restore_drills')
    .select('*')
    .in('status', ['queued', 'verifying'])
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(options.limit || 10, 50)))
  if (error) {
    throw new Error(`Failed to load SiteForge restore drills: ${error.message}`)
  }

  const results: Array<{
    drillId: string
    orgId: string
    status: 'succeeded' | 'failed' | 'awaiting_operator'
    error?: string
  }> = []
  for (const drill of drills || []) {
    const existingReport = asRecord(drill.verification_report)
    if (drill.status === 'queued') {
      const requestedAt = new Date().toISOString()
      const { data: claimed, error: claimError } = await client
        .from('siteforge_restore_drills')
        .update({
          status: 'verifying',
          started_at: drill.started_at || requestedAt,
          verification_report: {
            ...existingReport,
            executionRequiresOperator: true,
            restoreCompleted: false,
            requestedAt,
          } as Json,
        })
        .eq('id', drill.id)
        .eq('status', 'queued')
        .select('id')
        .maybeSingle()
      if (claimError) {
        throw new Error(
          `Failed to mark restore drill as awaiting operator: ${claimError.message}`
        )
      }
      if (claimed) {
        results.push({
          drillId: drill.id,
          orgId: drill.org_id,
          status: 'awaiting_operator',
        })
      }
      continue
    }
    if (
      drill.status === 'verifying' &&
      (existingReport.restoreCompleted !== true ||
        !drill.provider_operation_id)
    ) {
      results.push({
        drillId: drill.id,
        orgId: drill.org_id,
        status: 'awaiting_operator',
      })
      continue
    }

    try {
      const health = await verifyRestore(drill, client)
      const completedAt = new Date().toISOString()
      const { error: completeError } = await client
        .from('siteforge_restore_drills')
        .update({
          status: 'succeeded',
          verification_report: {
            ...existingReport,
            executionRequiresOperator: false,
            restoreCompleted: true,
            healthRunId: health.runId,
            healthStatus: health.status,
            identityVerified: true,
            reachabilityVerified: true,
            verifiedAt: completedAt,
          } as Json,
          completed_at: completedAt,
        })
        .eq('id', drill.id)
        .eq('status', 'verifying')
      if (completeError) {
        throw new Error(
          `Failed to complete restore drill: ${completeError.message}`
        )
      }
      results.push({
        drillId: drill.id,
        orgId: drill.org_id,
        status: 'succeeded',
      })
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'SiteForge restore drill failed'
      await client
        .from('siteforge_restore_drills')
        .update({
          status: 'failed',
          verification_report: {
            ...existingReport,
            error: message,
            failedAt: new Date().toISOString(),
          } as Json,
          completed_at: new Date().toISOString(),
        })
        .eq('id', drill.id)
      results.push({
        drillId: drill.id,
        orgId: drill.org_id,
        status: 'failed',
        error: message,
      })
    }
  }
  return {
    processed: results.length,
    succeeded: results.filter(result => result.status === 'succeeded').length,
    failed: results.filter(result => result.status === 'failed').length,
    awaitingOperator: results.filter(
      result => result.status === 'awaiting_operator'
    ).length,
    results,
  }
}

export async function markRestoreDrillsReadyForVerification(
  releaseId: string,
  operationId: string,
  client: ServiceClient = createServiceClient()
) {
  const { data: drills, error: loadError } = await client
    .from('siteforge_restore_drills')
    .select('id, provider_operation_id, verification_report')
    .eq('release_id', releaseId)
    .in('status', ['queued', 'restoring', 'verifying'])
  if (loadError) {
    throw new Error(
      `Restore completed but drill verification could not be loaded: ${loadError.message}`
    )
  }
  for (const drill of drills || []) {
    if (
      drill.provider_operation_id &&
      drill.provider_operation_id !== operationId
    ) {
      throw new Error('Restore drill is claimed by a different provider operation')
    }
    const { error } = await client
      .from('siteforge_restore_drills')
      .update({
        status: 'verifying',
        provider_operation_id: operationId,
        verification_report: {
          ...asRecord(drill.verification_report),
          executionRequiresOperator: false,
          restoreCompleted: true,
          manualOperationId: operationId,
          restoredAt: new Date().toISOString(),
        } as Json,
      })
      .eq('id', drill.id)
      .in('status', ['queued', 'restoring', 'verifying'])
    if (error) {
      throw new Error(
        `Restore completed but drill verification could not be queued: ${error.message}`
      )
    }
  }
}
