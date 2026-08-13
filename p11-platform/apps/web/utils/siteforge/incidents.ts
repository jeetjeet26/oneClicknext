import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  declaredSiteForgePagePaths,
  runSiteForgeHealth,
  type SiteForgeHealthProbes,
} from '@/utils/siteforge/production-health'
import { runSharedExecutorJob } from '@/utils/services/shared-executor'

const RECHECKABLE_CATEGORIES = new Set([
  'links',
  'redirects',
  'forms',
  'widget',
  'tours',
  'inventory',
  'connector_freshness',
  'indexability',
  'sitemap',
  'brand',
  'legal',
  'accessibility',
  'performance',
  'runtime',
  'plugin_vulnerabilities',
  'expiring_specials',
  'content_drift',
])

export async function listSiteForgeIncidents(websiteId: string) {
  const service = createServiceClient()
  const [{ data: incidents, error }, { data: healthRuns }, { data: repairs }] =
    await Promise.all([
      service
        .from('siteforge_incidents')
        .select('*')
        .eq('website_id', websiteId)
        .order('created_at', { ascending: false })
        .limit(100),
      service
        .from('siteforge_health_runs')
        .select('*')
        .eq('website_id', websiteId)
        .order('started_at', { ascending: false })
        .limit(20),
      service
        .from('siteforge_repair_attempts')
        .select('*, siteforge_incidents!inner(website_id)')
        .eq('siteforge_incidents.website_id', websiteId)
        .order('created_at', { ascending: false })
        .limit(50),
    ])
  if (error) throw new Error(`Failed to list SiteForge incidents: ${error.message}`)
  return { incidents: incidents || [], healthRuns: healthRuns || [], repairs: repairs || [] }
}

export async function acknowledgeSiteForgeIncident(input: {
  incidentId: string
  actorId: string
  rationale: string
}) {
  const service = createServiceClient()
  const now = new Date().toISOString()
  const { data: incident, error } = await service
    .from('siteforge_incidents')
    .update({
      status: 'acknowledged',
      owner_id: input.actorId,
      acknowledged_at: now,
      updated_at: now,
    })
    .eq('id', input.incidentId)
    .in('status', ['open', 'acknowledged'])
    .select('*')
    .single()
  if (error || !incident) {
    throw new Error(`Incident is unavailable for acknowledgement: ${error?.message || ''}`)
  }
  await service.from('siteforge_incident_events').insert({
    incident_id: incident.id,
    event_type: 'acknowledged',
    actor_id: input.actorId,
    payload: { rationale: input.rationale } as Json,
  })
  return incident
}

export async function runSiteForgeIncidentRecheck(input: {
  incidentId: string
  actorId: string
  rationale: string
  probes?: Partial<SiteForgeHealthProbes>
}) {
  const service = createServiceClient()
  const { data: incident, error } = await service
    .from('siteforge_incidents')
    .select('*')
    .eq('id', input.incidentId)
    .neq('status', 'resolved')
    .single()
  if (error || !incident) throw new Error('Active incident not found')
  if (!RECHECKABLE_CATEGORIES.has(incident.category)) {
    throw new Error('This incident requires manual restore or rollback supervision')
  }
  const { count } = await service
    .from('siteforge_repair_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('incident_id', incident.id)
  if ((count || 0) >= 1) {
    throw new Error('The bounded one-pass repair allowance has already been used')
  }
  const { data: website, error: websiteError } = await service
    .from('property_websites')
    .select(
      'id, org_id, property_id, production_artifact_id, production_content_hash, production_url, pages_generated'
    )
    .eq('id', incident.website_id)
    .single()
  if (websiteError || !website?.production_url) {
    throw new Error('Production target is unavailable for repair verification')
  }
  const { data: connectorRows, error: connectorError } = await service
    .from('siteforge_connector_configs')
    .select('id, capability, status, last_success_at, freshness_seconds')
    .eq('website_id', website.id)
  if (connectorError) {
    throw new Error(`Production connector evidence is unavailable: ${connectorError.message}`)
  }

  const { data: attempt, error: attemptError } = await service
    .from('siteforge_repair_attempts')
    .insert({
      incident_id: incident.id,
      repair_type: `supervised_recheck:${incident.category}`,
      risk_level: 'low',
      status: 'running',
      attempt_number: 1,
      input: {
        operation: 'recheck',
        rationale: input.rationale,
        actorId: input.actorId,
        boundedPasses: 1,
        automaticProductionMutation: false,
        before: {
          incidentStatus: incident.status,
          incidentEvidence: incident.evidence,
          incidentUpdatedAt: incident.updated_at,
        },
      } as Json,
    })
    .select('id')
    .single()
  if (attemptError || !attempt) {
    throw new Error(`Failed to start bounded repair: ${attemptError?.message || ''}`)
  }
  await Promise.all([
    service
      .from('siteforge_incidents')
      .update({
        status: 'acknowledged',
        owner_id: input.actorId,
        acknowledged_at: incident.acknowledged_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', incident.id),
    service.from('siteforge_incident_events').insert({
      incident_id: incident.id,
      event_type: 'recheck_started',
      actor_id: input.actorId,
      payload: { repairAttemptId: attempt.id, rationale: input.rationale } as Json,
    }),
  ])

  try {
    const health = await runSiteForgeHealth(
      {
        orgId: website.org_id,
        propertyId: website.property_id,
        websiteId: website.id,
        artifactId: website.production_artifact_id,
        contentHash: website.production_content_hash,
        url: website.production_url,
        declaredPages: declaredSiteForgePagePaths(website.pages_generated),
        connectors: (connectorRows || []).map(connector => ({
          id: connector.id,
          capability: connector.capability,
          status: connector.status,
          lastSuccessAt: connector.last_success_at,
          freshnessSeconds: connector.freshness_seconds,
        })),
      },
      { trigger: 'repair', probes: input.probes }
    )
    const verified =
      health.checks[incident.category as keyof typeof health.checks]?.passed === true
    const completedAt = new Date().toISOString()
    await Promise.all([
      service
        .from('siteforge_repair_attempts')
        .update({
          status: verified ? 'succeeded' : 'failed',
          result: {
            healthRunId: health.runId,
            verified,
            repaired: false,
            operation: 'recheck',
            productionMutated: false,
            before: {
              incidentStatus: incident.status,
              incidentEvidence: incident.evidence,
            },
            after: {
              check: health.checks[incident.category as keyof typeof health.checks],
              healthStatus: health.status,
            },
            onePassComplete: true,
          } as Json,
          completed_at: completedAt,
        })
        .eq('id', attempt.id),
      service.from('siteforge_incident_events').insert({
        incident_id: incident.id,
        event_type: verified ? 'recheck_passed' : 'recheck_failed',
        actor_id: input.actorId,
        payload: { repairAttemptId: attempt.id, healthRunId: health.runId } as Json,
      }),
    ])
    return {
      operation: 'recheck' as const,
      attemptId: attempt.id,
      verified,
      repaired: false,
      healthRunId: health.runId,
      productionMutated: false,
    }
  } catch (cause) {
    const completedAt = new Date().toISOString()
    await service
      .from('siteforge_repair_attempts')
      .update({
        status: 'failed',
        result: {
          error: cause instanceof Error ? cause.message : 'Repair verification failed',
          onePassComplete: true,
        } as Json,
        completed_at: completedAt,
      })
      .eq('id', attempt.id)
    await service
      .from('siteforge_incidents')
      .update({ status: 'acknowledged', updated_at: completedAt })
      .eq('id', incident.id)
      .eq('status', 'repairing')
    throw cause
  }
}

export const SITEFORGE_SAFE_REPAIR_HANDLERS = [
  'resolve_after_verified_recheck',
] as const
export type SiteForgeSafeRepairHandler =
  (typeof SITEFORGE_SAFE_REPAIR_HANDLERS)[number]

/**
 * The only provider-free repair mutates ownership state after durable health
 * evidence already proves the incident's exact check is passing. Content,
 * plugin, connector, and runtime changes remain proposals or supervised
 * provider operations outside this handler.
 */
export async function runOnePassSiteForgeRepair(input: {
  incidentId: string
  actorId: string
  rationale: string
  handler: SiteForgeSafeRepairHandler
}) {
  const service = createServiceClient()
  const { data: incident, error } = await service
    .from('siteforge_incidents')
    .select('*')
    .eq('id', input.incidentId)
    .neq('status', 'resolved')
    .single()
  if (error || !incident) throw new Error('Active incident not found')

  const { data: healthRun, error: healthError } = await service
    .from('siteforge_health_runs')
    .select('id, status, checks, completed_at')
    .eq('website_id', incident.website_id)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const checks =
    healthRun?.checks &&
    typeof healthRun.checks === 'object' &&
    !Array.isArray(healthRun.checks)
      ? (healthRun.checks as Record<string, unknown>)
      : {}
  const check =
    checks[incident.category] &&
    typeof checks[incident.category] === 'object' &&
    !Array.isArray(checks[incident.category])
      ? (checks[incident.category] as Record<string, unknown>)
      : null
  if (healthError || !healthRun?.completed_at || check?.passed !== true) {
    throw new Error(
      'Safe repair requires a completed passing recheck for this exact incident category'
    )
  }

  const { count } = await service
    .from('siteforge_repair_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('incident_id', incident.id)
    .eq('repair_type', input.handler)
  if ((count || 0) >= 1) {
    throw new Error('The bounded one-pass safe repair allowance has already been used')
  }

  const before = {
    incidentStatus: incident.status,
    incidentUpdatedAt: incident.updated_at,
    incidentEvidence: incident.evidence,
    verifiedByHealthRunId: healthRun.id,
    verifiedCheck: check,
  }
  const { data: attempt, error: attemptError } = await service
    .from('siteforge_repair_attempts')
    .insert({
      incident_id: incident.id,
      repair_type: input.handler,
      risk_level: 'low',
      status: 'running',
      attempt_number: 1,
      input: {
        rationale: input.rationale,
        actorId: input.actorId,
        handler: input.handler,
        productionMutation: false,
        before,
      } as Json,
    })
    .select('id')
    .single()
  if (attemptError || !attempt) {
    throw new Error(`Failed to start safe repair: ${attemptError?.message || ''}`)
  }

  const dedupeKey = `siteforge-incident-repair:${attempt.id}`
  try {
    const result = await runSharedExecutorJob({
      orgId: incident.org_id,
      propertyId: incident.property_id,
      domain: 'siteforge.incident-repair',
      subjectType: 'siteforge_incident',
      subjectId: incident.id,
      dedupeKey,
      requestedBy: input.actorId,
      capturedBy: input.actorId,
      payload: { incidentId: incident.id, handler: input.handler, before },
      action: {
        actionType: `siteforge.incident:${input.handler}`,
        proposalDecisionStatus: 'approved',
        requestPayload: {
          incidentId: incident.id,
          rationale: input.rationale,
        },
        executionPayload: {
          incidentId: incident.id,
          healthRunId: healthRun.id,
          productionMutation: false,
        },
        policyReason:
          'Explicit operator request plus a passing exact-category health recheck.',
        confidenceScore: 1,
      },
      execute: async () => {
        const completedAt = new Date().toISOString()
        const { data: repaired, error: repairError } = await service
          .from('siteforge_incidents')
          .update({
            status: 'resolved',
            resolved_at: completedAt,
            updated_at: completedAt,
            owner_id: input.actorId,
          })
          .eq('id', incident.id)
          .neq('status', 'resolved')
          .select('id, status, resolved_at, owner_id, updated_at')
          .single()
        if (repairError || !repaired) {
          throw new Error(`Failed to resolve verified incident: ${repairError?.message || ''}`)
        }
        return {
          operation: 'safe_repair' as const,
          handler: input.handler,
          productionMutated: false,
          before,
          after: repaired,
        }
      },
    })
    const { data: sharedJob } = await service
      .from('shared_jobs')
      .select('id')
      .eq('org_id', incident.org_id)
      .eq('domain', 'siteforge.incident-repair')
      .eq('dedupe_key', dedupeKey)
      .maybeSingle()
    const completedAt = new Date().toISOString()
    await Promise.all([
      service
        .from('siteforge_repair_attempts')
        .update({
          shared_job_id: sharedJob?.id || null,
          status: 'succeeded',
          result: result as unknown as Json,
          completed_at: completedAt,
        })
        .eq('id', attempt.id),
      service.from('siteforge_incident_events').insert({
        incident_id: incident.id,
        event_type: 'safe_repair_succeeded',
        actor_id: input.actorId,
        payload: {
          repairAttemptId: attempt.id,
          sharedJobId: sharedJob?.id || null,
          handler: input.handler,
          before,
          after: result.after,
        } as Json,
      }),
    ])
    return {
      ...result,
      attemptId: attempt.id,
      sharedJobId: sharedJob?.id || null,
    }
  } catch (cause) {
    const completedAt = new Date().toISOString()
    await service
      .from('siteforge_repair_attempts')
      .update({
        status: 'failed',
        result: {
          operation: 'safe_repair',
          handler: input.handler,
          productionMutated: false,
          before,
          error: cause instanceof Error ? cause.message : 'Safe repair failed',
        } as Json,
        completed_at: completedAt,
      })
      .eq('id', attempt.id)
    throw cause
  }
}
