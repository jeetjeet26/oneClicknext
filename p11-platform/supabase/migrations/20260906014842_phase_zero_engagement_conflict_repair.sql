-- PostgREST's on_conflict=property_id,idempotency_key cannot infer a partial index.
-- Normal unique indexes already allow multiple NULL keys, preserving unkeyed events.
-- Create the replacement before dropping the old index so uniqueness is never lost.
create unique index lead_engagement_events_property_id_idempotency_key_idx
  on public.lead_engagement_events (property_id, idempotency_key);
drop index if exists public.lead_engagement_events_idempotency_idx;
