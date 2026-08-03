import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import { restoreLaunchRelease } from '@/utils/siteforge/launch/service'
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
    if (
      drill.status === 'verifying' &&
      existingReport.executionRequiresOperator === true &&
      existingReport.restoreCompleted !== true
    ) {
      results.push({
        drillId: drill.id,
        orgId: drill.org_id,
        status: 'awaiting_operator',
      })
      continue
    }

    try {
      if (drill.status === 'queued') {
        const { data: claimed } = await client
          .from('siteforge_restore_drills')
          .update({
            status: 'restoring',
            started_at: drill.started_at || new Date().toISOString(),
          })
          .eq('id', drill.id)
          .eq('status', 'queued')
          .select('id')
          .maybeSingle()
        if (!claimed) continue
        if (!drill.release_id) {
          throw new Error('Restore drill has no launch release identity')
        }
        const { data: release, error: releaseError } = await client
          .from('siteforge_launch_releases')
          .select('state, approved_by, created_by')
          .eq('id', drill.release_id)
          .single()
        if (releaseError || !release) {
          throw new Error(
            `Restore launch release is unavailable: ${releaseError?.message || drill.release_id}`
          )
        }
        const actorId = release.approved_by || release.created_by
        if (!actorId) {
          throw new Error('Restore release has no accountable operator identity')
        }
        if (release.state !== 'rolled_back') {
          const restored = await restoreLaunchRelease(
            {
              releaseId: drill.release_id,
              propertyId: drill.property_id,
              rationale: 'Automatic safety restore requested by production health',
              actorId,
              requestId: drill.id,
            },
            client
          )
          if (restored.manualRequired) {
            await client
              .from('siteforge_restore_drills')
              .update({
                status: 'verifying',
                verification_report: {
                  ...existingReport,
                  executionRequiresOperator: true,
                  restoreCompleted: false,
                  dashboardAction: restored.dashboardAction,
                  requestedAt: new Date().toISOString(),
                } as Json,
              })
              .eq('id', drill.id)
            results.push({
              drillId: drill.id,
              orgId: drill.org_id,
              status: 'awaiting_operator',
            })
            continue
          }
        }
        await client
          .from('siteforge_restore_drills')
          .update({
            status: 'verifying',
            verification_report: {
              ...existingReport,
              executionRequiresOperator: false,
              restoreCompleted: true,
              restoredAt: new Date().toISOString(),
            } as Json,
          })
          .eq('id', drill.id)
      }

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
  const { error } = await client
    .from('siteforge_restore_drills')
    .update({
      status: 'verifying',
      provider_operation_id: operationId,
      verification_report: {
        executionRequiresOperator: false,
        restoreCompleted: true,
        manualOperationId: operationId,
        restoredAt: new Date().toISOString(),
      } as Json,
    })
    .eq('release_id', releaseId)
    .in('status', ['queued', 'restoring', 'verifying'])
  if (error) {
    throw new Error(
      `Restore completed but drill verification could not be queued: ${error.message}`
    )
  }
}
