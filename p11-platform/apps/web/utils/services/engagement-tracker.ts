/**
 * Engagement Tracker
 * Lightweight helper to track lead engagement events directly via Supabase
 * (avoids HTTP overhead of calling the /api/leadpulse/events route)
 */

import { createServiceClient } from '@/utils/supabase/admin'
import type { Database, Json } from '@/types/supabase'
import { EVENT_WEIGHTS, type EventType } from './leadpulse-events'

interface TrackEventParams {
  leadId: string
  propertyId: string
  eventType: EventType
  metadata?: Record<string, unknown>
}

/**
 * Track an engagement event and rescore the lead.
 * Non-blocking — callers should .catch() errors.
 */
export async function trackEngagementEvent({
  leadId,
  propertyId,
  eventType,
  metadata,
}: TrackEventParams): Promise<void> {
  const supabase = createServiceClient()
  const payload: Database['public']['Tables']['lead_engagement_events']['Insert'] = {
    lead_id: leadId,
    property_id: propertyId,
    event_type: eventType,
    metadata: ((metadata || {}) as Json),
    score_weight: EVENT_WEIGHTS[eventType],
  }

  const { error } = await supabase
    .from('lead_engagement_events')
    .insert(payload)

  if (error) {
    console.error(`[EngagementTracker] Failed to insert ${eventType} for lead ${leadId}:`, error)
    return
  }

  // Rescore the lead after new event
  const { error: scoreError } = await supabase
    .rpc('score_lead', { p_lead_id: leadId })

  if (scoreError) {
    console.error(`[EngagementTracker] Failed to rescore lead ${leadId}:`, scoreError)
  }
}
