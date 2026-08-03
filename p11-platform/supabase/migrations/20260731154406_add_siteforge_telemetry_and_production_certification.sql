-- Separate anonymous SiteForge telemetry from identified LeadPulse events and
-- record exact-artifact production certification after an operator-controlled
-- Cloudways promotion.

create table if not exists public.siteforge_telemetry_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  event_type text not null check (event_type in (
    'page_view',
    'cta_click',
    'floorplan_view',
    'availability_click',
    'lead_start',
    'lead_submit',
    'tour_start',
    'tour_booked'
  )),
  session_id text not null check (length(session_id) between 8 and 200),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  page_path text not null default '/',
  page_url text,
  referrer text,
  campaign jsonb not null default '{}'::jsonb,
  consent_state text not null default 'unknown'
    check (consent_state in ('unknown', 'denied', 'granted', 'not_required')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default timezone('utc', now()),
  received_at timestamptz not null default timezone('utc', now()),
  unique (website_id, idempotency_key)
);

create index if not exists siteforge_telemetry_website_time_idx
  on public.siteforge_telemetry_events (website_id, occurred_at desc);
create index if not exists siteforge_telemetry_property_type_idx
  on public.siteforge_telemetry_events (property_id, event_type, occurred_at desc);
create index if not exists siteforge_telemetry_attribution_idx
  on public.siteforge_telemetry_events (website_id, session_id, lead_id);

alter table public.siteforge_telemetry_events enable row level security;

drop policy if exists "Users view their org SiteForge telemetry"
  on public.siteforge_telemetry_events;
create policy "Users view their org SiteForge telemetry"
  on public.siteforge_telemetry_events for select
  using (exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_telemetry_events.org_id
  ));

drop policy if exists "Service role manages SiteForge telemetry"
  on public.siteforge_telemetry_events;
create policy "Service role manages SiteForge telemetry"
  on public.siteforge_telemetry_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.siteforge_telemetry_events to authenticated;
grant all on public.siteforge_telemetry_events to service_role;

alter table public.siteforge_wordpress_targets
  drop constraint if exists siteforge_wordpress_targets_target_type_check;
alter table public.siteforge_wordpress_targets
  add constraint siteforge_wordpress_targets_target_type_check
  check (target_type in ('canonical_preview', 'staging', 'production'));

alter table public.siteforge_wordpress_targets
  drop constraint if exists siteforge_wordpress_targets_protection_mode_check;
alter table public.siteforge_wordpress_targets
  add constraint siteforge_wordpress_targets_protection_mode_check
  check (protection_mode in ('noindex', 'password_noindex', 'public'));

alter table public.siteforge_artifact_deployments
  drop constraint if exists siteforge_artifact_deployments_status_check;
alter table public.siteforge_artifact_deployments
  add constraint siteforge_artifact_deployments_status_check
  check (status in (
    'queued',
    'deploying',
    'certifying',
    'ready',
    'production_certifying',
    'live',
    'failed',
    'superseded'
  ));

alter table public.property_websites
  add column if not exists production_target_id uuid
    references public.siteforge_wordpress_targets(id) on delete set null,
  add column if not exists production_artifact_id uuid
    references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists production_content_hash text,
  add column if not exists production_url text,
  add column if not exists production_certified_at timestamptz,
  add column if not exists production_certification_report jsonb,
  add column if not exists siteforge_public_key text
    default ('sfpk_' || encode(gen_random_bytes(24), 'hex'));

update public.property_websites
set siteforge_public_key = 'sfpk_' || encode(gen_random_bytes(24), 'hex')
where siteforge_public_key is null;

alter table public.property_websites
  alter column siteforge_public_key set not null;

create unique index if not exists property_websites_siteforge_public_key_idx
  on public.property_websites (siteforge_public_key);

alter table public.property_websites
  drop constraint if exists property_websites_editor_lifecycle_status_check;
alter table public.property_websites
  add constraint property_websites_editor_lifecycle_status_check
  check (editor_lifecycle_status in (
    'editing',
    'preview_ready',
    'approved_for_staging',
    'deploying_staging',
    'staging_ready',
    'certifying_production',
    'production_live'
  ));

comment on table public.siteforge_telemetry_events is
  'First-party anonymous SiteForge website telemetry. Identified engagement remains in lead_engagement_events.';
comment on column public.siteforge_telemetry_events.lead_id is
  'Optional explicit attribution join to an identified lead; no lead scoring occurs in this table.';
comment on column public.property_websites.production_artifact_id is
  'Exact immutable artifact independently certified at the public production URL after Cloudways promotion.';
