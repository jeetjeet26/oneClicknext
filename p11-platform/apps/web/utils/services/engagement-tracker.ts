/**
 * Engagement Tracker
 * Lightweight helper to track lead engagement events directly via Supabase
 * (avoids HTTP overhead of calling the /api/leadpulse/events route)
 */

import { createServiceClient } from '@/utils/supabase/admin'

export type EventType =
  | 'chat_started'
  | 'chat_message_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'sms_replied'
  | 'tour_scheduled'
  | 'tour_completed'
  | 'tour_no_show'
  | 'application_started'
  | 'application_submitted'
  | 'document_viewed'
  | 'price_check'
  | 'unit_favorited'
  | 'repeat_visit'
  | 'call_inbound'
  | 'call_outbound_answered'

const EVENT_WEIGHTS: Record<EventType, number> = {
  chat_started: 5,
  chat_message_sent: 3,
  email_opened: 8,
  email_clicked: 15,
  sms_replied: 20,
  tour_scheduled: 25,
  tour_completed: 35,
  tour_no_show: -25,
  application_started: 30,
  application_submitted: 40,
  document_viewed: 10,
  price_check: 12,
  unit_favorited: 15,
  repeat_visit: 10,
  call_inbound: 20,
  call_outbound_answered: 18,
}

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

  const { error } = await supabase
    .from('lead_engagement_events')
    .insert({
      lead_id: leadId,
      property_id: propertyId,
      event_type: eventType,
      metadata: metadata || {},
      score_weight: EVENT_WEIGHTS[eventType],
    })

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
