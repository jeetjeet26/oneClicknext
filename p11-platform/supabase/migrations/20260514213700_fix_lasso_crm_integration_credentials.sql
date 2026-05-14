-- Keep CRM integration persistence compatible with provider-specific platforms.
-- This is idempotent so hosted environments that already have part of the
-- schema can safely receive the reconciliation.

alter table public.integration_credentials
  add column if not exists field_mapping jsonb default '{}'::jsonb,
  add column if not exists mapping_validated boolean default false,
  add column if not exists mapping_validated_at timestamptz;

alter table public.integration_credentials
  drop constraint if exists integration_credentials_platform_check;

alter table public.integration_credentials
  add constraint integration_credentials_platform_check
  check (platform = any (array[
    'google_analytics'::text,
    'google_search_console'::text,
    'google_tag_manager'::text,
    'google_ads'::text,
    'google_business_profile'::text,
    'meta_ads'::text,
    'linkedin_ads'::text,
    'tiktok_ads'::text,
    'email_marketing'::text,
    'crm'::text,
    'pms'::text,
    'yardi'::text,
    'realpage'::text,
    'salesforce'::text,
    'hubspot'::text,
    'lasso'::text
  ]));

comment on column public.integration_credentials.field_mapping is 'CRM/PMS field mapping configuration persisted after schema discovery and operator edits.';
comment on column public.integration_credentials.mapping_validated is 'Whether the current CRM/PMS field mapping has been validated successfully.';
comment on column public.integration_credentials.mapping_validated_at is 'Timestamp when the current CRM/PMS field mapping was validated successfully.';
