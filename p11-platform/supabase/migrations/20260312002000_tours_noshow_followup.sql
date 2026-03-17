-- Add no-show follow-up tracking for legacy tours workflow automation.

alter table tours
  add column if not exists noshow_followup_sent_at timestamptz;

create index if not exists idx_tours_noshow_followup
  on tours(status, noshow_followup_sent_at)
  where status = 'no_show';

comment on column tours.noshow_followup_sent_at is 'Timestamp when the automated no-show follow-up was first sent for this tour.';
