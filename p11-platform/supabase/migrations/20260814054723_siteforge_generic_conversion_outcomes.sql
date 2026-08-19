-- SiteForge Vertical Platform V2: immutable conversion intent contracts,
-- entity-aware receipts, and append-only online/offline outcome evidence.

create table if not exists public.siteforge_conversion_intent_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  website_id uuid not null,
  version integer not null check (version > 0),
  intent_key text not null
    check (intent_key in (
      'inquiry',
      'tour',
      'visit',
      'private_appointment',
      'apply',
      'register_interest',
      'waitlist',
      'pricing_availability_request',
      'brochure_request',
      'broker_registration',
      'sales_inquiry',
      'commercial_leasing_inquiry',
      'rfp',
      'professional_referral',
      'directions',
      'external_booking'
    )),
  offering_kind text,
  provider_key text not null check (nullif(btrim(provider_key), '') is not null),
  fallback_intent_key text,
  field_schema jsonb not null check (jsonb_typeof(field_schema) = 'object'),
  sensitivity text not null
    check (sensitivity in ('none', 'contact', 'regulated')),
  consent_requirement text not null
    check (consent_requirement in ('none', 'privacy_notice', 'explicit')),
  success_event text not null check (nullif(btrim(success_event), '') is not null),
  offline_outcome_key text,
  policy jsonb not null default '{}'::jsonb check (jsonb_typeof(policy) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_conversion_intent_website_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade,
  unique (website_id, intent_key, version),
  unique (website_id, intent_key, content_hash)
);

create unique index if not exists siteforge_conversion_intent_tenant_identity_idx
  on public.siteforge_conversion_intent_versions
  (id, org_id, property_id, website_id);
create index if not exists siteforge_conversion_intent_current_idx
  on public.siteforge_conversion_intent_versions
  (org_id, property_id, website_id, intent_key, version desc);

alter table public.siteforge_conversion_submissions
  add column if not exists intent_version_id uuid,
  add column if not exists intent_key text not null default 'inquiry',
  add column if not exists offering_id uuid,
  add column if not exists provider_key text not null default 'p11',
  add column if not exists sensitivity text not null default 'contact';

alter table public.siteforge_conversion_submissions
  drop constraint if exists siteforge_conversion_submissions_intent_key_check,
  add constraint siteforge_conversion_submissions_intent_key_check
    check (intent_key in (
      'inquiry',
      'tour',
      'visit',
      'private_appointment',
      'apply',
      'register_interest',
      'waitlist',
      'pricing_availability_request',
      'brochure_request',
      'broker_registration',
      'sales_inquiry',
      'commercial_leasing_inquiry',
      'rfp',
      'professional_referral',
      'directions',
      'external_booking'
    )),
  drop constraint if exists siteforge_conversion_submissions_sensitivity_check,
  add constraint siteforge_conversion_submissions_sensitivity_check
    check (sensitivity in ('none', 'contact', 'regulated')),
  drop constraint if exists siteforge_conversion_submission_intent_tenant_fkey,
  add constraint siteforge_conversion_submission_intent_tenant_fkey
    foreign key (intent_version_id, org_id, property_id, website_id)
    references public.siteforge_conversion_intent_versions
      (id, org_id, property_id, website_id)
    on delete restrict,
  drop constraint if exists siteforge_conversion_submission_offering_tenant_fkey,
  add constraint siteforge_conversion_submission_offering_tenant_fkey
    foreign key (offering_id, org_id, property_id)
    references public.property_offerings(id, org_id, property_id)
    on delete restrict;

create index if not exists siteforge_conversion_submissions_intent_idx
  on public.siteforge_conversion_submissions
  (org_id, property_id, intent_key, received_at desc);
create index if not exists siteforge_conversion_submissions_offering_idx
  on public.siteforge_conversion_submissions
  (offering_id, received_at desc)
  where offering_id is not null;
create unique index if not exists siteforge_conversion_submissions_tenant_identity_idx
  on public.siteforge_conversion_submissions
  (id, org_id, property_id, website_id);

create table if not exists public.siteforge_conversion_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  website_id uuid not null,
  submission_row_id uuid not null,
  intent_version_id uuid,
  offering_id uuid,
  outcome_key text not null check (outcome_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  source_kind text not null
    check (source_kind in ('online', 'provider', 'crm', 'offline', 'operator', 'import')),
  provider_key text,
  provider_outcome_id text,
  occurred_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_conversion_outcome_submission_tenant_fkey
    foreign key (submission_row_id, org_id, property_id, website_id)
    references public.siteforge_conversion_submissions
      (id, org_id, property_id, website_id)
    on delete cascade,
  constraint siteforge_conversion_outcome_intent_tenant_fkey
    foreign key (intent_version_id, org_id, property_id, website_id)
    references public.siteforge_conversion_intent_versions
      (id, org_id, property_id, website_id)
    on delete restrict,
  constraint siteforge_conversion_outcome_offering_tenant_fkey
    foreign key (offering_id, org_id, property_id)
    references public.property_offerings(id, org_id, property_id)
    on delete restrict,
  unique (
    submission_row_id,
    outcome_key,
    source_kind,
    provider_outcome_id,
    content_hash
  )
);

create index if not exists siteforge_conversion_outcomes_property_idx
  on public.siteforge_conversion_outcomes
  (org_id, property_id, outcome_key, occurred_at desc);
create index if not exists siteforge_conversion_outcomes_submission_idx
  on public.siteforge_conversion_outcomes
  (submission_row_id, occurred_at desc);

create or replace function public.protect_siteforge_conversion_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.org_id is distinct from old.org_id
    or new.property_id is distinct from old.property_id
    or new.website_id is distinct from old.website_id
    or new.artifact_id is distinct from old.artifact_id
    or new.submission_id is distinct from old.submission_id
    or new.form_kind is distinct from old.form_kind
    or new.submission_payload is distinct from old.submission_payload
    or new.payload_hash is distinct from old.payload_hash
    or new.consent_state is distinct from old.consent_state
    or new.received_at is distinct from old.received_at
    or new.intent_version_id is distinct from old.intent_version_id
    or new.intent_key is distinct from old.intent_key
    or new.offering_id is distinct from old.offering_id
    or new.provider_key is distinct from old.provider_key
    or new.sensitivity is distinct from old.sensitivity
  then
    raise exception 'SiteForge conversion submission identity is immutable';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.protect_siteforge_conversion_identity()
  from public, anon, authenticated;

drop trigger if exists siteforge_conversion_intent_versions_immutable
  on public.siteforge_conversion_intent_versions;
create trigger siteforge_conversion_intent_versions_immutable
  before update or delete on public.siteforge_conversion_intent_versions
  for each row execute function public.reject_vertical_immutable_mutation();

drop trigger if exists siteforge_conversion_outcomes_immutable
  on public.siteforge_conversion_outcomes;
create trigger siteforge_conversion_outcomes_immutable
  before update or delete on public.siteforge_conversion_outcomes
  for each row execute function public.reject_vertical_immutable_mutation();

alter table public.siteforge_conversion_intent_versions enable row level security;
alter table public.siteforge_conversion_outcomes enable row level security;

create policy "Users view their org conversion intents"
  on public.siteforge_conversion_intent_versions for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Managers view their org conversion outcomes"
  on public.siteforge_conversion_outcomes for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role in ('admin', 'manager')
  ));
create policy "Service role creates conversion intents"
  on public.siteforge_conversion_intent_versions for insert to service_role
  with check (true);
create policy "Service role reads conversion intents"
  on public.siteforge_conversion_intent_versions for select to service_role
  using (true);
create policy "Service role creates conversion outcomes"
  on public.siteforge_conversion_outcomes for insert to service_role
  with check (true);
create policy "Service role reads conversion outcomes"
  on public.siteforge_conversion_outcomes for select to service_role
  using (true);

revoke all on table
  public.siteforge_conversion_intent_versions,
  public.siteforge_conversion_outcomes
from anon, authenticated;
grant select on table public.siteforge_conversion_intent_versions
  to authenticated;
grant select on table public.siteforge_conversion_outcomes
  to authenticated;
grant select, insert on table public.siteforge_conversion_intent_versions
  to service_role;
grant select, insert on table public.siteforge_conversion_outcomes
  to service_role;
