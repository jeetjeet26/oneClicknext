-- Reconcile live LumaLeasing schema for client launch.
--
-- Live oneClick database was missing four agent_calendars watch fields and
-- two tour_bookings completion fields that the LumaLeasing chat, calendar
-- webhook, calendar status, and tour recovery routes already reference. This
-- migration brings the live schema in line with the runtime expectations and
-- the generated Supabase types.

alter table agent_calendars
  add column if not exists watch_channel_id text,
  add column if not exists watch_resource_id text,
  add column if not exists watch_expiration timestamptz,
  add column if not exists watch_last_message_number bigint;

create index if not exists idx_agent_calendars_watch_channel_id
  on agent_calendars(watch_channel_id)
  where watch_channel_id is not null;

create index if not exists idx_agent_calendars_watch_resource_id
  on agent_calendars(watch_resource_id)
  where watch_resource_id is not null;

comment on column agent_calendars.watch_channel_id is 'Google Calendar webhook channel identifier for push notifications';
comment on column agent_calendars.watch_resource_id is 'Google Calendar webhook resource identifier paired with the channel';
comment on column agent_calendars.watch_expiration is 'Expiration time for the active Google Calendar webhook watch channel';
comment on column agent_calendars.watch_last_message_number is 'Last accepted Google Calendar webhook message number for idempotent push processing';

alter table tour_bookings
  add column if not exists completed_at timestamptz,
  add column if not exists completion_notes text;

comment on column tour_bookings.completed_at is 'Timestamp when a booked tour was marked completed.';
comment on column tour_bookings.completion_notes is 'Leasing team notes captured when marking a tour completed.';
