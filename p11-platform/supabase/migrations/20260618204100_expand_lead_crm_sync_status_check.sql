alter table public.leads
  drop constraint if exists leads_crm_sync_status_check;

alter table public.leads
  add constraint leads_crm_sync_status_check
  check (
    crm_sync_status is null
    or crm_sync_status in (
      'pending',
      'retrying',
      'processing',
      'created',
      'linked',
      'failed',
      'skipped',
      'dead_lettered'
    )
  );

drop index if exists public.idx_leads_crm_sync_retry_queue;

create index if not exists idx_leads_crm_sync_retry_queue
  on public.leads (crm_sync_next_retry_at)
  where external_crm_id is null
    and crm_sync_status in ('pending', 'retrying', 'failed', 'processing');

comment on column public.leads.crm_sync_status is
  'CRM sync state for this lead: pending, retrying, processing, created, linked, skipped, failed, or dead_lettered.';
