import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
import { recordSharedOutcome } from '@/utils/services/shared-outcomes'
import { enqueueSiteForgeOutbox } from './outbox'

const ga4Schema = z.object({
  destinationType: z.literal('ga4'),
  destinationIdentity: z.string().regex(/^G-[A-Z0-9]{6,20}$/),
  configuration: z.object({ apiSecret: z.string().min(8) }).strict(),
})
const gtmSchema = z.object({
  destinationType: z.literal('gtm'),
  destinationIdentity: z.string().regex(/^GTM-[A-Z0-9]{4,20}$/),
  configuration: z.object({ dataLayerName: z.string().max(100).optional() }).strict(),
})
const webhookSchema = z.object({
  destinationType: z.literal('webhook'),
  destinationIdentity: z.string().url().refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  }, 'Webhook destination must be a public HTTPS URL'),
  configuration: z
    .object({ signingSecret: z.string().min(16), timeoutMs: z.number().int().min(500).max(10_000).optional() })
    .strict(),
})

export const analyticsDestinationSchema = z
  .discriminatedUnion('destinationType', [ga4Schema, gtmSchema, webhookSchema])
  .and(
    z.object({
      consentMode: z.enum(['required', 'not_required']),
      enabled: z.boolean().default(true),
    })
  )

export async function upsertValidatedAnalyticsDestination(
  client: SupabaseClient<Database>,
  scope: { orgId: string; propertyId: string; websiteId?: string },
  raw: unknown
) {
  const destination = analyticsDestinationSchema.parse(raw)
  const { data, error } = await client
    .from('siteforge_analytics_destinations')
    .upsert(
      {
        org_id: scope.orgId,
        property_id: scope.propertyId,
        website_id: scope.websiteId || null,
        destination_type: destination.destinationType,
        destination_identity: destination.destinationIdentity,
        configuration: destination.configuration as unknown as Json,
        consent_mode: destination.consentMode,
        enabled: destination.enabled,
      },
      { onConflict: 'property_id,destination_type,destination_identity' }
    )
    .select('*')
    .single()
  if (error || !data) {
    throw new Error(`Failed to persist analytics destination: ${error?.message}`)
  }
  return data
}

export type FunnelEvent = Pick<
  Database['public']['Tables']['siteforge_telemetry_events']['Row'],
  'artifact_id' | 'event_type' | 'session_id' | 'lead_id'
> &
  Partial<
    Pick<
      Database['public']['Tables']['siteforge_telemetry_events']['Row'],
      | 'campaign'
      | 'consent_state'
      | 'occurred_at'
      | 'page_path'
      | 'payload'
      | 'referrer'
    >
  >

const FUNNEL_STEPS = [
  'page_view',
  'cta_click',
  'lead_start',
  'lead_submit',
  'tour_booked',
] as const

export const SITEFORGE_OUTCOME_KPIS = [
  'siteforge.sessions',
  'siteforge.cta_conversion_rate',
  'siteforge.lead_conversion_rate',
  'siteforge.tour_conversion_rate',
] as const

export function aggregateArtifactFunnels(events: readonly FunnelEvent[]) {
  const groups = new Map<string, FunnelEvent[]>()
  for (const event of events) {
    const key = event.artifact_id || 'unattributed'
    groups.set(key, [...(groups.get(key) || []), event])
  }
  return [...groups.entries()].map(([artifactKey, rows]) => {
    const sessions = new Set(rows.map((row) => row.session_id))
    const counts = Object.fromEntries(
      FUNNEL_STEPS.map((step) => [
        step,
        new Set(rows.filter((row) => row.event_type === step).map((row) => row.session_id)).size,
      ])
    ) as Record<(typeof FUNNEL_STEPS)[number], number>
    return {
      artifactId: artifactKey === 'unattributed' ? null : artifactKey,
      metrics: {
        sessions: sessions.size,
        uniqueLeads: new Set(rows.flatMap((row) => (row.lead_id ? [row.lead_id] : []))).size,
        steps: counts,
        ctaConversionRate: sessions.size ? counts.cta_click / sessions.size : 0,
        leadConversionRate: sessions.size ? counts.lead_submit / sessions.size : 0,
        tourConversionRate: sessions.size ? counts.tour_booked / sessions.size : 0,
      },
    }
  })
}

export interface AnomalyRule {
  id: string
  metric: 'leadConversionRate' | 'tourConversionRate' | 'sessions'
  operator: 'lt' | 'gt'
  threshold: number
  minimumSessions?: number
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export function evaluateAnomalyRules(
  funnel: ReturnType<typeof aggregateArtifactFunnels>[number],
  rules: readonly AnomalyRule[]
) {
  return rules.flatMap((rule) => {
    if (funnel.metrics.sessions < (rule.minimumSessions || 0)) return []
    const value = funnel.metrics[rule.metric]
    const triggered = rule.operator === 'lt' ? value < rule.threshold : value > rule.threshold
    if (!triggered) return []
    const evidence = {
      rule,
      actualValue: value,
      artifactId: funnel.artifactId,
      metrics: funnel.metrics,
    }
    return [{
      dedupeKey: hashSiteForgeContent({ ruleId: rule.id, artifactId: funnel.artifactId }),
      category: 'analytics_anomaly',
      severity: rule.severity,
      title: `SiteForge funnel anomaly: ${rule.metric}`,
      summary: `${rule.metric} was ${value}; expected ${rule.operator} threshold ${rule.threshold} not to be breached.`,
      evidence: Object.freeze(evidence),
    }]
  })
}

export async function persistArtifactFunnelsAndIncidents(
  client: SupabaseClient<Database>,
  input: {
    orgId: string
    propertyId: string
    websiteId: string
    windowStart: string
    windowEnd: string
    rules: readonly AnomalyRule[]
  }
) {
  const { data, error } = await client
    .from('siteforge_telemetry_events')
    .select(
      'artifact_id,event_type,session_id,lead_id,campaign,consent_state,occurred_at,page_path,payload,referrer'
    )
    .eq('org_id', input.orgId)
    .eq('property_id', input.propertyId)
    .eq('website_id', input.websiteId)
    .gte('occurred_at', input.windowStart)
    .lt('occurred_at', input.windowEnd)
  if (error) throw new Error(`Failed to load SiteForge telemetry: ${error.message}`)
  const { data: destinations, error: destinationError } = await client
    .from('siteforge_analytics_destinations')
    .select('id, destination_type, destination_identity, consent_mode')
    .eq('website_id', input.websiteId)
    .eq('enabled', true)
  if (destinationError) {
    throw new Error(`Failed to load analytics destinations: ${destinationError.message}`)
  }
  const funnels = aggregateArtifactFunnels(data || [])
  let proposals = 0
  let outcomes = 0
  for (const funnel of funnels) {
    const { data: baselineRow, error: baselineError } = funnel.artifactId
      ? await client
          .from('siteforge_funnel_snapshots')
          .select('metrics, window_end')
          .eq('website_id', input.websiteId)
          .eq('artifact_id', funnel.artifactId)
          .lte('window_end', input.windowStart)
          .order('window_end', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null }
    if (baselineError) {
      throw new Error(`Failed to load funnel baseline: ${baselineError.message}`)
    }
    const { error: snapshotError } = await client.from('siteforge_funnel_snapshots').upsert(
      {
        org_id: input.orgId,
        property_id: input.propertyId,
        website_id: input.websiteId,
        artifact_id: funnel.artifactId,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        metrics: funnel.metrics as unknown as Json,
      },
      { onConflict: 'website_id,artifact_id,window_start,window_end' }
    )
    if (snapshotError) throw new Error(`Failed to persist funnel snapshot: ${snapshotError.message}`)
    if (funnel.artifactId) {
      outcomes += await recordArtifactOutcomes(client, {
        propertyId: input.propertyId,
        websiteId: input.websiteId,
        artifactId: funnel.artifactId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        baselineMetrics: baselineRow?.metrics,
        metrics: funnel.metrics,
      })
    }
    for (const destination of destinations || []) {
      if (destination.destination_type !== 'webhook') continue
      await enqueueSiteForgeOutbox(client, {
        orgId: input.orgId,
        propertyId: input.propertyId,
        websiteId: input.websiteId,
        artifactId: funnel.artifactId || undefined,
        aggregateType: 'siteforge_funnel_snapshot',
        aggregateId: `${input.websiteId}:${funnel.artifactId || 'unattributed'}:${input.windowStart}`,
        eventType: 'analytics.webhook',
        idempotencyKey: hashSiteForgeContent({
          destinationId: destination.id,
          artifactId: funnel.artifactId,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
        }),
        payload: {
          destinationUrl: destination.destination_identity,
          body: {
            websiteId: input.websiteId,
            artifactId: funnel.artifactId,
            windowStart: input.windowStart,
            windowEnd: input.windowEnd,
            metrics: funnel.metrics,
          },
        },
        consentEvidence: {
          mode: destination.consent_mode,
          aggregateOnly: true,
        },
      })
    }
    for (const anomaly of evaluateAnomalyRules(funnel, input.rules)) {
      const { data: existing, error: existingError } = await client
        .from('siteforge_incidents')
        .select('id')
        .eq('website_id', input.websiteId)
        .eq('dedupe_key', anomaly.dedupeKey)
        .neq('status', 'resolved')
        .maybeSingle()
      if (existingError) throw new Error(`Failed to inspect incident proposals: ${existingError.message}`)
      if (existing) continue
      const { data: incident, error: incidentError } = await client
        .from('siteforge_incidents')
        .insert({
          org_id: input.orgId,
          property_id: input.propertyId,
          website_id: input.websiteId,
          artifact_id: funnel.artifactId,
          dedupe_key: anomaly.dedupeKey,
          severity: anomaly.severity,
          category: anomaly.category,
          title: anomaly.title,
          summary: anomaly.summary,
          evidence: anomaly.evidence as unknown as Json,
        })
        .select('id')
        .single()
      if (incidentError || !incident) {
        if (incidentError?.code === '23505') continue
        throw new Error(`Failed to persist incident proposal: ${incidentError?.message}`)
      }
      await client.from('siteforge_incident_events').insert({
        incident_id: incident.id,
        event_type: 'proposed',
        payload: anomaly.evidence as unknown as Json,
      })
      proposals += 1
    }
  }
  return { artifacts: funnels.length, proposals, outcomes }
}

type FunnelMetrics = ReturnType<typeof aggregateArtifactFunnels>[number]['metrics']

function asMetrics(value: Json | undefined): Partial<FunnelMetrics> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<FunnelMetrics>)
    : {}
}

async function recordArtifactOutcomes(
  client: SupabaseClient<Database>,
  input: {
    propertyId: string
    websiteId: string
    artifactId: string
    windowStart: string
    windowEnd: string
    baselineMetrics?: Json
    metrics: FunnelMetrics
  }
) {
  const { data: release, error: releaseError } = await client
    .from('siteforge_launch_releases')
    .select('id, launch_action_attempt_id, release_version, promoted_at, live_at')
    .eq('website_id', input.websiteId)
    .eq('artifact_id', input.artifactId)
    .not('launch_action_attempt_id', 'is', null)
    .order('release_version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (releaseError) {
    throw new Error(`Failed to load outcome attribution action: ${releaseError.message}`)
  }
  if (!release?.launch_action_attempt_id) return 0

  const baseline = asMetrics(input.baselineMetrics)
  const measurements = [
    {
      kpiName: SITEFORGE_OUTCOME_KPIS[0],
      baseline: baseline.sessions,
      observed: input.metrics.sessions,
    },
    {
      kpiName: SITEFORGE_OUTCOME_KPIS[1],
      baseline: baseline.ctaConversionRate,
      observed: input.metrics.ctaConversionRate,
    },
    {
      kpiName: SITEFORGE_OUTCOME_KPIS[2],
      baseline: baseline.leadConversionRate,
      observed: input.metrics.leadConversionRate,
    },
    {
      kpiName: SITEFORGE_OUTCOME_KPIS[3],
      baseline: baseline.tourConversionRate,
      observed: input.metrics.tourConversionRate,
    },
  ] as const
  let recorded = 0
  for (const measurement of measurements) {
    const { data: existing, error: existingError } = await client
      .from('shared_experiment_outcomes')
      .select('id')
      .eq('action_attempt_id', release.launch_action_attempt_id)
      .eq('kpi_name', measurement.kpiName)
      .eq('measurement_window_start', input.windowStart)
      .eq('measurement_window_end', input.windowEnd)
      .maybeSingle()
    if (existingError) {
      throw new Error(`Failed to inspect delayed SiteForge outcomes: ${existingError.message}`)
    }
    if (existing) continue
    const baselineValue =
      typeof measurement.baseline === 'number' ? measurement.baseline : null
    const deltaValue =
      baselineValue === null ? null : measurement.observed - baselineValue
    await recordSharedOutcome(
      {
        propertyId: input.propertyId,
        actionAttemptId: release.launch_action_attempt_id,
        kpiName: measurement.kpiName,
        baselineValue,
        observedValue: measurement.observed,
        deltaValue,
        outcomeStatus:
          deltaValue === null
            ? 'unknown'
            : deltaValue > 0
              ? 'positive'
              : deltaValue < 0
                ? 'negative'
                : 'neutral',
        measurementWindowStart: input.windowStart,
        measurementWindowEnd: input.windowEnd,
        attributionPayload: {
          source: 'siteforge_funnel_snapshot',
          websiteId: input.websiteId,
          artifactId: input.artifactId,
          releaseId: release.id,
          releaseVersion: release.release_version,
          launchActionAttemptId: release.launch_action_attempt_id,
        },
      },
      client
    )
    recorded += 1
  }
  return recorded
}

function toRecord(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function campaignSource(event: FunnelEvent): string {
  const campaign = toRecord(event.campaign)
  const source =
    typeof campaign.source === 'string'
      ? campaign.source
      : typeof campaign.utm_source === 'string'
        ? campaign.utm_source
        : null
  if (source) return source
  if (!event.referrer) return 'direct'
  try {
    return new URL(event.referrer).hostname
  } catch {
    return 'unknown'
  }
}

export async function buildSiteForgeOwnershipReport(
  client: SupabaseClient<Database>,
  input: {
    orgId: string
    propertyId: string
    websiteId: string
    windowStart: string
    windowEnd: string
  }
) {
  const [
    websiteResult,
    eventsResult,
    snapshotsResult,
    incidentsResult,
    healthResult,
    connectorsResult,
    destinationsResult,
    subscriptionsResult,
    outcomesResult,
  ] = await Promise.all([
    client
      .from('property_websites')
      .select(
        'id, production_artifact_id, production_content_hash, production_url, production_certified_at'
      )
      .eq('id', input.websiteId)
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .single(),
    client
      .from('siteforge_telemetry_events')
      .select(
        'artifact_id,event_type,session_id,lead_id,campaign,consent_state,occurred_at,page_path,payload,referrer'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId)
      .gte('occurred_at', input.windowStart)
      .lt('occurred_at', input.windowEnd)
      .order('occurred_at', { ascending: true })
      .limit(10_000),
    client
      .from('siteforge_funnel_snapshots')
      .select('artifact_id, metrics, window_start, window_end, computed_at')
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId)
      .order('window_end', { ascending: false })
      .limit(500),
    client
      .from('siteforge_incidents')
      .select(
        'id, artifact_id, category, severity, status, title, summary, evidence, owner_id, created_at, updated_at, resolved_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId)
      .order('created_at', { ascending: false })
      .limit(100),
    client
      .from('siteforge_health_runs')
      .select('id, artifact_id, status, trigger_type, checks, evidence, started_at, completed_at')
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId)
      .order('started_at', { ascending: false })
      .limit(20),
    client
      .from('siteforge_connector_configs')
      .select(
        'id, capability, provider, status, freshness_seconds, last_success_at, last_error, updated_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId),
    client
      .from('siteforge_analytics_destinations')
      .select(
        'id, destination_type, destination_identity, consent_mode, enabled, updated_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId),
    client
      .from('siteforge_report_subscriptions')
      .select(
        'id, recipient_email, cadence, status, report_config, last_sent_at, next_send_at, created_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .eq('website_id', input.websiteId)
      .order('created_at', { ascending: false }),
    client
      .from('shared_experiment_outcomes')
      .select(
        'id, action_attempt_id, kpi_name, baseline_value, observed_value, delta_value, outcome_status, measurement_window_start, measurement_window_end, attribution_payload, measured_at'
      )
      .eq('org_id', input.orgId)
      .eq('property_id', input.propertyId)
      .in('kpi_name', [...SITEFORGE_OUTCOME_KPIS])
      .order('measured_at', { ascending: false })
      .limit(500),
  ])
  const firstError = [
    websiteResult,
    eventsResult,
    snapshotsResult,
    incidentsResult,
    healthResult,
    connectorsResult,
    destinationsResult,
    subscriptionsResult,
    outcomesResult,
  ].find(result => result.error)?.error
  if (firstError || !websiteResult.data) {
    throw new Error(
      `Failed to build SiteForge ownership report: ${
        firstError?.message || 'website not found'
      }`
    )
  }

  const events = eventsResult.data || []
  const funnels = aggregateArtifactFunnels(events)
  const sessionGroups = new Map<string, typeof events>()
  for (const event of events) {
    sessionGroups.set(event.session_id, [
      ...(sessionGroups.get(event.session_id) || []),
      event,
    ])
  }
  const sessions = [...sessionGroups.entries()].map(([sessionId, rows]) => ({
    sessionId,
    artifactId: rows.find(row => row.artifact_id)?.artifact_id || null,
    entryPath: rows.find(row => row.event_type === 'page_view')?.page_path || null,
    source: campaignSource(rows[0]),
    eventCount: rows.length,
    cta: rows.some(row => row.event_type === 'cta_click'),
    lead: rows.some(row => row.event_type === 'lead_submit'),
    tour: rows.some(row => row.event_type === 'tour_booked'),
    consentStates: [...new Set(rows.map(row => row.consent_state || 'unknown'))],
  }))
  const attributionMap = new Map<
    string,
    { sessions: Set<string>; leads: Set<string>; tours: Set<string> }
  >()
  for (const event of events) {
    const source = campaignSource(event)
    const group = attributionMap.get(source) || {
      sessions: new Set<string>(),
      leads: new Set<string>(),
      tours: new Set<string>(),
    }
    group.sessions.add(event.session_id)
    if (event.event_type === 'lead_submit') group.leads.add(event.session_id)
    if (event.event_type === 'tour_booked') group.tours.add(event.session_id)
    attributionMap.set(source, group)
  }
  const attribution = [...attributionMap.entries()].map(([source, group]) => ({
    source,
    sessions: group.sessions.size,
    leads: group.leads.size,
    tours: group.tours.size,
  }))
  const snapshots = snapshotsResult.data || []
  const latestByArtifact = new Map<string, (typeof snapshots)[number]>()
  const earliestByArtifact = new Map<string, (typeof snapshots)[number]>()
  for (const snapshot of snapshots) {
    const key = snapshot.artifact_id || 'unattributed'
    if (!latestByArtifact.has(key)) latestByArtifact.set(key, snapshot)
    earliestByArtifact.set(key, snapshot)
  }
  const versions = [...latestByArtifact.entries()].map(([artifactKey, latest]) => {
    const baseline = earliestByArtifact.get(artifactKey) || latest
    const currentMetrics = asMetrics(latest.metrics)
    const baselineMetrics = asMetrics(baseline.metrics)
    return {
      artifactId: artifactKey === 'unattributed' ? null : artifactKey,
      baseline: {
        windowStart: baseline.window_start,
        windowEnd: baseline.window_end,
        metrics: baselineMetrics,
      },
      current: {
        windowStart: latest.window_start,
        windowEnd: latest.window_end,
        metrics: currentMetrics,
      },
      delta: {
        sessions: (currentMetrics.sessions || 0) - (baselineMetrics.sessions || 0),
        ctaConversionRate:
          (currentMetrics.ctaConversionRate || 0) -
          (baselineMetrics.ctaConversionRate || 0),
        leadConversionRate:
          (currentMetrics.leadConversionRate || 0) -
          (baselineMetrics.leadConversionRate || 0),
        tourConversionRate:
          (currentMetrics.tourConversionRate || 0) -
          (baselineMetrics.tourConversionRate || 0),
      },
    }
  })
  const noPageView = sessions.filter(session => session.entryPath === null).length
  const consentGapEvents = events.filter(event =>
    ['unknown', 'denied', 'unset'].includes(event.consent_state || 'unknown')
  ).length
  const unattributedEvents = events.filter(event => !event.artifact_id).length
  const noEnabledDestinations = !(destinationsResult.data || []).some(
    destination => destination.enabled
  )
  const openIncidents = (incidentsResult.data || []).filter(
    incident => incident.status !== 'resolved'
  )
  const recommendations = [
    ...(consentGapEvents
      ? ['Resolve consent-state gaps before relying on conversion attribution.']
      : []),
    ...(noPageView
      ? ['Restore page-view instrumentation for sessions with downstream events.']
      : []),
    ...(unattributedEvents
      ? ['Bind unattributed telemetry to the promoted artifact identity.']
      : []),
    ...(noEnabledDestinations
      ? ['Configure an enabled analytics destination with an explicit consent mode.']
      : []),
    ...(openIncidents.length
      ? ['Acknowledge open incidents and recheck before requesting safe repair.']
      : []),
  ]

  return {
    generatedAt: new Date().toISOString(),
    window: { start: input.windowStart, end: input.windowEnd },
    website: websiteResult.data,
    funnels,
    sessions,
    attribution,
    versions,
    launchBaseline:
      versions.find(
        version =>
          version.artifactId === websiteResult.data.production_artifact_id
      )?.baseline || null,
    freshness: {
      latestHealthCompletedAt: healthResult.data?.[0]?.completed_at || null,
      connectors: connectorsResult.data || [],
    },
    instrumentation: {
      destinations: destinationsResult.data || [],
    },
    gaps: {
      consentGapEvents,
      sessionsWithoutPageView: noPageView,
      unattributedEvents,
      noTelemetry: events.length === 0,
      noEnabledDestinations,
    },
    incidents: incidentsResult.data || [],
    healthRuns: healthResult.data || [],
    outcomes: (outcomesResult.data || []).filter(
      outcome =>
        toRecord(outcome.attribution_payload).websiteId === input.websiteId
    ),
    recommendations,
    subscriptions: subscriptionsResult.data || [],
  }
}

export function siteForgeReportCsv(
  report: Awaited<ReturnType<typeof buildSiteForgeOwnershipReport>>
) {
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const lines = [
    ['artifact_id', 'sessions', 'cta_rate', 'lead_rate', 'tour_rate'],
    ...report.funnels.map(funnel => [
      funnel.artifactId || '',
      funnel.metrics.sessions,
      funnel.metrics.ctaConversionRate,
      funnel.metrics.leadConversionRate,
      funnel.metrics.tourConversionRate,
    ]),
  ]
  return lines.map(line => line.map(quote).join(',')).join('\n')
}

export type SiteForgeOwnershipReport = Awaited<
  ReturnType<typeof buildSiteForgeOwnershipReport>
>
