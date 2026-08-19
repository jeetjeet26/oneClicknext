import { createHash, createHmac } from 'node:crypto'
import { createServiceClient } from '@/utils/supabase/admin'
import type { Json } from '@/types/supabase'

export type AttributionEventType =
  | 'landing_view'
  | 'lead'
  | 'tour_booked'
  | 'tour_completed'
  | 'lease'

const KPI_BY_EVENT: Record<AttributionEventType, string> = {
  landing_view: 'social_attributed_landing_views',
  lead: 'social_attributed_leads',
  tour_booked: 'social_attributed_tours_booked',
  tour_completed: 'social_attributed_tours_completed',
  lease: 'social_attributed_leases',
}

function attributionSecret(): string {
  const secret = process.env.ATTRIBUTION_HASH_SECRET || process.env.CRON_SECRET
  if (!secret) throw new Error('ATTRIBUTION_HASH_SECRET is required')
  return secret
}

function anonymousHash(subject: string): string {
  return createHmac('sha256', attributionSecret()).update(subject).digest('hex')
}

function fingerprint(input: {
  publicationId: string
  eventType: AttributionEventType
  subjectHash: string
  occurredAt: string
}): string {
  const hourBucket = input.occurredAt.slice(0, 13)
  return createHash('sha256')
    .update(`${input.publicationId}:${input.eventType}:${input.subjectHash}:${hourBucket}`)
    .digest('hex')
}

export async function recordAttributionEvent(input: {
  trackingToken: string
  eventType: AttributionEventType
  anonymousSubject: string
  occurredAt?: string
  attributionWindowDays?: number
  metadata?: Record<string, unknown>
}): Promise<{ recorded: boolean; publicationId: string }> {
  const supabase = createServiceClient()
  const { data: publication, error } = await supabase
    .from('social_publications')
    .select('id, org_id, property_id, shared_job_id, shared_action_attempt_id, published_at, scheduled_for')
    .eq('tracking_token', input.trackingToken)
    .single()
  if (error || !publication) throw new Error('Tracking token not found')

  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const attributionWindowDays = Math.min(Math.max(input.attributionWindowDays ?? 30, 1), 90)
  const originTime = Date.parse(publication.published_at ?? publication.scheduled_for)
  if (
    Number.isNaN(originTime) ||
    Date.parse(occurredAt) > originTime + attributionWindowDays * 86_400_000
  ) {
    throw new Error('Attribution event is outside the configured measurement window')
  }
  const subjectHash = anonymousHash(input.anonymousSubject)
  const eventFingerprint = fingerprint({
    publicationId: publication.id,
    eventType: input.eventType,
    subjectHash,
    occurredAt,
  })
  const { error: insertError } = await supabase
    .from('social_attribution_events')
    .insert({
      publication_id: publication.id,
      action_attempt_id: publication.shared_action_attempt_id,
      org_id: publication.org_id,
      property_id: publication.property_id,
      event_type: input.eventType,
      anonymous_subject_hash: subjectHash,
      event_fingerprint: eventFingerprint,
      occurred_at: occurredAt,
      attribution_window_days: attributionWindowDays,
      metadata: (input.metadata ?? {}) as Json,
    })
  if (insertError && insertError.code !== '23505') {
    throw new Error(`Failed to record attribution event: ${insertError.message}`)
  }

  if (
    !insertError &&
    publication.shared_action_attempt_id &&
    publication.shared_job_id
  ) {
    const kpiName = KPI_BY_EVENT[input.eventType]
    const { count } = await supabase
      .from('social_attribution_events')
      .select('*', { count: 'exact', head: true })
      .eq('publication_id', publication.id)
      .eq('event_type', input.eventType)
    const observedValue = count ?? 0
    const { data: existing } = await supabase
      .from('shared_experiment_outcomes')
      .select('id')
      .eq('action_attempt_id', publication.shared_action_attempt_id)
      .eq('kpi_name', kpiName)
      .limit(1)
      .maybeSingle()
    const measuredAt = new Date().toISOString()
    const values = {
      observed_value: observedValue,
      outcome_status: observedValue > 0 ? 'positive' : 'unknown',
      measurement_window_start: publication.published_at ?? publication.scheduled_for,
      measurement_window_end: measuredAt,
      attribution_payload: {
        publicationId: publication.id,
        eventType: input.eventType,
        method: 'tracking_token_last_touch',
        attributionWindowDays,
      } as Json,
      measured_at: measuredAt,
    }
    if (existing) {
      await supabase.from('shared_experiment_outcomes').update(values).eq('id', existing.id)
    } else {
      await supabase.from('shared_experiment_outcomes').insert({
        ...values,
        org_id: publication.org_id,
        property_id: publication.property_id,
        job_id: publication.shared_job_id,
        action_attempt_id: publication.shared_action_attempt_id,
        kpi_name: kpiName,
      })
    }
  }

  return { recorded: !insertError, publicationId: publication.id }
}
