alter table agent_calendars
  add column if not exists watch_channel_id text,
  add column if not exists watch_resource_id text,
  add column if not exists watch_expiration timestamptz;

create index if not exists idx_agent_calendars_watch_channel_id
  on agent_calendars(watch_channel_id)
  where watch_channel_id is not null;

create index if not exists idx_agent_calendars_watch_resource_id
  on agent_calendars(watch_resource_id)
  where watch_resource_id is not null;

comment on column agent_calendars.watch_channel_id is 'Google Calendar webhook channel identifier for push notifications';
comment on column agent_calendars.watch_resource_id is 'Google Calendar webhook resource identifier paired with the channel';
comment on column agent_calendars.watch_expiration is 'Expiration time for the active Google Calendar webhook watch channel';
