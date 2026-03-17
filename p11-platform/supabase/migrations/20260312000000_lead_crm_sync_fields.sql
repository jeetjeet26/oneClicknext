-- Add CRM sync status fields used by lead automation and monitoring.

alter table leads
  add column if not exists external_crm_id text,
  add column if not exists crm_sync_status text default 'pending',
  add column if not exists crm_synced_at timestamptz,
  add column if not exists crm_sync_error text;

create index if not exists idx_leads_crm_sync_status
  on leads(crm_sync_status);

create index if not exists idx_leads_external_crm_id
  on leads(external_crm_id)
  where external_crm_id is not null;

comment on column leads.external_crm_id is 'External CRM record id linked to this lead when sync succeeds or matches an existing CRM lead.';
comment on column leads.crm_sync_status is 'CRM sync state for this lead: pending, created, linked, skipped, or failed.';
comment on column leads.crm_synced_at is 'Timestamp of the most recent CRM sync attempt.';
comment on column leads.crm_sync_error is 'Most recent CRM sync error message for diagnostics.';
