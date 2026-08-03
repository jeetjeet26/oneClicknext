import type { Json } from '@/types/supabase'
import { createServiceClient } from '@/utils/supabase/admin'
import {
  runSiteForgeHealth,
  type SiteForgeHealthProbes,
} from '@/utils/siteforge/production-health'

const LOW_RISK_REPAIR_CATEGORIES = new Set([
  'links',
  'forms',
  'widget',
  'tours',
  'inventory',
  'indexability',
  'sitemap',
  'brand',
  'legal',
  'accessibility',
  'performance',
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

export async function runOnePassSiteForgeRepair(input: {
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
  if (!LOW_RISK_REPAIR_CATEGORIES.has(incident.category)) {
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
      'id, org_id, property_id, production_artifact_id, production_content_hash, production_url'
    )
    .eq('id', incident.website_id)
    .single()
  if (websiteError || !website?.production_url) {
    throw new Error('Production target is unavailable for repair verification')
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
        rationale: input.rationale,
        actorId: input.actorId,
        boundedPasses: 1,
        automaticProductionMutation: false,
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
      .update({ status: 'repairing', owner_id: input.actorId, updated_at: new Date().toISOString() })
      .eq('id', incident.id),
    service.from('siteforge_incident_events').insert({
      incident_id: incident.id,
      event_type: 'repair_started',
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
      },
      { trigger: 'repair', probes: input.probes }
    )
    const repaired = health.checks[incident.category as keyof typeof health.checks]?.passed === true
    const completedAt = new Date().toISOString()
    await Promise.all([
      service
        .from('siteforge_repair_attempts')
        .update({
          status: repaired ? 'succeeded' : 'failed',
          result: {
            healthRunId: health.runId,
            repaired,
            onePassComplete: true,
          } as Json,
          completed_at: completedAt,
        })
        .eq('id', attempt.id),
      service.from('siteforge_incident_events').insert({
        incident_id: incident.id,
        event_type: repaired ? 'repair_succeeded' : 'repair_failed',
        actor_id: input.actorId,
        payload: { repairAttemptId: attempt.id, healthRunId: health.runId } as Json,
      }),
    ])
    return { attemptId: attempt.id, repaired, healthRunId: health.runId }
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
