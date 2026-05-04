-- Repair live schema drift for objects already referenced by app routes/services.
-- These definitions mirror the earlier local migrations that were not present in
-- the currently connected Supabase project.

create or replace view public.brand_books
with (security_invoker = true) as
select
  id,
  property_id,
  coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce(section_2_positioning->'differentiators', '[]'::jsonb)
      )
    ),
    array[]::text[]
  ) as unique_selling_points,
  coalesce(
    section_3_target_audience->>'primary',
    conversation_summary->>'targetAudience'
  ) as target_audience,
  created_at
from public.property_brand_assets;

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

create table if not exists public.shared_context_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  source_domain text not null,
  source_ref text,
  context_hash text,
  context_payload jsonb not null default '{}'::jsonb,
  captured_by text not null default 'system',
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shared_context_snapshots_org_created_idx
  on public.shared_context_snapshots (org_id, created_at desc);

create index if not exists shared_context_snapshots_property_created_idx
  on public.shared_context_snapshots (property_id, created_at desc);

create table if not exists public.shared_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  domain text not null,
  subject_type text not null,
  subject_id text,
  lifecycle_status text not null default 'queued'
    check (lifecycle_status in ('queued', 'running', 'succeeded', 'failed', 'retrying', 'cancelled')),
  status_reason text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  context_snapshot_id uuid references public.shared_context_snapshots(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 0),
  queued_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists shared_jobs_org_domain_dedupe_idx
  on public.shared_jobs (org_id, domain, dedupe_key)
  where dedupe_key is not null;

create index if not exists shared_jobs_org_status_created_idx
  on public.shared_jobs (org_id, lifecycle_status, created_at desc);

create index if not exists shared_jobs_property_status_created_idx
  on public.shared_jobs (property_id, lifecycle_status, created_at desc);

create table if not exists public.shared_action_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.shared_jobs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  action_type text not null,
  lifecycle_status text not null default 'queued'
    check (lifecycle_status in ('queued', 'running', 'succeeded', 'failed', 'retrying', 'cancelled')),
  proposal_decision_status text not null default 'proposed'
    check (proposal_decision_status in ('proposed', 'approved', 'denied', 'modified')),
  execution_status text not null default 'queued',
  requested_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  request_payload jsonb not null default '{}'::jsonb,
  execution_payload jsonb not null default '{}'::jsonb,
  execution_result jsonb,
  policy_snapshot jsonb,
  rollback_metadata jsonb,
  confidence_score numeric(5,4),
  policy_reason text,
  proposed_at timestamptz not null default timezone('utc', now()),
  decided_at timestamptz,
  executed_at timestamptz,
  reversed_at timestamptz,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.shared_action_attempts
  drop constraint if exists shared_action_attempts_execution_status_check;

alter table public.shared_action_attempts
  add constraint shared_action_attempts_execution_status_check
  check (
    execution_status in (
      'queued',
      'pending_approval',
      'approved_pending_execution',
      'executing',
      'executed',
      'failed',
      'cancelled',
      'reversed'
    )
  );

create index if not exists shared_action_attempts_job_created_idx
  on public.shared_action_attempts (job_id, created_at desc);

create index if not exists shared_action_attempts_org_lifecycle_created_idx
  on public.shared_action_attempts (org_id, lifecycle_status, created_at desc);

create index if not exists shared_action_attempts_org_execution_created_idx
  on public.shared_action_attempts (org_id, execution_status, created_at desc);

create table if not exists public.shared_approvals (
  id uuid primary key default gen_random_uuid(),
  action_attempt_id uuid not null references public.shared_action_attempts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  decision_status text not null
    check (decision_status in ('approved', 'denied', 'modified')),
  decision_reason text not null,
  reviewer_profile_id uuid references public.profiles(id) on delete set null,
  decision_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shared_approvals_action_created_idx
  on public.shared_approvals (action_attempt_id, created_at desc);

create index if not exists shared_approvals_org_created_idx
  on public.shared_approvals (org_id, created_at desc);

create table if not exists public.shared_policy_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  job_id uuid references public.shared_jobs(id) on delete set null,
  action_attempt_id uuid references public.shared_action_attempts(id) on delete set null,
  policy_name text not null,
  policy_version text,
  decision_status text not null
    check (decision_status in ('approved', 'denied', 'modified')),
  decision_reason text not null,
  confidence_score numeric(5,4),
  decision_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shared_policy_decisions_org_created_idx
  on public.shared_policy_decisions (org_id, created_at desc);

create index if not exists shared_policy_decisions_action_created_idx
  on public.shared_policy_decisions (action_attempt_id, created_at desc);

create table if not exists public.shared_experiment_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  job_id uuid references public.shared_jobs(id) on delete set null,
  action_attempt_id uuid references public.shared_action_attempts(id) on delete set null,
  kpi_name text not null,
  baseline_value numeric,
  observed_value numeric,
  delta_value numeric,
  outcome_status text not null default 'unknown'
    check (outcome_status in ('unknown', 'positive', 'neutral', 'negative')),
  measurement_window_start timestamptz,
  measurement_window_end timestamptz,
  attribution_payload jsonb not null default '{}'::jsonb,
  measured_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists shared_experiment_outcomes_org_kpi_measured_idx
  on public.shared_experiment_outcomes (org_id, kpi_name, measured_at desc);

create index if not exists shared_experiment_outcomes_action_measured_idx
  on public.shared_experiment_outcomes (action_attempt_id, measured_at desc);

alter table public.shared_context_snapshots enable row level security;
alter table public.shared_jobs enable row level security;
alter table public.shared_action_attempts enable row level security;
alter table public.shared_approvals enable row level security;
alter table public.shared_policy_decisions enable row level security;
alter table public.shared_experiment_outcomes enable row level security;
