import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'
import { hashSiteForgeContent } from '@/utils/siteforge/content-hash'
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
>

const FUNNEL_STEPS = [
  'page_view',
  'cta_click',
  'lead_start',
  'lead_submit',
  'tour_booked',
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
    .select('artifact_id,event_type,session_id,lead_id')
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
  for (const funnel of funnels) {
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
  return { artifacts: funnels.length, proposals }
}
