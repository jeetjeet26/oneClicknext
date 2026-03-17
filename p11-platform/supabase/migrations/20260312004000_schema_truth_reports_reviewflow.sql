-- Schema-truth alignment for reports + reviewflow config.
-- Brings database schema in line with currently shipped API/UI contracts.

-- ============================================================================
-- Scheduled reports tables
-- ============================================================================

create table if not exists public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid null references public.properties(id) on delete cascade,
  name text not null,
  schedule_type text not null check (schedule_type in ('daily', 'weekly', 'monthly')),
  day_of_week integer null check (day_of_week between 0 and 6),
  day_of_month integer null check (day_of_month between 1 and 28),
  hour_utc integer not null default 9 check (hour_utc between 0 and 23),
  recipients text[] not null default '{}',
  report_type text not null default 'performance' check (report_type in ('performance', 'leads', 'summary')),
  date_range_type text not null default 'previous_period'
    check (date_range_type in ('previous_period', 'last_7_days', 'last_30_days', 'month_to_date')),
  include_comparison boolean not null default true,
  include_campaigns boolean not null default true,
  is_active boolean not null default true,
  last_sent_at timestamptz null,
  next_run_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_reports_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null
);

create table if not exists public.report_send_history (
  id uuid primary key default gen_random_uuid(),
  scheduled_report_id uuid not null references public.scheduled_reports(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  recipients_count integer not null default 0,
  report_date_start date null,
  report_date_end date null,
  metrics_snapshot jsonb null,
  error_message text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_reports_org_id
  on public.scheduled_reports(org_id);
create index if not exists idx_scheduled_reports_property_id
  on public.scheduled_reports(property_id);
create index if not exists idx_scheduled_reports_next_run_at
  on public.scheduled_reports(next_run_at)
  where is_active = true;
create index if not exists idx_report_send_history_report_id
  on public.report_send_history(scheduled_report_id);
create index if not exists idx_report_send_history_created_at
  on public.report_send_history(created_at desc);

-- Keep updated_at current for both tables.
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_scheduled_reports_updated_at'
  ) then
    create trigger set_scheduled_reports_updated_at
    before update on public.scheduled_reports
    for each row execute function public.set_updated_at_timestamp();
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'set_report_send_history_updated_at'
  ) then
    create trigger set_report_send_history_updated_at
    before update on public.report_send_history
    for each row execute function public.set_updated_at_timestamp();
  end if;
end
$$;

-- ============================================================================
-- ReviewFlow config columns used by current API + UI
-- ============================================================================

alter table public.reviewflow_config
  add column if not exists default_tone text default 'professional',
  add column if not exists property_personality text,
  add column if not exists response_delay_minutes integer default 30,
  add column if not exists notify_on_negative boolean default true,
  add column if not exists notify_on_urgent boolean default true,
  add column if not exists poll_frequency_hours integer default 6,
  add column if not exists is_active boolean default false,
  add column if not exists slack_webhook_url text;

-- Backfill aliases from legacy columns where available.
update public.reviewflow_config
set default_tone = coalesce(default_tone, response_tone, 'professional')
where default_tone is null;

update public.reviewflow_config
set slack_webhook_url = coalesce(slack_webhook_url, notification_slack_webhook)
where slack_webhook_url is null and notification_slack_webhook is not null;
