import { leadpulseRpc } from '@/utils/leadpulse/server'
import type { EventType } from './leadpulse-events'
interface TrackEventParams {
 leadId: string; propertyId: string; eventType: EventType; metadata?: Record<string, unknown>
 idempotencyKey: string; origin: 'siteforge' | 'lumaleasing'
}
/** One saved source identity records the event, score and private provenance atomically. */
export async function trackEngagementEvent({ leadId, propertyId, eventType, metadata, idempotencyKey, origin }: TrackEventParams): Promise<void> {
 const result = await leadpulseRpc('record_lead_engagement', { p_property_id: propertyId, p_lead_id: leadId, p_event_type: eventType,
  p_metadata: metadata || {}, p_request_key: idempotencyKey, p_origin: origin, p_actor_id: null })
 if (!['applied', 'replayed'].includes(String(result.state))) throw new Error('Engagement was not confirmed: ' + result.state)
}
