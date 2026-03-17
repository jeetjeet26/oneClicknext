-- Schema-truth alignment: analytics metric goals table.
-- This table is used by /api/analytics/goals routes.

create table if not exists public.metric_goals (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  metric_key text not null,
  goal_type text not null default 'monthly',
  target_value numeric not null,
  is_inverse boolean not null default false,
  alert_threshold_percent numeric not null default 80,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint metric_goals_metric_key_check
    check (metric_key in ('spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpa')),
  constraint metric_goals_goal_type_check
    check (goal_type in ('daily', 'weekly', 'monthly'))
);

create unique index if not exists idx_metric_goals_unique_active
  on public.metric_goals(property_id, metric_key, goal_type);

create index if not exists idx_metric_goals_property
  on public.metric_goals(property_id);

create index if not exists idx_metric_goals_active
  on public.metric_goals(is_active)
  where is_active = true;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at_timestamp') then
    if not exists (
      select 1 from pg_trigger where tgname = 'set_metric_goals_updated_at'
    ) then
      create trigger set_metric_goals_updated_at
      before update on public.metric_goals
      for each row execute function public.set_updated_at_timestamp();
    end if;
  end if;
end
$$;
