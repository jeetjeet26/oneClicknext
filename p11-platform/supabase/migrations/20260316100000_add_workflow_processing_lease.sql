alter table public.lead_workflows
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_expires_at timestamptz;

comment on column public.lead_workflows.processing_started_at is
  'When the current workflow step was claimed for processing by the workflow processor.';
comment on column public.lead_workflows.processing_expires_at is
  'Lease expiration for the claimed workflow step so overlapping processors do not send duplicate actions.';

create index if not exists idx_lead_workflows_processing_expires
  on public.lead_workflows (processing_expires_at)
  where status = 'active';

create unique index if not exists idx_lead_workflows_active_unique
  on public.lead_workflows (lead_id, workflow_id)
  where lead_id is not null
    and workflow_id is not null
    and status in ('active', 'paused');
