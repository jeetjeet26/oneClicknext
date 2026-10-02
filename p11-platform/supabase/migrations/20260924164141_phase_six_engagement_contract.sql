-- The retained SiteForge lead handoff emits website_lead_submitted.
-- Preserve all existing production event types and add only this qualified type.
alter table public.lead_engagement_events drop constraint if exists lead_engagement_events_event_type_check;
alter table public.lead_engagement_events add constraint lead_engagement_events_event_type_check check(event_type in(
 'chat_started','chat_message_sent','website_lead_submitted','email_opened','email_clicked','sms_replied',
 'tour_scheduled','tour_completed','tour_no_show','application_started','application_submitted','document_viewed',
 'price_check','unit_favorited','repeat_visit','call_inbound','call_outbound_answered'));
notify pgrst,'reload schema';
