-- SiteForge Vertical Platform V2: pin exact vertical context into every
-- immutable generation stage, preserve public conversion submissions, and add
-- versioned launch policy plus append-only confirmation evidence.

create unique index if not exists property_vertical_profiles_hash_identity_idx
  on public.property_vertical_profile_versions
  (id, org_id, property_id, content_hash);
create unique index if not exists property_offering_versions_hash_identity_idx
  on public.property_offering_versions
  (id, org_id, property_id, content_hash);
create unique index if not exists property_availability_hash_identity_idx
  on public.property_availability_snapshots
  (id, org_id, property_id, content_hash);
create unique index if not exists property_policy_versions_hash_identity_idx
  on public.property_policy_versions
  (id, org_id, property_id, content_hash);
create unique index if not exists siteforge_plans_tenant_identity_idx
  on public.siteforge_plans (id, org_id, property_id);

alter table public.siteforge_plan_versions
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade;

update public.siteforge_plan_versions versions
set
  org_id = plans.org_id,
  property_id = plans.property_id
from public.siteforge_plans plans
where plans.id = versions.plan_id
  and (versions.org_id is null or versions.property_id is null);

alter table public.siteforge_plan_versions
  alter column org_id set not null,
  alter column property_id set not null;

create unique index if not exists siteforge_plan_versions_tenant_identity_idx
  on public.siteforge_plan_versions (id, org_id, property_id);

alter table public.siteforge_plan_versions
  drop constraint if exists siteforge_plan_versions_plan_tenant_fkey;
alter table public.siteforge_plan_versions
  add constraint siteforge_plan_versions_plan_tenant_fkey
  foreign key (plan_id, org_id, property_id)
  references public.siteforge_plans(id, org_id, property_id)
  on delete cascade;

alter table public.property_onboarding_snapshots
  add column if not exists vertical_profile_version_id uuid,
  add column if not exists vertical_profile_content_hash text,
  add column if not exists vertical_pack_key text,
  add column if not exists vertical_pack_version integer,
  add column if not exists vertical_pack_content_hash text,
  add column if not exists offering_version_id uuid,
  add column if not exists offering_content_hash text,
  add column if not exists availability_snapshot_id uuid,
  add column if not exists availability_content_hash text,
  add column if not exists policy_version_id uuid,
  add column if not exists policy_content_hash text;

alter table public.siteforge_brief_versions
  add column if not exists vertical_profile_version_id uuid,
  add column if not exists vertical_profile_content_hash text,
  add column if not exists vertical_pack_key text,
  add column if not exists vertical_pack_version integer,
  add column if not exists vertical_pack_content_hash text,
  add column if not exists offering_version_id uuid,
  add column if not exists offering_content_hash text,
  add column if not exists availability_snapshot_id uuid,
  add column if not exists availability_content_hash text,
  add column if not exists policy_version_id uuid,
  add column if not exists policy_content_hash text;

alter table public.siteforge_plan_versions
  add column if not exists vertical_profile_version_id uuid,
  add column if not exists vertical_profile_content_hash text,
  add column if not exists vertical_pack_key text,
  add column if not exists vertical_pack_version integer,
  add column if not exists vertical_pack_content_hash text,
  add column if not exists offering_version_id uuid,
  add column if not exists offering_content_hash text,
  add column if not exists availability_snapshot_id uuid,
  add column if not exists availability_content_hash text,
  add column if not exists policy_version_id uuid,
  add column if not exists policy_content_hash text;

alter table public.siteforge_blueprint_versions
  add column if not exists vertical_profile_version_id uuid,
  add column if not exists vertical_profile_content_hash text,
  add column if not exists vertical_pack_key text,
  add column if not exists vertical_pack_version integer,
  add column if not exists vertical_pack_content_hash text,
  add column if not exists offering_version_id uuid,
  add column if not exists offering_content_hash text,
  add column if not exists availability_snapshot_id uuid,
  add column if not exists availability_content_hash text,
  add column if not exists policy_version_id uuid,
  add column if not exists policy_content_hash text;

do $$
declare
  target_table regclass;
  target_name text;
begin
  foreach target_name in array array[
    'property_onboarding_snapshots',
    'siteforge_brief_versions',
    'siteforge_plan_versions',
    'siteforge_blueprint_versions'
  ]
  loop
    target_table := format('public.%I', target_name)::regclass;

    execute format(
      'alter table %s add constraint %I check (
        (vertical_profile_version_id is null) = (vertical_profile_content_hash is null)
        and (offering_version_id is null) = (offering_content_hash is null)
        and (availability_snapshot_id is null) = (availability_content_hash is null)
        and (policy_version_id is null) = (policy_content_hash is null)
        and (
          (vertical_pack_key is null and vertical_pack_version is null and vertical_pack_content_hash is null)
          or (
            vertical_pack_key is not null
            and vertical_pack_key ~ ''^[a-z][a-z0-9_.-]{1,127}$''
            and vertical_pack_version > 0
            and vertical_pack_content_hash ~ ''^[a-f0-9]{64}$''
          )
        )
        and (
          vertical_profile_content_hash is null
          or vertical_profile_content_hash ~ ''^[a-f0-9]{64}$''
        )
        and (
          offering_content_hash is null
          or offering_content_hash ~ ''^[a-f0-9]{64}$''
        )
        and (
          availability_content_hash is null
          or availability_content_hash ~ ''^[a-f0-9]{64}$''
        )
        and (
          policy_content_hash is null
          or policy_content_hash ~ ''^[a-f0-9]{64}$''
        )
      )',
      target_table,
      target_name || '_vertical_identity_check'
    );
  end loop;
end;
$$;

alter table public.property_onboarding_snapshots
  add constraint property_onboarding_vertical_profile_tenant_fkey
    foreign key (
      vertical_profile_version_id,
      org_id,
      property_id,
      vertical_profile_content_hash
    )
    references public.property_vertical_profile_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint property_onboarding_offering_tenant_fkey
    foreign key (
      offering_version_id,
      org_id,
      property_id,
      offering_content_hash
    )
    references public.property_offering_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint property_onboarding_availability_tenant_fkey
    foreign key (
      availability_snapshot_id,
      org_id,
      property_id,
      availability_content_hash
    )
    references public.property_availability_snapshots
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint property_onboarding_policy_tenant_fkey
    foreign key (
      policy_version_id,
      org_id,
      property_id,
      policy_content_hash
    )
    references public.property_policy_versions
      (id, org_id, property_id, content_hash)
    on delete restrict;

alter table public.siteforge_brief_versions
  add constraint siteforge_briefs_vertical_profile_tenant_fkey
    foreign key (
      vertical_profile_version_id,
      org_id,
      property_id,
      vertical_profile_content_hash
    )
    references public.property_vertical_profile_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_briefs_offering_tenant_fkey
    foreign key (
      offering_version_id,
      org_id,
      property_id,
      offering_content_hash
    )
    references public.property_offering_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_briefs_availability_tenant_fkey
    foreign key (
      availability_snapshot_id,
      org_id,
      property_id,
      availability_content_hash
    )
    references public.property_availability_snapshots
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_briefs_policy_tenant_fkey
    foreign key (
      policy_version_id,
      org_id,
      property_id,
      policy_content_hash
    )
    references public.property_policy_versions
      (id, org_id, property_id, content_hash)
    on delete restrict;

alter table public.siteforge_plan_versions
  add constraint siteforge_plans_vertical_profile_tenant_fkey
    foreign key (
      vertical_profile_version_id,
      org_id,
      property_id,
      vertical_profile_content_hash
    )
    references public.property_vertical_profile_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_plans_offering_tenant_fkey
    foreign key (
      offering_version_id,
      org_id,
      property_id,
      offering_content_hash
    )
    references public.property_offering_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_plans_availability_tenant_fkey
    foreign key (
      availability_snapshot_id,
      org_id,
      property_id,
      availability_content_hash
    )
    references public.property_availability_snapshots
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_plans_policy_tenant_fkey
    foreign key (
      policy_version_id,
      org_id,
      property_id,
      policy_content_hash
    )
    references public.property_policy_versions
      (id, org_id, property_id, content_hash)
    on delete restrict;

alter table public.siteforge_blueprint_versions
  add constraint siteforge_blueprints_vertical_profile_tenant_fkey
    foreign key (
      vertical_profile_version_id,
      org_id,
      property_id,
      vertical_profile_content_hash
    )
    references public.property_vertical_profile_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_blueprints_offering_tenant_fkey
    foreign key (
      offering_version_id,
      org_id,
      property_id,
      offering_content_hash
    )
    references public.property_offering_versions
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_blueprints_availability_tenant_fkey
    foreign key (
      availability_snapshot_id,
      org_id,
      property_id,
      availability_content_hash
    )
    references public.property_availability_snapshots
      (id, org_id, property_id, content_hash)
    on delete restrict,
  add constraint siteforge_blueprints_policy_tenant_fkey
    foreign key (
      policy_version_id,
      org_id,
      property_id,
      policy_content_hash
    )
    references public.property_policy_versions
      (id, org_id, property_id, content_hash)
    on delete restrict;

create index if not exists property_onboarding_vertical_identity_idx
  on public.property_onboarding_snapshots
  (org_id, property_id, vertical_profile_version_id, created_at desc);
create index if not exists siteforge_briefs_vertical_identity_idx
  on public.siteforge_brief_versions
  (org_id, property_id, vertical_profile_version_id, created_at desc);
create index if not exists siteforge_plans_vertical_identity_idx
  on public.siteforge_plan_versions
  (org_id, property_id, vertical_profile_version_id, created_at desc);
create index if not exists siteforge_blueprints_vertical_identity_idx
  on public.siteforge_blueprint_versions
  (org_id, property_id, vertical_profile_version_id, created_at desc);

create or replace function public.sync_legacy_property_vertical_profile()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_vertical_key text;
  v_mapping_status text;
  v_mapping_reason text;
  v_pack_identity jsonb;
  v_profile jsonb;
  v_pack_hash text;
  v_profile_hash text;
  v_profile_id uuid;
  v_next_version integer;
begin
  if new.org_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.property_type is not distinct from old.property_type
    and new.subject_kind is not distinct from old.subject_kind
  then
    return new;
  end if;

  v_vertical_key := case new.property_type
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
  end;
  v_mapping_status := case
    when new.property_type in (
      'multifamily', 'senior', 'student', 'affordable', 'townhome',
      'condo', 'single_family', 'master_planned'
    ) then 'confirmed'
    else 'needs_review'
  end;
  v_mapping_reason := case
    when new.property_type = 'mixed_use'
      then 'Legacy mixed_use does not identify the primary offering or operating model.'
    when new.property_type = 'luxury'
      then 'Legacy luxury is a market position, not an unambiguous vertical.'
    when new.property_type is null
      then 'Legacy property type is missing.'
    else 'Deterministic legacy property type mapping.'
  end;
  v_pack_identity := jsonb_build_object(
    'packKey', 'siteforge.real_estate.' || v_vertical_key,
    'packVersion', 1
  );
  v_profile := jsonb_build_object(
    'schemaVersion', 2,
    'source', 'legacy_property_type',
    'legacyPropertyType', new.property_type,
    'subjectKind', new.subject_kind,
    'verticalKey', v_vertical_key,
    'mappingStatus', v_mapping_status
  );
  v_pack_hash := encode(
    extensions.digest(convert_to(v_pack_identity::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_profile_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schemaVersion', 2,
          'profile', v_profile,
          'mappingStatus', v_mapping_status,
          'mappingReason', v_mapping_reason,
          'verticalPack', v_pack_identity
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select versions.id
  into v_profile_id
  from public.property_vertical_profile_versions versions
  where versions.property_id = new.id
    and versions.content_hash = v_profile_hash;

  if v_profile_id is null then
    select coalesce(max(versions.version), 0) + 1
    into v_next_version
    from public.property_vertical_profile_versions versions
    where versions.property_id = new.id;

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
    values (
      new.org_id,
      new.id,
      v_next_version,
      new.subject_kind,
      v_vertical_key,
      v_mapping_status,
      v_mapping_reason,
      v_pack_identity ->> 'packKey',
      1,
      v_pack_hash,
      v_profile,
      v_profile_hash
    )
    returning id into v_profile_id;
  end if;

  update public.properties
  set current_vertical_profile_version_id = v_profile_id
  where id = new.id
    and current_vertical_profile_version_id is distinct from v_profile_id;

  return new;
end;
$$;

revoke all on function public.sync_legacy_property_vertical_profile()
  from public, anon, authenticated;

drop trigger if exists properties_sync_legacy_vertical_profile
  on public.properties;
create trigger properties_sync_legacy_vertical_profile
  after insert or update of property_type, subject_kind on public.properties
  for each row execute function public.sync_legacy_property_vertical_profile();

create or replace function public.bind_onboarding_vertical_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile public.property_vertical_profile_versions%rowtype;
  v_offering public.property_offering_versions%rowtype;
  v_availability public.property_availability_snapshots%rowtype;
  v_policy public.property_policy_versions%rowtype;
begin
  select profile.*
  into v_profile
  from public.properties property
  join public.property_vertical_profile_versions profile
    on profile.id = property.current_vertical_profile_version_id
   and profile.org_id = property.org_id
   and profile.property_id = property.id
  where property.id = new.property_id
    and property.org_id = new.org_id;

  if v_profile.id is null then
    raise exception 'A current vertical profile is required before onboarding';
  end if;
  if new.vertical_profile_version_id is not null
    and (
      new.vertical_profile_version_id <> v_profile.id
      or new.vertical_profile_content_hash <> v_profile.content_hash
    )
  then
    raise exception 'Onboarding vertical profile identity is stale';
  end if;

  new.vertical_profile_version_id := v_profile.id;
  new.vertical_profile_content_hash := v_profile.content_hash;
  new.vertical_pack_key := v_profile.vertical_pack_key;
  new.vertical_pack_version := v_profile.vertical_pack_version;
  new.vertical_pack_content_hash := v_profile.vertical_pack_content_hash;

  select version.*
  into v_offering
  from public.property_offerings offering
  join public.property_offering_versions version
    on version.id = offering.current_version_id
   and version.org_id = offering.org_id
   and version.property_id = offering.property_id
   and version.offering_id = offering.id
  where offering.org_id = new.org_id
    and offering.property_id = new.property_id
    and offering.status = 'active'
  order by (offering.offering_key = 'primary') desc, offering.offering_key
  limit 1;

  if v_offering.id is not null then
    new.offering_version_id := v_offering.id;
    new.offering_content_hash := v_offering.content_hash;

    select availability.*
    into v_availability
    from public.property_availability_snapshots availability
    where availability.org_id = new.org_id
      and availability.property_id = new.property_id
      and availability.offering_version_id = v_offering.id
      and availability.effective_at <= timezone('utc', now())
      and (
        availability.expires_at is null
        or availability.expires_at > timezone('utc', now())
      )
    order by availability.effective_at desc, availability.observed_at desc
    limit 1;

    if v_availability.id is not null then
      new.availability_snapshot_id := v_availability.id;
      new.availability_content_hash := v_availability.content_hash;
    end if;
  end if;

  select policy.*
  into v_policy
  from public.property_policy_versions policy
  where policy.org_id = new.org_id
    and policy.property_id = new.property_id
    and policy.status = 'approved'
    and (policy.effective_at is null or policy.effective_at <= timezone('utc', now()))
    and (policy.expires_at is null or policy.expires_at > timezone('utc', now()))
  order by (policy.policy_key = 'siteforge.primary') desc,
    policy.policy_key,
    policy.version desc
  limit 1;

  if v_policy.id is not null then
    new.policy_version_id := v_policy.id;
    new.policy_content_hash := v_policy.content_hash;
  end if;

  return new;
end;
$$;

revoke all on function public.bind_onboarding_vertical_identity()
  from public, anon, authenticated;

drop trigger if exists property_onboarding_bind_vertical_identity
  on public.property_onboarding_snapshots;
create trigger property_onboarding_bind_vertical_identity
  before insert on public.property_onboarding_snapshots
  for each row execute function public.bind_onboarding_vertical_identity();

create or replace function public.bind_siteforge_stage_vertical_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_onboarding public.property_onboarding_snapshots%rowtype;
begin
  if tg_table_name = 'siteforge_plan_versions' then
    select plans.org_id, plans.property_id
    into new.org_id, new.property_id
    from public.siteforge_plans plans
    where plans.id = new.plan_id;
  end if;

  select onboarding.*
  into v_onboarding
  from public.property_onboarding_snapshots onboarding
  where onboarding.id = new.onboarding_snapshot_id
    and onboarding.org_id = new.org_id
    and onboarding.property_id = new.property_id;

  if v_onboarding.id is null then
    raise exception '% requires a tenant-bound onboarding snapshot', tg_table_name;
  end if;
  if v_onboarding.vertical_profile_version_id is null then
    raise exception '% requires a Vertical Platform V2 onboarding snapshot', tg_table_name;
  end if;

  new.vertical_profile_version_id := v_onboarding.vertical_profile_version_id;
  new.vertical_profile_content_hash := v_onboarding.vertical_profile_content_hash;
  new.vertical_pack_key := v_onboarding.vertical_pack_key;
  new.vertical_pack_version := v_onboarding.vertical_pack_version;
  new.vertical_pack_content_hash := v_onboarding.vertical_pack_content_hash;
  new.offering_version_id := v_onboarding.offering_version_id;
  new.offering_content_hash := v_onboarding.offering_content_hash;
  new.availability_snapshot_id := v_onboarding.availability_snapshot_id;
  new.availability_content_hash := v_onboarding.availability_content_hash;
  new.policy_version_id := v_onboarding.policy_version_id;
  new.policy_content_hash := v_onboarding.policy_content_hash;
  return new;
end;
$$;

revoke all on function public.bind_siteforge_stage_vertical_identity()
  from public, anon, authenticated;

drop trigger if exists siteforge_briefs_bind_vertical_identity
  on public.siteforge_brief_versions;
create trigger siteforge_briefs_bind_vertical_identity
  before insert on public.siteforge_brief_versions
  for each row execute function public.bind_siteforge_stage_vertical_identity();

drop trigger if exists siteforge_plans_bind_vertical_identity
  on public.siteforge_plan_versions;
create trigger siteforge_plans_bind_vertical_identity
  before insert on public.siteforge_plan_versions
  for each row execute function public.bind_siteforge_stage_vertical_identity();

create or replace function public.bind_siteforge_blueprint_vertical_identity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_plan public.siteforge_plan_versions%rowtype;
begin
  if new.source_plan_version_id is null then
    return new;
  end if;

  select plan_version.*
  into v_plan
  from public.siteforge_plan_versions plan_version
  where plan_version.id = new.source_plan_version_id
    and plan_version.org_id = new.org_id
    and plan_version.property_id = new.property_id;

  if v_plan.id is null then
    raise exception 'Blueprint source plan is missing or outside the artifact tenant';
  end if;

  new.vertical_profile_version_id := v_plan.vertical_profile_version_id;
  new.vertical_profile_content_hash := v_plan.vertical_profile_content_hash;
  new.vertical_pack_key := v_plan.vertical_pack_key;
  new.vertical_pack_version := v_plan.vertical_pack_version;
  new.vertical_pack_content_hash := v_plan.vertical_pack_content_hash;
  new.offering_version_id := v_plan.offering_version_id;
  new.offering_content_hash := v_plan.offering_content_hash;
  new.availability_snapshot_id := v_plan.availability_snapshot_id;
  new.availability_content_hash := v_plan.availability_content_hash;
  new.policy_version_id := v_plan.policy_version_id;
  new.policy_content_hash := v_plan.policy_content_hash;
  return new;
end;
$$;

revoke all on function public.bind_siteforge_blueprint_vertical_identity()
  from public, anon, authenticated;

drop trigger if exists siteforge_blueprints_bind_vertical_identity
  on public.siteforge_blueprint_versions;
create trigger siteforge_blueprints_bind_vertical_identity
  before insert on public.siteforge_blueprint_versions
  for each row execute function public.bind_siteforge_blueprint_vertical_identity();

create table if not exists public.siteforge_conversion_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  website_id uuid not null,
  artifact_id uuid,
  submission_id text not null check (nullif(btrim(submission_id), '') is not null),
  form_kind text not null check (form_kind in ('lead', 'tour', 'contact', 'custom')),
  submission_payload jsonb not null check (jsonb_typeof(submission_payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  consent_state text not null
    check (consent_state in ('accepted', 'rejected', 'unknown')),
  result_status text not null default 'received'
    check (result_status in (
      'received', 'processing', 'accepted', 'duplicate', 'rejected', 'failed'
    )),
  lead_id uuid references public.leads(id) on delete set null,
  tour_id uuid references public.tours(id) on delete set null,
  failure_code text,
  request_id text,
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_conversion_website_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade,
  unique (website_id, submission_id)
);

create index if not exists siteforge_conversion_submissions_property_idx
  on public.siteforge_conversion_submissions
  (org_id, property_id, received_at desc);
create index if not exists siteforge_conversion_submissions_artifact_idx
  on public.siteforge_conversion_submissions
  (website_id, artifact_id, received_at desc);

create unique index if not exists siteforge_launch_releases_hash_identity_idx
  on public.siteforge_launch_releases
  (id, org_id, property_id, website_id, artifact_content_hash);

create table if not exists public.siteforge_launch_policies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  website_id uuid not null,
  version integer not null check (version > 0),
  required_aal text not null default 'aal2'
    check (required_aal in ('aal1', 'aal2')),
  confirmation_ttl_seconds integer not null default 600
    check (confirmation_ttl_seconds between 60 and 3600),
  requires_distinct_approver boolean not null default false,
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_launch_policy_website_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade,
  unique (website_id, version),
  unique (website_id, content_hash)
);

create unique index if not exists siteforge_launch_policies_tenant_identity_idx
  on public.siteforge_launch_policies
  (id, org_id, property_id, website_id, content_hash);
create index if not exists siteforge_launch_policies_current_idx
  on public.siteforge_launch_policies
  (org_id, property_id, website_id, version desc);

with default_policies as (
  select
    websites.org_id,
    websites.property_id,
    websites.id as website_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'mode', 'human_confirmation',
      'requiredAal', 'aal2',
      'enforcement', 'record_only'
    ) as policy
  from public.property_websites websites
)
insert into public.siteforge_launch_policies (
  org_id,
  property_id,
  website_id,
  version,
  required_aal,
  confirmation_ttl_seconds,
  requires_distinct_approver,
  policy,
  content_hash
)
select
  org_id,
  property_id,
  website_id,
  1,
  'aal2',
  600,
  false,
  policy,
  encode(extensions.digest(convert_to(policy::text, 'UTF8'), 'sha256'), 'hex')
from default_policies
on conflict do nothing;

create or replace function public.create_default_siteforge_launch_policy()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_policy jsonb := jsonb_build_object(
    'schemaVersion', 1,
    'mode', 'human_confirmation',
    'requiredAal', 'aal2',
    'enforcement', 'record_only'
  );
begin
  insert into public.siteforge_launch_policies (
    org_id,
    property_id,
    website_id,
    version,
    required_aal,
    confirmation_ttl_seconds,
    requires_distinct_approver,
    policy,
    content_hash
  )
  values (
    new.org_id,
    new.property_id,
    new.id,
    1,
    'aal2',
    600,
    false,
    v_policy,
    encode(extensions.digest(convert_to(v_policy::text, 'UTF8'), 'sha256'), 'hex')
  )
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.create_default_siteforge_launch_policy()
  from public, anon, authenticated;

drop trigger if exists property_websites_create_default_launch_policy
  on public.property_websites;
create trigger property_websites_create_default_launch_policy
  after insert on public.property_websites
  for each row execute function public.create_default_siteforge_launch_policy();

create table if not exists public.siteforge_launch_confirmations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  website_id uuid not null,
  release_id uuid not null,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  launch_policy_id uuid not null,
  launch_policy_content_hash text not null
    check (launch_policy_content_hash ~ '^[a-f0-9]{64}$'),
  confirmation_kind text not null
    check (confirmation_kind in ('prepare', 'approve', 'promote', 'rollback')),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  required_aal text not null check (required_aal in ('aal1', 'aal2')),
  observed_aal text not null check (observed_aal in ('unknown', 'aal1', 'aal2')),
  auth_session_id uuid,
  auth_event_id text,
  factor_id uuid,
  authentication_time timestamptz,
  reauthenticated_at timestamptz,
  confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  request_id text not null,
  ip_address_hash text check (
    ip_address_hash is null or ip_address_hash ~ '^[a-f0-9]{64}$'
  ),
  user_agent_hash text check (
    user_agent_hash is null or user_agent_hash ~ '^[a-f0-9]{64}$'
  ),
  confirmation_payload jsonb not null
    check (jsonb_typeof(confirmation_payload) = 'object'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  previous_confirmation_hash text check (
    previous_confirmation_hash is null
    or previous_confirmation_hash ~ '^[a-f0-9]{64}$'
  ),
  confirmation_hash text not null check (confirmation_hash ~ '^[a-f0-9]{64}$'),
  meets_required_aal boolean generated always as (
    observed_aal = 'aal2'
    or (required_aal = 'aal1' and observed_aal = 'aal1')
  ) stored,
  created_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_launch_confirmation_window_check
    check (expires_at > confirmed_at),
  constraint siteforge_launch_confirmation_release_tenant_fkey
    foreign key (
      release_id,
      org_id,
      property_id,
      website_id,
      artifact_content_hash
    )
    references public.siteforge_launch_releases
      (id, org_id, property_id, website_id, artifact_content_hash)
    on delete restrict,
  constraint siteforge_launch_confirmation_policy_tenant_fkey
    foreign key (
      launch_policy_id,
      org_id,
      property_id,
      website_id,
      launch_policy_content_hash
    )
    references public.siteforge_launch_policies
      (id, org_id, property_id, website_id, content_hash)
    on delete restrict,
  unique (release_id, confirmation_kind, confirmation_hash)
);

create unique index if not exists siteforge_launch_confirmations_tenant_identity_idx
  on public.siteforge_launch_confirmations
  (id, org_id, property_id, website_id, release_id, confirmation_hash);
create index if not exists siteforge_launch_confirmations_release_idx
  on public.siteforge_launch_confirmations
  (org_id, property_id, website_id, release_id, confirmed_at desc);
create index if not exists siteforge_launch_confirmations_aal_idx
  on public.siteforge_launch_confirmations
  (website_id, meets_required_aal, confirmed_at desc);

alter table public.siteforge_launch_releases
  add column if not exists launch_policy_id uuid,
  add column if not exists launch_policy_content_hash text,
  add column if not exists latest_launch_confirmation_id uuid,
  add column if not exists latest_launch_confirmation_hash text,
  add column if not exists launch_confirmation_required_aal text,
  add column if not exists launch_confirmation_observed_aal text,
  add column if not exists launch_confirmed_at timestamptz;

create or replace function public.bind_siteforge_launch_release_policy()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_policy public.siteforge_launch_policies%rowtype;
begin
  select policy.*
  into v_policy
  from public.siteforge_launch_policies policy
  where policy.org_id = new.org_id
    and policy.property_id = new.property_id
    and policy.website_id = new.website_id
  order by policy.version desc
  limit 1;

  if v_policy.id is null then
    raise exception 'A versioned launch policy is required before preparing a release';
  end if;
  if new.launch_policy_id is not null
    and (
      new.launch_policy_id <> v_policy.id
      or new.launch_policy_content_hash <> v_policy.content_hash
    )
  then
    raise exception 'Launch release policy identity is stale';
  end if;
  new.launch_policy_id := v_policy.id;
  new.launch_policy_content_hash := v_policy.content_hash;
  return new;
end;
$$;

revoke all on function public.bind_siteforge_launch_release_policy()
  from public, anon, authenticated;

drop trigger if exists siteforge_launch_releases_bind_policy
  on public.siteforge_launch_releases;
create trigger siteforge_launch_releases_bind_policy
  before insert on public.siteforge_launch_releases
  for each row execute function public.bind_siteforge_launch_release_policy();

alter table public.siteforge_launch_releases
  add constraint siteforge_launch_release_policy_hash_check
    check (
      (launch_policy_id is null) = (launch_policy_content_hash is null)
      and (
        launch_policy_content_hash is null
        or launch_policy_content_hash ~ '^[a-f0-9]{64}$'
      )
    ),
  add constraint siteforge_launch_release_confirmation_hash_check
    check (
      (latest_launch_confirmation_id is null)
        = (latest_launch_confirmation_hash is null)
      and (
        latest_launch_confirmation_hash is null
        or latest_launch_confirmation_hash ~ '^[a-f0-9]{64}$'
      )
      and (
        launch_confirmation_required_aal is null
        or launch_confirmation_required_aal in ('aal1', 'aal2')
      )
      and (
        launch_confirmation_observed_aal is null
        or launch_confirmation_observed_aal in ('unknown', 'aal1', 'aal2')
      )
    ),
  add constraint siteforge_launch_release_policy_tenant_fkey
    foreign key (
      launch_policy_id,
      org_id,
      property_id,
      website_id,
      launch_policy_content_hash
    )
    references public.siteforge_launch_policies
      (id, org_id, property_id, website_id, content_hash)
    on delete restrict,
  add constraint siteforge_launch_release_confirmation_tenant_fkey
    foreign key (
      latest_launch_confirmation_id,
      org_id,
      property_id,
      website_id,
      id,
      latest_launch_confirmation_hash
    )
    references public.siteforge_launch_confirmations
      (id, org_id, property_id, website_id, release_id, confirmation_hash)
    on delete restrict;

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
  then
    raise exception 'SiteForge conversion submission identity is immutable';
  end if;
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

revoke all on function public.protect_siteforge_conversion_identity()
  from public, anon, authenticated;

drop trigger if exists siteforge_conversion_submissions_protect_identity
  on public.siteforge_conversion_submissions;
create trigger siteforge_conversion_submissions_protect_identity
  before update on public.siteforge_conversion_submissions
  for each row execute function public.protect_siteforge_conversion_identity();

drop trigger if exists siteforge_launch_policies_immutable
  on public.siteforge_launch_policies;
create trigger siteforge_launch_policies_immutable
  before update or delete on public.siteforge_launch_policies
  for each row execute function public.reject_vertical_immutable_mutation();

drop trigger if exists siteforge_launch_confirmations_immutable
  on public.siteforge_launch_confirmations;
create trigger siteforge_launch_confirmations_immutable
  before update or delete on public.siteforge_launch_confirmations
  for each row execute function public.reject_vertical_immutable_mutation();

alter table public.siteforge_conversion_submissions enable row level security;
alter table public.siteforge_launch_policies enable row level security;
alter table public.siteforge_launch_confirmations enable row level security;

create policy "Users view their org launch policies"
  on public.siteforge_launch_policies for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
  ));
create policy "Managers view their org launch confirmations"
  on public.siteforge_launch_confirmations for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role in ('admin', 'manager')
  ));
create policy "Service role creates conversion submissions"
  on public.siteforge_conversion_submissions for insert to service_role
  with check (true);
create policy "Service role reads conversion submissions"
  on public.siteforge_conversion_submissions for select to service_role
  using (true);
create policy "Service role updates conversion outcomes"
  on public.siteforge_conversion_submissions for update to service_role
  using (true) with check (true);
create policy "Service role creates launch policies"
  on public.siteforge_launch_policies for insert to service_role
  with check (true);
create policy "Service role creates launch confirmations"
  on public.siteforge_launch_confirmations for insert to service_role
  with check (true);

revoke all on table
  public.siteforge_conversion_submissions,
  public.siteforge_launch_policies,
  public.siteforge_launch_confirmations
from anon, authenticated;
grant select on table public.siteforge_launch_policies to authenticated;
grant select on table public.siteforge_launch_confirmations to authenticated;
grant all on table
  public.siteforge_conversion_submissions,
  public.siteforge_launch_policies,
  public.siteforge_launch_confirmations
to service_role;

comment on table public.siteforge_conversion_submissions is
  'Append-only idempotent public conversion receipt bound to exact tenant, website, artifact, payload, consent, and downstream result.';
comment on table public.siteforge_launch_policies is
  'Append-only versioned launch policy. required_aal is recorded now so solo-operator AAL2 enforcement can be enabled without losing policy history.';
comment on table public.siteforge_launch_confirmations is
  'Append-only launch confirmation evidence with actor, session, factor, request, payload, and hash-chain fields for later AAL2 enforcement.';
