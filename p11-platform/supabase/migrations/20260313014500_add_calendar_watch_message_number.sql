alter table agent_calendars
  add column if not exists watch_last_message_number bigint;

comment on column agent_calendars.watch_last_message_number is 'Last accepted Google Calendar webhook message number for idempotent push processing';
