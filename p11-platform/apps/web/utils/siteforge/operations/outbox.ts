import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/supabase'

export type OutboxEvent =
  Database['public']['Tables']['siteforge_outbox_events']['Row']
export type OutboxHandlerResult = {
  provider?: string
  providerRequestId?: string
  providerResponse?: Json
}
export type OutboxHandler = (
  event: OutboxEvent,
  context: { idempotencyKey: string; attempt: number }
) => Promise<OutboxHandlerResult>

export class PermanentOutboxError extends Error {}

export class SiteForgeOutboxRegistry {
  private readonly handlers = new Map<string, OutboxHandler>()

  register(eventType: string, version: string, handler: OutboxHandler): this {
    const key = `${eventType}:${version}`
    if (this.handlers.has(key)) throw new Error(`Outbox handler already registered: ${key}`)
    this.handlers.set(key, handler)
    return this
  }

  resolve(event: Pick<OutboxEvent, 'event_type' | 'handler_version'>) {
    return this.handlers.get(`${event.event_type}:${event.handler_version}`)
  }
}

export interface EnqueueSiteForgeEvent {
  orgId: string
  propertyId?: string
  websiteId?: string
  artifactId?: string
  aggregateType: string
  aggregateId: string
  eventType: string
  handlerVersion?: string
  idempotencyKey: string
  payload?: Json
  attribution?: Json
  consentEvidence?: Json
  maxAttempts?: number
  availableAt?: string
}

export async function enqueueSiteForgeOutbox(
  client: SupabaseClient<Database>,
  input: EnqueueSiteForgeEvent
): Promise<OutboxEvent> {
  const { data, error } = await client
    .from('siteforge_outbox_events')
    .upsert(
      {
        org_id: input.orgId,
        property_id: input.propertyId || null,
        website_id: input.websiteId || null,
        artifact_id: input.artifactId || null,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        event_type: input.eventType,
        handler_version: input.handlerVersion || 'v1',
        idempotency_key: input.idempotencyKey,
        payload: input.payload || {},
        attribution: input.attribution || {},
        consent_evidence: input.consentEvidence || {},
        max_attempts: input.maxAttempts || 8,
        available_at: input.availableAt || new Date().toISOString(),
      },
      { onConflict: 'org_id,event_type,idempotency_key', ignoreDuplicates: true }
    )
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`Failed to enqueue SiteForge outbox event: ${error.message}`)
  if (data) return data
  const { data: existing, error: existingError } = await client
    .from('siteforge_outbox_events')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('event_type', input.eventType)
    .eq('idempotency_key', input.idempotencyKey)
    .single()
  if (existingError || !existing) {
    throw new Error(`Failed to converge SiteForge outbox enqueue: ${existingError?.message}`)
  }
  return existing
}

function retryAt(attempt: number, now: Date): string {
  const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, attempt - 1))
  return new Date(now.getTime() + delaySeconds * 1000).toISOString()
}

async function settleEvent(
  client: SupabaseClient<Database>,
  event: OutboxEvent,
  workerId: string,
  status: 'delivered' | 'retrying' | 'dead_lettered',
  error: string | null,
  now: Date
) {
  const update: Database['public']['Tables']['siteforge_outbox_events']['Update'] = {
    status,
    last_error: error,
    lease_owner: null,
    lease_expires_at: null,
    updated_at: now.toISOString(),
  }
  if (status === 'delivered') update.delivered_at = now.toISOString()
  if (status === 'retrying') update.available_at = retryAt(event.attempts, now)
  const { error: updateError } = await client
    .from('siteforge_outbox_events')
    .update(update)
    .eq('id', event.id)
    .eq('lease_owner', workerId)
    .eq('status', 'processing')
  if (updateError) throw new Error(`Failed to settle outbox event: ${updateError.message}`)
}

export async function processSiteForgeOutbox(
  client: SupabaseClient<Database>,
  registry: SiteForgeOutboxRegistry,
  options: { workerId: string; limit?: number; leaseSeconds?: number; now?: Date }
) {
  const now = options.now || new Date()
  await client
    .from('siteforge_outbox_events')
    .update({
      status: 'retrying',
      lease_owner: null,
      lease_expires_at: null,
      available_at: now.toISOString(),
      last_error: 'Worker lease expired before convergence',
    })
    .eq('status', 'processing')
    .lt('lease_expires_at', now.toISOString())

  const { data, error } = await client.rpc('claim_siteforge_outbox_events', {
    p_worker_id: options.workerId,
    p_limit: options.limit || 25,
    p_lease_seconds: options.leaseSeconds || 120,
  })
  if (error) throw new Error(`Failed to claim SiteForge outbox events: ${error.message}`)
  const summary = { claimed: data?.length || 0, delivered: 0, retried: 0, deadLettered: 0 }

  for (const event of data || []) {
    const handler = registry.resolve(event)
    const attemptStatus = handler ? 'started' : 'permanent_failure'
    const { error: attemptError } = await client.from('siteforge_outbox_attempts').upsert(
      {
        event_id: event.id,
        attempt_number: event.attempts,
        status: attemptStatus,
        error_message: handler ? null : 'No registered handler',
        finished_at: handler ? null : now.toISOString(),
      },
      { onConflict: 'event_id,attempt_number' }
    )
    if (attemptError) throw new Error(`Failed to record outbox attempt: ${attemptError.message}`)

    if (!handler) {
      await settleEvent(client, event, options.workerId, 'dead_lettered', 'No registered handler', now)
      summary.deadLettered += 1
      continue
    }
    try {
      const result = await handler(event, {
        idempotencyKey: event.idempotency_key,
        attempt: event.attempts,
      })
      await client
        .from('siteforge_outbox_attempts')
        .update({
          status: 'delivered',
          provider: result.provider || null,
          provider_request_id: result.providerRequestId || null,
          provider_response: result.providerResponse || null,
          finished_at: now.toISOString(),
        })
        .eq('event_id', event.id)
        .eq('attempt_number', event.attempts)
      await settleEvent(client, event, options.workerId, 'delivered', null, now)
      summary.delivered += 1
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Unknown handler failure'
      const permanent = caught instanceof PermanentOutboxError || event.attempts >= event.max_attempts
      await client
        .from('siteforge_outbox_attempts')
        .update({
          status: permanent ? 'permanent_failure' : 'retryable_failure',
          error_message: message,
          finished_at: now.toISOString(),
        })
        .eq('event_id', event.id)
        .eq('attempt_number', event.attempts)
      await settleEvent(
        client,
        event,
        options.workerId,
        permanent ? 'dead_lettered' : 'retrying',
        message,
        now
      )
      if (permanent) summary.deadLettered += 1
      else summary.retried += 1
    }
  }
  return summary
}
