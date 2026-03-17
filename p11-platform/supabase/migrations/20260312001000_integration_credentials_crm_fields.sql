-- Expand integration_credentials to support provider-specific CRM platforms
-- and persisted CRM field-mapping metadata used by the app and data engine.

alter table integration_credentials
  add column if not exists field_mapping jsonb default '{}'::jsonb,
  add column if not exists mapping_validated boolean default false;

alter table integration_credentials
  drop constraint if exists integration_credentials_platform_check;

alter table integration_credentials
  add constraint integration_credentials_platform_check
  check (platform in (
    'google_analytics',
    'google_search_console',
    'google_tag_manager',
    'google_ads',
    'google_business_profile',
    'meta_ads',
    'linkedin_ads',
    'tiktok_ads',
    'email_marketing',
    'crm',
    'pms',
    'yardi',
    'realpage',
    'salesforce',
    'hubspot'
  ));

comment on column integration_credentials.field_mapping is 'CRM/PMS field mapping configuration persisted after schema discovery and operator edits.';
comment on column integration_credentials.mapping_validated is 'Whether the current CRM/PMS field mapping has been validated successfully.';
