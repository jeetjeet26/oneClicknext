create table if not exists public.cron_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('running', 'success', 'failed')),
  trigger_source text not null default 'cron',
  request_id text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  duration_ms integer,
  summary jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists cron_job_runs_job_name_started_at_idx
  on public.cron_job_runs (job_name, started_at desc);

create index if not exists cron_job_runs_status_started_at_idx
  on public.cron_job_runs (status, started_at desc);

alter table public.cron_job_runs enable row level security;
