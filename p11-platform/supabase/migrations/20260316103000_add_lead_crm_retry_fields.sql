alter table public.leads
  add column if not exists crm_sync_retry_count integer not null default 0,
  add column if not exists crm_sync_next_retry_at timestamptz,
  add column if not exists crm_dead_lettered_at timestamptz;

create index if not exists idx_leads_crm_sync_retry_queue
  on public.leads (crm_sync_next_retry_at)
  where external_crm_id is null
    and crm_sync_status in ('pending', 'retrying', 'failed');

comment on column public.leads.crm_sync_retry_count is
  'Number of retryable CRM sync failures that have been recorded for this lead.';
comment on column public.leads.crm_sync_next_retry_at is
  'When the CRM retry processor should next attempt to sync this lead.';
comment on column public.leads.crm_dead_lettered_at is
  'When CRM sync retries were exhausted or a permanent provider failure dead-lettered this lead.';
comment on column public.leads.crm_sync_status is
  'CRM sync state for this lead: pending, retrying, created, linked, skipped, failed, or dead_lettered.';

update public.leads
set crm_sync_next_retry_at = coalesce(crm_synced_at, now())
where external_crm_id is null
  and crm_sync_status = 'failed'
  and crm_sync_next_retry_at is null;
