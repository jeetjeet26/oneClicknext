-- Add reminder tracking columns for legacy tours reminders workflow.

alter table tours
  add column if not exists reminder_24h_sent_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

create index if not exists idx_tours_reminders
  on tours(tour_date, tour_time, status)
  where status = 'scheduled';

comment on column tours.reminder_24h_sent_at is 'Timestamp when the 24-hour reminder was sent for a legacy tours row.';
comment on column tours.reminder_sent_at is 'Timestamp when the 1-hour reminder was sent for a legacy tours row.';
