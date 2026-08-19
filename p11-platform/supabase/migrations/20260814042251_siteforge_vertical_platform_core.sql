-- SiteForge Vertical Platform V2: tenant-bound subjects, immutable vertical
-- profiles, generic offerings/availability, and generic policy versions.

alter table public.properties
  add column if not exists subject_kind text;

update public.properties
set subject_kind = 'real_estate_property'
where subject_kind is null;

alter table public.properties
  alter column subject_kind set default 'real_estate_property',
  alter column subject_kind set not null,
  drop constraint if exists properties_subject_kind_check;

alter table public.properties
  add constraint properties_subject_kind_check
  check (subject_kind in (
    'real_estate_property',
    'real_estate_development',
    'real_estate_portfolio',
    'business_location',
    'other'
  ));

create unique index if not exists properties_tenant_identity_idx
  on public.properties (id, org_id);

create table if not exists public.property_subject_relationships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  subject_property_id uuid not null,
  related_property_id uuid not null,
  relationship_kind text not null
    check (relationship_kind in (
      'parent',
      'child',
      'portfolio_member',
      'development_phase',
      'operated_with',
      'related'
    )),
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  relationship_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(relationship_metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz,
  constraint property_subject_relationships_distinct_check
    check (subject_property_id <> related_property_id),
  constraint property_subject_relationships_subject_tenant_fkey
    foreign key (subject_property_id, org_id)
    references public.properties(id, org_id)
    on delete cascade,
  constraint property_subject_relationships_related_tenant_fkey
    foreign key (related_property_id, org_id)
    references public.properties(id, org_id)
    on delete cascade,
  unique (org_id, subject_property_id, related_property_id, relationship_kind)
);

create index if not exists property_subject_relationships_subject_idx
  on public.property_subject_relationships
  (org_id, subject_property_id, status, relationship_kind);
create index if not exists property_subject_relationships_related_idx
  on public.property_subject_relationships
  (org_id, related_property_id, status, relationship_kind);

create table if not exists public.property_vertical_profile_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  version integer not null check (version > 0),
  subject_kind text not null
    check (subject_kind in (
      'real_estate_property',
      'real_estate_development',
      'real_estate_portfolio',
      'business_location',
      'other'
    )),
  vertical_key text not null check (vertical_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  mapping_status text not null default 'confirmed'
    check (mapping_status in ('confirmed', 'needs_review')),
  mapping_reason text,
  vertical_pack_key text not null
    check (vertical_pack_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  vertical_pack_version integer not null check (vertical_pack_version > 0),
  vertical_pack_content_hash text not null
    check (vertical_pack_content_hash ~ '^[a-f0-9]{64}$'),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint property_vertical_profile_property_tenant_fkey
    foreign key (property_id, org_id)
    references public.properties(id, org_id)
    on delete cascade,
  unique (property_id, version),
  unique (property_id, content_hash)
);

create unique index if not exists property_vertical_profiles_tenant_identity_idx
  on public.property_vertical_profile_versions (id, org_id, property_id);
create index if not exists property_vertical_profiles_current_lookup_idx
  on public.property_vertical_profile_versions
  (org_id, property_id, version desc);
create index if not exists property_vertical_profiles_review_idx
  on public.property_vertical_profile_versions
  (org_id, mapping_status, created_at desc);

alter table public.properties
  add column if not exists current_vertical_profile_version_id uuid;

alter table public.properties
  drop constraint if exists properties_current_vertical_profile_tenant_fkey;

alter table public.properties
  add constraint properties_current_vertical_profile_tenant_fkey
  foreign key (current_vertical_profile_version_id, org_id, id)
  references public.property_vertical_profile_versions(id, org_id, property_id)
  on delete restrict;

create index if not exists properties_current_vertical_profile_idx
  on public.properties (current_vertical_profile_version_id)
  where current_vertical_profile_version_id is not null;

create table if not exists public.property_offerings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  offering_key text not null check (offering_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  offering_kind text not null check (offering_kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'inactive', 'archived')),
  current_version_id uuid,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint property_offerings_property_tenant_fkey
    foreign key (property_id, org_id)
    references public.properties(id, org_id)
    on delete cascade,
  unique (property_id, offering_key)
);

create unique index if not exists property_offerings_tenant_identity_idx
  on public.property_offerings (id, org_id, property_id);
create index if not exists property_offerings_property_status_idx
  on public.property_offerings (org_id, property_id, status, offering_kind);

create table if not exists public.property_offering_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  offering_id uuid not null,
  version integer not null check (version > 0),
  offering jsonb not null check (jsonb_typeof(offering) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  source_kind text not null default 'operator'
    check (source_kind in ('legacy', 'operator', 'provider', 'import', 'system')),
  source_identity text,
  effective_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint property_offering_versions_offering_tenant_fkey
    foreign key (offering_id, org_id, property_id)
    references public.property_offerings(id, org_id, property_id)
    on delete cascade,
  constraint property_offering_versions_effective_window_check
    check (expires_at is null or effective_at is null or expires_at > effective_at),
  unique (offering_id, version),
  unique (offering_id, content_hash)
);

create unique index if not exists property_offering_versions_tenant_identity_idx
  on public.property_offering_versions (id, org_id, property_id, offering_id);
create index if not exists property_offering_versions_property_idx
  on public.property_offering_versions
  (org_id, property_id, offering_id, version desc);

alter table public.property_offerings
  drop constraint if exists property_offerings_current_version_tenant_fkey;

alter table public.property_offerings
  add constraint property_offerings_current_version_tenant_fkey
  foreign key (current_version_id, org_id, property_id, id)
  references public.property_offering_versions(id, org_id, property_id, offering_id)
  on delete restrict;

create table if not exists public.property_availability_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  offering_id uuid not null,
  offering_version_id uuid not null,
  observed_at timestamptz not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  availability jsonb not null check (jsonb_typeof(availability) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  source_kind text not null
    check (source_kind in ('legacy', 'operator', 'provider', 'import', 'system')),
  source_identity text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint property_availability_offering_tenant_fkey
    foreign key (offering_id, org_id, property_id)
    references public.property_offerings(id, org_id, property_id)
    on delete cascade,
  constraint property_availability_version_tenant_fkey
    foreign key (offering_version_id, org_id, property_id, offering_id)
    references public.property_offering_versions(id, org_id, property_id, offering_id)
    on delete restrict,
  constraint property_availability_effective_window_check
    check (expires_at is null or expires_at > effective_at),
  unique (offering_id, source_identity, observed_at, content_hash)
);

create unique index if not exists property_availability_tenant_identity_idx
  on public.property_availability_snapshots (id, org_id, property_id, offering_id);
create index if not exists property_availability_current_idx
  on public.property_availability_snapshots
  (org_id, property_id, offering_id, effective_at desc);

create table if not exists public.property_policy_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  policy_key text not null check (policy_key ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  policy_kind text not null check (policy_kind ~ '^[a-z][a-z0-9_]{1,63}$'),
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded', 'revoked')),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz,
  expires_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint property_policy_versions_property_tenant_fkey
    foreign key (property_id, org_id)
    references public.properties(id, org_id)
    on delete cascade,
  constraint property_policy_versions_effective_window_check
    check (expires_at is null or effective_at is null or expires_at > effective_at),
  constraint property_policy_versions_approval_check
    check (
      status <> 'approved'
      or (approved_by is not null and approved_at is not null)
    ),
  unique (property_id, policy_key, version),
  unique (property_id, policy_key, content_hash)
);

create unique index if not exists property_policy_versions_tenant_identity_idx
  on public.property_policy_versions (id, org_id, property_id);
create index if not exists property_policy_versions_current_idx
  on public.property_policy_versions
  (org_id, property_id, policy_key, version desc);

-- Existing property_type remains a compatibility projection. The initial
-- profile version records the mapping decision without changing any prior JSON.
with legacy_profiles as (
  select
    properties.id as property_id,
    properties.org_id,
    properties.subject_kind,
    properties.property_type,
    case properties.property_type
      when 'multifamily' then 'multifamily_residential'
      when 'senior' then 'senior_living'
      when 'student' then 'student_housing'
      when 'affordable' then 'affordable_housing'
      when 'townhome' then 'townhome_community'
      when 'condo' then 'condominium_community'
      when 'single_family' then 'single_family_community'
      when 'master_planned' then 'master_planned_community'
      when 'mixed_use' then 'mixed_use'
      else 'residential'
    end as vertical_key,
    case
      when properties.property_type in (
        'multifamily', 'senior', 'student', 'affordable', 'townhome',
        'condo', 'single_family', 'master_planned'
      ) then 'confirmed'
      else 'needs_review'
    end as mapping_status,
    case
      when properties.property_type = 'mixed_use'
        then 'Legacy mixed_use does not identify the primary offering or operating model.'
      when properties.property_type = 'luxury'
        then 'Legacy luxury is a market position, not an unambiguous vertical.'
      when properties.property_type is null
        then 'Legacy property type is missing.'
      else 'Deterministic legacy property type mapping.'
    end as mapping_reason
  from public.properties
  where properties.org_id is not null
    and not exists (
      select 1
      from public.property_vertical_profile_versions existing
      where existing.property_id = properties.id
    )
),
profile_payloads as (
  select
    legacy_profiles.*,
    jsonb_build_object(
      'schemaVersion', 2,
      'source', 'legacy_property_type',
      'legacyPropertyType', property_type,
      'subjectKind', subject_kind,
      'verticalKey', vertical_key,
      'mappingStatus', mapping_status
    ) as profile,
    jsonb_build_object(
      'packKey', 'siteforge.real_estate.' || vertical_key,
      'packVersion', 1
    ) as pack_identity
  from legacy_profiles
)
insert into public.property_vertical_profile_versions (
  org_id,
  property_id,
  version,
  subject_kind,
  vertical_key,
  mapping_status,
  mapping_reason,
  vertical_pack_key,
  vertical_pack_version,
  vertical_pack_content_hash,
  profile,
  content_hash
)
select
  org_id,
  property_id,
  1,
  subject_kind,
  vertical_key,
  mapping_status,
  mapping_reason,
  pack_identity ->> 'packKey',
  1,
  encode(extensions.digest(convert_to(pack_identity::text, 'UTF8'), 'sha256'), 'hex'),
  profile,
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schemaVersion', 2,
          'profile', profile,
          'mappingStatus', mapping_status,
          'mappingReason', mapping_reason,
          'verticalPack', pack_identity
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
from profile_payloads
on conflict do nothing;

update public.properties properties
set current_vertical_profile_version_id = (
  select versions.id
  from public.property_vertical_profile_versions versions
  where versions.property_id = properties.id
    and versions.org_id = properties.org_id
  order by versions.version desc
  limit 1
)
where properties.current_vertical_profile_version_id is null
  and exists (
    select 1
    from public.property_vertical_profile_versions versions
    where versions.property_id = properties.id
      and versions.org_id = properties.org_id
  );

create or replace function public.reject_vertical_immutable_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

revoke all on function public.reject_vertical_immutable_mutation()
  from public, anon, authenticated;

drop trigger if exists property_vertical_profiles_immutable
  on public.property_vertical_profile_versions;
create trigger property_vertical_profiles_immutable
  before update or delete on public.property_vertical_profile_versions
  for each row execute function public.reject_vertical_immutable_mutation();

drop trigger if exists property_offering_versions_immutable
  on public.property_offering_versions;
create trigger property_offering_versions_immutable
  before update or delete on public.property_offering_versions
  for each row execute function public.reject_vertical_immutable_mutation();

drop trigger if exists property_availability_snapshots_immutable
  on public.property_availability_snapshots;
create trigger property_availability_snapshots_immutable
  before update or delete on public.property_availability_snapshots
  for each row execute function public.reject_vertical_immutable_mutation();

drop trigger if exists property_policy_versions_immutable
  on public.property_policy_versions;
create trigger property_policy_versions_immutable
  before update or delete on public.property_policy_versions
  for each row execute function public.reject_vertical_immutable_mutation();

alter table public.property_subject_relationships enable row level security;
alter table public.property_vertical_profile_versions enable row level security;
alter table public.property_offerings enable row level security;
alter table public.property_offering_versions enable row level security;
alter table public.property_availability_snapshots enable row level security;
alter table public.property_policy_versions enable row level security;

create policy "Users view their org subject relationships"
  on public.property_subject_relationships for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Users view their org vertical profiles"
  on public.property_vertical_profile_versions for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Users view their org property offerings"
  on public.property_offerings for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Users view their org offering versions"
  on public.property_offering_versions for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Users view their org availability snapshots"
  on public.property_availability_snapshots for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Users view their org property policies"
  on public.property_policy_versions for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));

create policy "Service role manages subject relationships"
  on public.property_subject_relationships for all to service_role
  using (true) with check (true);
create policy "Service role creates vertical profiles"
  on public.property_vertical_profile_versions for insert to service_role
  with check (true);
create policy "Service role manages property offerings"
  on public.property_offerings for all to service_role
  using (true) with check (true);
create policy "Service role creates offering versions"
  on public.property_offering_versions for insert to service_role
  with check (true);
create policy "Service role creates availability snapshots"
  on public.property_availability_snapshots for insert to service_role
  with check (true);
create policy "Service role creates property policies"
  on public.property_policy_versions for insert to service_role
  with check (true);

revoke all on table
  public.property_subject_relationships,
  public.property_vertical_profile_versions,
  public.property_offerings,
  public.property_offering_versions,
  public.property_availability_snapshots,
  public.property_policy_versions
from anon, authenticated;

grant select on table
  public.property_subject_relationships,
  public.property_vertical_profile_versions,
  public.property_offerings,
  public.property_offering_versions,
  public.property_availability_snapshots,
  public.property_policy_versions
to authenticated;

grant all on table
  public.property_subject_relationships,
  public.property_vertical_profile_versions,
  public.property_offerings,
  public.property_offering_versions,
  public.property_availability_snapshots,
  public.property_policy_versions
to service_role;

comment on column public.properties.property_type is
  'Legacy real-estate intake projection retained for compatibility. Vertical Platform V2 uses the current immutable vertical profile.';
comment on column public.properties.subject_kind is
  'Stable subject classification used before selecting a vertical profile or pack.';
comment on table public.property_vertical_profile_versions is
  'Append-only tenant-bound vertical profile and pack identities. Ambiguous legacy mappings remain needs_review.';
comment on table public.property_offerings is
  'Stable generic offering identities for a property subject.';
comment on table public.property_offering_versions is
  'Append-only generic offering definitions independent of a specific real-estate vertical.';
comment on table public.property_availability_snapshots is
  'Append-only point-in-time availability facts bound to an exact offering version.';
comment on table public.property_policy_versions is
  'Append-only generic policy definitions for a property subject.';
