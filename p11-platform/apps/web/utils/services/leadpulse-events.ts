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

export const EVENT_WEIGHTS: Record<EventType, number> = {
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
