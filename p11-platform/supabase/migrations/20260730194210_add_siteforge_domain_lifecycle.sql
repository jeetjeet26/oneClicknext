alter table public.property_websites
  add column if not exists target_domain text,
  add column if not exists domain_status text not null default 'not_configured',
  add column if not exists ssl_status text not null default 'not_configured',
  add column if not exists dns_record_id text,
  add column if not exists domain_configured_at timestamptz;

alter table public.property_websites
  drop constraint if exists property_websites_domain_status_check,
  drop constraint if exists property_websites_ssl_status_check,
  drop constraint if exists property_websites_target_domain_check;

alter table public.property_websites
  add constraint property_websites_domain_status_check
    check (domain_status in ('not_configured', 'pending_dns', 'dns_ready', 'attached', 'failed')),
  add constraint property_websites_ssl_status_check
    check (ssl_status in ('not_configured', 'pending', 'active', 'failed')),
  add constraint property_websites_target_domain_check
    check (
      target_domain is null
      or target_domain ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
    );

comment on column public.property_websites.target_domain is
  'Operator-approved production domain; never attached before temporary URL verification succeeds.';
