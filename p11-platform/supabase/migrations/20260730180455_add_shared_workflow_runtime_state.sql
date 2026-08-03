alter table public.shared_jobs
  add column if not exists workflow_run_id text,
  add column if not exists workflow_name text,
  add column if not exists stage text not null default 'queued',
  add column if not exists progress integer not null default 0,
  add column if not exists current_step text not null default 'Queued',
  add column if not exists retry_at timestamptz,
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists output jsonb,
  add column if not exists error_details jsonb;

alter table public.shared_jobs
  drop constraint if exists shared_jobs_progress_check;

alter table public.shared_jobs
  add constraint shared_jobs_progress_check
  check (progress between 0 and 100);

create unique index if not exists shared_jobs_workflow_run_idx
  on public.shared_jobs (workflow_run_id)
  where workflow_run_id is not null;

create index if not exists shared_jobs_domain_stage_created_idx
  on public.shared_jobs (domain, stage, created_at desc);

comment on column public.shared_jobs.workflow_run_id is
  'Workflow DevKit run identifier for durable execution and cancellation.';

comment on column public.shared_jobs.cancel_requested is
  'Cooperative cancellation signal checked before each durable workflow step.';
