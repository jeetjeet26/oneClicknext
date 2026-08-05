-- SiteForge runtime v3 package trust, immutable registration, and explicit
-- per-target rollout control. Existing contract-1 and contract-2 identities
-- remain unchanged.

alter table public.siteforge_runtime_packages
  add column if not exists runtime_contract_version integer,
  add column if not exists manifest_sha256 text,
  add column if not exists signature_algorithm text,
  add column if not exists signing_key_id text,
  add column if not exists publication_status text not null default 'published',
  add column if not exists revoked_at timestamptz,
  add column if not exists revocation_reason text;

update public.siteforge_runtime_packages
set publication_status = 'published'
where publication_status is null;

alter table public.siteforge_runtime_packages
  alter column publication_status set default 'published',
  alter column publication_status set not null;

update public.siteforge_runtime_packages
set runtime_contract_version = 2
where package_type = 'runtime_plugin'
  and runtime_contract_version is null;

alter table public.siteforge_runtime_packages
  drop constraint if exists siteforge_runtime_packages_contract_version_check,
  drop constraint if exists siteforge_runtime_packages_runtime_contract_check,
  drop constraint if exists siteforge_runtime_packages_manifest_sha256_check,
  drop constraint if exists siteforge_runtime_packages_signature_algorithm_check,
  drop constraint if exists siteforge_runtime_packages_publication_status_check,
  drop constraint if exists siteforge_runtime_packages_revocation_check,
  drop constraint if exists siteforge_runtime_packages_v3_trust_check;

alter table public.siteforge_runtime_packages
  add constraint siteforge_runtime_packages_contract_version_check
    check (
      runtime_contract_version is null
      or runtime_contract_version between 1 and 100
    ),
  add constraint siteforge_runtime_packages_runtime_contract_check
    check (
      package_type <> 'runtime_plugin'
      or runtime_contract_version is not null
    ),
  add constraint siteforge_runtime_packages_manifest_sha256_check
    check (
      manifest_sha256 is null
      or manifest_sha256 ~ '^[a-f0-9]{64}$'
    ),
  add constraint siteforge_runtime_packages_signature_algorithm_check
    check (
      signature_algorithm is null
      or signature_algorithm = 'ed25519-sha256'
    ),
  add constraint siteforge_runtime_packages_publication_status_check
    check (publication_status in ('published', 'revoked')),
  add constraint siteforge_runtime_packages_revocation_check
    check (
      (
        publication_status = 'published'
        and revoked_at is null
        and revocation_reason is null
      )
      or (
        publication_status = 'revoked'
        and revoked_at is not null
        and nullif(btrim(revocation_reason), '') is not null
      )
    ),
  add constraint siteforge_runtime_packages_v3_trust_check
    check (
      package_type <> 'runtime_plugin'
      or runtime_contract_version < 3
      or (
        jsonb_typeof(manifest) = 'object'
        and manifest <> '{}'::jsonb
        and manifest_sha256 ~ '^[a-f0-9]{64}$'
        and nullif(btrim(signature), '') is not null
        and signature_algorithm = 'ed25519-sha256'
        and nullif(btrim(signing_key_id), '') is not null
      )
    );

create unique index if not exists siteforge_runtime_packages_contract_version_idx
  on public.siteforge_runtime_packages (
    package_type,
    runtime_contract_version,
    version
  )
  where runtime_contract_version >= 3;

create index if not exists siteforge_runtime_packages_publication_lookup_idx
  on public.siteforge_runtime_packages (
    package_type,
    runtime_contract_version,
    publication_status,
    created_at desc
  );

create or replace function public.protect_siteforge_runtime_package_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SiteForge runtime packages are immutable; revoke the package instead';
  end if;

  if new.package_type is distinct from old.package_type
    or new.version is distinct from old.version
    or new.package_sha256 is distinct from old.package_sha256
    or new.storage_path is distinct from old.storage_path
    or new.manifest is distinct from old.manifest
    or new.runtime_contract_version is distinct from old.runtime_contract_version
    or new.manifest_sha256 is distinct from old.manifest_sha256
    or new.signature is distinct from old.signature
    or new.signature_algorithm is distinct from old.signature_algorithm
    or new.signing_key_id is distinct from old.signing_key_id
    or new.created_at is distinct from old.created_at then
    raise exception 'SiteForge runtime package identity is immutable';
  end if;

  if old.publication_status = 'revoked'
    and (
      new.publication_status is distinct from old.publication_status
      or new.revoked_at is distinct from old.revoked_at
      or new.revocation_reason is distinct from old.revocation_reason
    ) then
    raise exception 'Revoked SiteForge runtime package metadata is immutable';
  end if;

  if old.publication_status = 'published'
    and new.publication_status not in ('published', 'revoked') then
    raise exception 'Invalid SiteForge runtime package publication transition';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_siteforge_runtime_package_identity
  on public.siteforge_runtime_packages;
create trigger protect_siteforge_runtime_package_identity
before update or delete on public.siteforge_runtime_packages
for each row execute function public.protect_siteforge_runtime_package_identity();

alter table public.siteforge_wordpress_targets
  add column if not exists runtime_manifest_sha256 text
    check (
      runtime_manifest_sha256 is null
      or runtime_manifest_sha256 ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists last_verified_runtime_manifest_sha256 text
    check (
      last_verified_runtime_manifest_sha256 is null
      or last_verified_runtime_manifest_sha256 ~ '^[a-f0-9]{64}$'
    );

alter table public.siteforge_artifact_deployments
  add column if not exists runtime_manifest_sha256 text
    check (
      runtime_manifest_sha256 is null
      or runtime_manifest_sha256 ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists final_verified_runtime_manifest_sha256 text
    check (
      final_verified_runtime_manifest_sha256 is null
      or final_verified_runtime_manifest_sha256 ~ '^[a-f0-9]{64}$'
    );

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.siteforge_blueprint_versions'::regclass
      and conname = 'siteforge_blueprint_versions_runtime_package_fkey'
  ) then
    alter table public.siteforge_blueprint_versions
      add constraint siteforge_blueprint_versions_runtime_package_fkey
      foreign key (runtime_package_sha256)
      references public.siteforge_runtime_packages(package_sha256)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.siteforge_wordpress_targets'::regclass
      and conname = 'siteforge_wordpress_targets_runtime_package_fkey'
  ) then
    alter table public.siteforge_wordpress_targets
      add constraint siteforge_wordpress_targets_runtime_package_fkey
      foreign key (runtime_package_sha256)
      references public.siteforge_runtime_packages(package_sha256)
      on delete restrict
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.siteforge_artifact_deployments'::regclass
      and conname = 'siteforge_artifact_deployments_runtime_package_fkey'
  ) then
    alter table public.siteforge_artifact_deployments
      add constraint siteforge_artifact_deployments_runtime_package_fkey
      foreign key (runtime_package_sha256)
      references public.siteforge_runtime_packages(package_sha256)
      on delete restrict
      not valid;
  end if;
end
$$;

create unique index if not exists siteforge_wordpress_targets_tenant_identity_idx
  on public.siteforge_wordpress_targets (id, org_id, property_id, website_id);

create table if not exists public.siteforge_runtime_target_rollouts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  target_id uuid not null unique,
  requested_contract_version integer not null
    check (requested_contract_version between 3 and 100),
  runtime_package_sha256 text not null
    references public.siteforge_runtime_packages(package_sha256) on delete restrict
    check (runtime_package_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'disabled'
    check (status in ('disabled', 'enabled', 'paused', 'rolled_back')),
  previous_runtime_contract_version integer
    check (
      previous_runtime_contract_version is null
      or previous_runtime_contract_version between 1 and 100
    ),
  previous_runtime_version text,
  previous_runtime_package_sha256 text
    check (
      previous_runtime_package_sha256 is null
      or previous_runtime_package_sha256 ~ '^[a-f0-9]{64}$'
    ),
  previous_runtime_manifest_sha256 text
    check (
      previous_runtime_manifest_sha256 is null
      or previous_runtime_manifest_sha256 ~ '^[a-f0-9]{64}$'
    ),
  reason text check (reason is null or nullif(btrim(reason), '') is not null),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  activated_at timestamptz,
  rolled_back_at timestamptz,
  constraint siteforge_runtime_target_rollouts_target_tenant_fkey
    foreign key (target_id, org_id, property_id, website_id)
    references public.siteforge_wordpress_targets (
      id,
      org_id,
      property_id,
      website_id
    )
    on delete cascade,
  constraint siteforge_runtime_target_rollouts_status_timestamps_check
    check (
      (status <> 'enabled' or activated_at is not null)
      and (status <> 'rolled_back' or rolled_back_at is not null)
    )
);

create index if not exists siteforge_runtime_target_rollouts_tenant_idx
  on public.siteforge_runtime_target_rollouts (
    org_id,
    property_id,
    website_id,
    status,
    updated_at desc
  );

create index if not exists siteforge_runtime_target_rollouts_package_idx
  on public.siteforge_runtime_target_rollouts (
    runtime_package_sha256,
    requested_contract_version,
    status
  );

create or replace function public.set_siteforge_runtime_target_rollout_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_siteforge_runtime_target_rollout_updated_at
  on public.siteforge_runtime_target_rollouts;
create trigger set_siteforge_runtime_target_rollout_updated_at
before update on public.siteforge_runtime_target_rollouts
for each row execute function public.set_siteforge_runtime_target_rollout_updated_at();

alter table public.siteforge_runtime_target_rollouts enable row level security;

drop policy if exists "Users view their org SiteForge runtime target rollouts"
  on public.siteforge_runtime_target_rollouts;
create policy "Users view their org SiteForge runtime target rollouts"
  on public.siteforge_runtime_target_rollouts
  for select
  to authenticated
  using (exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.org_id = siteforge_runtime_target_rollouts.org_id
  ));

drop policy if exists "Service role manages SiteForge runtime target rollouts"
  on public.siteforge_runtime_target_rollouts;
create policy "Service role manages SiteForge runtime target rollouts"
  on public.siteforge_runtime_target_rollouts
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.siteforge_runtime_target_rollouts
  from anon, authenticated;
grant select on table public.siteforge_runtime_target_rollouts to authenticated;
grant all on table public.siteforge_runtime_target_rollouts to service_role;

create or replace function public.register_siteforge_runtime_package(
  p_package_type text,
  p_version text,
  p_package_sha256 text,
  p_storage_path text,
  p_manifest jsonb,
  p_runtime_contract_version integer default null,
  p_manifest_sha256 text default null,
  p_signature text default null,
  p_signature_algorithm text default null,
  p_signing_key_id text default null,
  p_created_by uuid default null
)
returns public.siteforge_runtime_packages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.siteforge_runtime_packages%rowtype;
  v_created public.siteforge_runtime_packages%rowtype;
begin
  if p_package_type not in ('runtime_plugin', 'base_theme', 'extension') then
    raise exception 'Unsupported SiteForge runtime package type';
  end if;
  if p_version is null
    or p_version !~ '^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-[0-9A-Za-z-]+([.][0-9A-Za-z-]+)*)?([+][0-9A-Za-z-]+([.][0-9A-Za-z-]+)*)?$' then
    raise exception 'Invalid SiteForge runtime package semantic version';
  end if;
  if p_package_sha256 is null
    or p_package_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge runtime package digest';
  end if;
  if p_storage_path is null
    or p_storage_path <> btrim(p_storage_path)
    or p_storage_path = ''
    or left(p_storage_path, 1) = '/'
    or p_storage_path like '%//%'
    or p_storage_path ~ '(^|/)[.][.]?(/|$)'
    or position(chr(92) in p_storage_path) > 0 then
    raise exception 'Invalid SiteForge runtime package storage path';
  end if;
  if jsonb_typeof(p_manifest) <> 'object' then
    raise exception 'SiteForge runtime package manifest must be an object';
  end if;
  if p_runtime_contract_version is not null
    and (p_runtime_contract_version < 1 or p_runtime_contract_version > 100) then
    raise exception 'Invalid SiteForge runtime package contract version';
  end if;
  if p_package_type = 'runtime_plugin'
    and p_runtime_contract_version is null then
    raise exception 'SiteForge runtime plugin contract version is required';
  end if;
  if p_manifest_sha256 is not null
    and p_manifest_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge runtime package manifest digest';
  end if;
  if p_signature_algorithm is not null
    and p_signature_algorithm <> 'ed25519-sha256' then
    raise exception 'Unsupported SiteForge runtime package signature algorithm';
  end if;
  if p_package_type = 'runtime_plugin'
    and p_runtime_contract_version >= 3
    and (
      p_manifest = '{}'::jsonb
      or p_manifest_sha256 is null
      or nullif(btrim(p_signature), '') is null
      or p_signature_algorithm <> 'ed25519-sha256'
      or nullif(btrim(p_signing_key_id), '') is null
    ) then
    raise exception 'SiteForge runtime v3 package trust metadata is incomplete';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_package_type || ':' || coalesce(p_runtime_contract_version::text, '-') ||
      ':' || p_version || ':' || p_package_sha256,
      0
    )
  );

  select package.*
  into v_existing
  from public.siteforge_runtime_packages package
  where package.package_sha256 = p_package_sha256
    or package.storage_path = p_storage_path
    or (
      package.package_type = p_package_type
      and package.runtime_contract_version is not distinct from p_runtime_contract_version
      and package.version = p_version
    )
  order by package.created_at, package.id
  limit 1
  for update;

  if found then
    if v_existing.package_type is distinct from p_package_type
      or v_existing.version is distinct from p_version
      or v_existing.package_sha256 is distinct from p_package_sha256
      or v_existing.storage_path is distinct from p_storage_path
      or v_existing.manifest is distinct from p_manifest
      or v_existing.runtime_contract_version is distinct from p_runtime_contract_version
      or v_existing.manifest_sha256 is distinct from p_manifest_sha256
      or v_existing.signature is distinct from p_signature
      or v_existing.signature_algorithm is distinct from p_signature_algorithm
      or v_existing.signing_key_id is distinct from p_signing_key_id then
      raise exception 'SiteForge runtime package identity conflicts with an immutable registry row';
    end if;
    return v_existing;
  end if;

  insert into public.siteforge_runtime_packages (
    package_type,
    version,
    package_sha256,
    storage_path,
    manifest,
    signature,
    created_by,
    runtime_contract_version,
    manifest_sha256,
    signature_algorithm,
    signing_key_id,
    publication_status
  )
  values (
    p_package_type,
    p_version,
    p_package_sha256,
    p_storage_path,
    p_manifest,
    p_signature,
    p_created_by,
    p_runtime_contract_version,
    p_manifest_sha256,
    p_signature_algorithm,
    p_signing_key_id,
    'published'
  )
  returning * into v_created;

  return v_created;
end;
$$;

revoke all on function public.register_siteforge_runtime_package(
  text, text, text, text, jsonb, integer, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.register_siteforge_runtime_package(
  text, text, text, text, jsonb, integer, text, text, text, text, uuid
) to service_role;

create or replace function public.set_siteforge_runtime_target_rollout(
  p_target_id uuid,
  p_requested_contract_version integer,
  p_runtime_package_sha256 text,
  p_status text,
  p_assigned_by uuid default null,
  p_reason text default null
)
returns public.siteforge_runtime_target_rollouts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_target public.siteforge_wordpress_targets%rowtype;
  v_package public.siteforge_runtime_packages%rowtype;
  v_rollout public.siteforge_runtime_target_rollouts%rowtype;
  v_now timestamptz := timezone('utc', now());
begin
  if p_requested_contract_version is null
    or p_requested_contract_version < 3
    or p_requested_contract_version > 100 then
    raise exception 'Invalid SiteForge runtime rollout contract version';
  end if;
  if p_runtime_package_sha256 is null
    or p_runtime_package_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge runtime rollout package digest';
  end if;
  if p_status not in ('disabled', 'enabled', 'paused', 'rolled_back') then
    raise exception 'Invalid SiteForge runtime rollout status';
  end if;
  if p_reason is not null and nullif(btrim(p_reason), '') is null then
    raise exception 'SiteForge runtime rollout reason cannot be blank';
  end if;
  if p_status in ('paused', 'rolled_back')
    and nullif(btrim(p_reason), '') is null then
    raise exception 'SiteForge runtime rollout reason is required for pause or rollback';
  end if;

  select target.*
  into v_target
  from public.siteforge_wordpress_targets target
  join public.property_websites website
    on website.id = target.website_id
   and website.org_id = target.org_id
   and website.property_id = target.property_id
  where target.id = p_target_id
  for update of target;

  if not found then
    raise exception 'SiteForge runtime rollout target or tenant identity was not found';
  end if;

  select package.*
  into v_package
  from public.siteforge_runtime_packages package
  where package.package_sha256 = p_runtime_package_sha256
    and package.package_type = 'runtime_plugin'
    and package.runtime_contract_version = p_requested_contract_version
    and package.publication_status = 'published'
    and package.revoked_at is null
    and jsonb_typeof(package.manifest) = 'object'
    and package.manifest <> '{}'::jsonb
    and package.manifest_sha256 ~ '^[a-f0-9]{64}$'
    and nullif(btrim(package.signature), '') is not null
    and package.signature_algorithm = 'ed25519-sha256'
    and nullif(btrim(package.signing_key_id), '') is not null
  for share;

  if not found then
    raise exception 'Published signed SiteForge runtime rollout package was not found';
  end if;

  select rollout.*
  into v_rollout
  from public.siteforge_runtime_target_rollouts rollout
  where rollout.target_id = p_target_id
  for update;

  if found then
    update public.siteforge_runtime_target_rollouts
    set requested_contract_version = p_requested_contract_version,
        runtime_package_sha256 = p_runtime_package_sha256,
        status = p_status,
        previous_runtime_contract_version = v_target.runtime_contract_version,
        previous_runtime_version = v_target.runtime_version,
        previous_runtime_package_sha256 = v_target.runtime_package_sha256,
        previous_runtime_manifest_sha256 = v_target.runtime_manifest_sha256,
        reason = p_reason,
        assigned_by = p_assigned_by,
        activated_at = case
          when p_status = 'enabled'
            and (
              v_rollout.status <> 'enabled'
              or v_rollout.requested_contract_version <> p_requested_contract_version
              or v_rollout.runtime_package_sha256 <> p_runtime_package_sha256
            )
            then v_now
          else v_rollout.activated_at
        end,
        rolled_back_at = case
          when p_status = 'rolled_back' and v_rollout.status <> 'rolled_back'
            then v_now
          else v_rollout.rolled_back_at
        end
    where id = v_rollout.id
    returning * into v_rollout;
  else
    insert into public.siteforge_runtime_target_rollouts (
      org_id,
      property_id,
      website_id,
      target_id,
      requested_contract_version,
      runtime_package_sha256,
      status,
      previous_runtime_contract_version,
      previous_runtime_version,
      previous_runtime_package_sha256,
      previous_runtime_manifest_sha256,
      reason,
      assigned_by,
      activated_at,
      rolled_back_at
    )
    values (
      v_target.org_id,
      v_target.property_id,
      v_target.website_id,
      v_target.id,
      p_requested_contract_version,
      p_runtime_package_sha256,
      p_status,
      v_target.runtime_contract_version,
      v_target.runtime_version,
      v_target.runtime_package_sha256,
      v_target.runtime_manifest_sha256,
      p_reason,
      p_assigned_by,
      case when p_status = 'enabled' then v_now else null end,
      case when p_status = 'rolled_back' then v_now else null end
    )
    returning * into v_rollout;
  end if;

  return v_rollout;
end;
$$;

revoke all on function public.set_siteforge_runtime_target_rollout(
  uuid, integer, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_siteforge_runtime_target_rollout(
  uuid, integer, text, text, uuid, text
) to service_role;

create or replace function public.publish_siteforge_artifact_revision(
  p_website_id uuid,
  p_expected_artifact_id uuid,
  p_blueprint jsonb,
  p_content_hash text,
  p_change_type text,
  p_changes_summary text,
  p_edit_intent text,
  p_patches_applied jsonb,
  p_quality_report jsonb,
  p_quality_score numeric,
  p_created_by uuid,
  p_base_theme_package_id text default null,
  p_base_theme_package_sha256 text default null,
  p_asset_manifest jsonb default null,
  p_asset_manifest_hash text default null,
  p_runtime_contract_version integer default null,
  p_runtime_package_sha256 text default null,
  p_operation_set jsonb default null,
  p_operation_set_hash text default null
)
returns public.siteforge_blueprint_versions
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_website public.property_websites%rowtype;
  v_parent public.siteforge_blueprint_versions%rowtype;
  v_release_source public.siteforge_blueprint_versions%rowtype;
  v_created public.siteforge_blueprint_versions%rowtype;
  v_next_version integer;
  v_shared_job_id uuid;
  v_source_plan_version_id uuid;
  v_asset_manifest jsonb;
  v_asset_manifest_hash text;
  v_runtime_contract_version integer;
  v_runtime_package_sha256 text;
  v_operation_set jsonb;
  v_operation_set_hash text;
begin
  select * into v_website
  from public.property_websites
  where id = p_website_id
  for update;

  if not found then
    raise exception 'SiteForge website not found';
  end if;
  if p_change_type not in ('generation', 'edit', 'rollback', 'import') then
    raise exception 'Unsupported SiteForge artifact change type';
  end if;
  if p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge artifact content hash';
  end if;
  if (p_base_theme_package_id is null) <> (p_base_theme_package_sha256 is null) then
    raise exception 'SiteForge base theme package identity must be supplied together';
  end if;
  if p_base_theme_package_sha256 is not null
    and p_base_theme_package_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge base theme package digest';
  end if;
  if (p_asset_manifest is null) <> (p_asset_manifest_hash is null) then
    raise exception 'SiteForge asset manifest and digest must be supplied together';
  end if;
  if p_asset_manifest_hash is not null
    and p_asset_manifest_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge asset manifest digest';
  end if;
  if p_runtime_contract_version is not null
    and (p_runtime_contract_version < 1 or p_runtime_contract_version > 100) then
    raise exception 'Invalid SiteForge runtime contract version';
  end if;
  if p_runtime_package_sha256 is not null
    and p_runtime_package_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge runtime package digest';
  end if;
  if p_operation_set_hash is not null
    and p_operation_set_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge operation set digest';
  end if;

  if p_change_type = 'generation' then
    if p_expected_artifact_id is distinct from p_website_id
      or v_website.current_artifact_version_id is not null then
      raise exception 'SiteForge artifact version conflict';
    end if;

    v_shared_job_id := nullif(p_patches_applied->>'sharedJobId', '')::uuid;
    v_source_plan_version_id :=
      nullif(p_patches_applied->>'sourcePlanVersionId', '')::uuid;
    v_asset_manifest := coalesce(p_asset_manifest, p_patches_applied->'assetManifest');
    v_asset_manifest_hash :=
      coalesce(p_asset_manifest_hash, p_patches_applied->>'assetManifestHash');
    v_runtime_contract_version := coalesce(p_runtime_contract_version, 1);
    v_runtime_package_sha256 := p_runtime_package_sha256;
    v_operation_set := coalesce(p_operation_set, p_patches_applied, '[]'::jsonb);
    v_operation_set_hash := p_operation_set_hash;

    if v_shared_job_id is null or v_source_plan_version_id is null then
      raise exception 'Initial SiteForge artifact identity is incomplete';
    end if;
    if jsonb_typeof(v_asset_manifest) <> 'array'
      or v_asset_manifest_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Initial SiteForge asset snapshot is incomplete';
    end if;

    if v_runtime_contract_version >= 3 then
      if v_runtime_package_sha256 !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(v_asset_manifest) <> 'array'
        or v_asset_manifest_hash !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(v_operation_set) <> 'array'
        or v_operation_set_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'SiteForge runtime v3 artifact identity is incomplete';
      end if;

      perform 1
      from public.siteforge_runtime_packages package
      where package.package_sha256 = v_runtime_package_sha256
        and package.package_type = 'runtime_plugin'
        and package.runtime_contract_version = v_runtime_contract_version
        and package.publication_status = 'published'
        and package.revoked_at is null
        and jsonb_typeof(package.manifest) = 'object'
        and package.manifest <> '{}'::jsonb
        and package.manifest_sha256 ~ '^[a-f0-9]{64}$'
        and nullif(btrim(package.signature), '') is not null
        and package.signature_algorithm = 'ed25519-sha256'
        and nullif(btrim(package.signing_key_id), '') is not null;

      if not found then
        raise exception 'Published signed SiteForge runtime v3 package was not found';
      end if;
    end if;

    select * into v_created
    from public.siteforge_blueprint_versions
    where shared_job_id = v_shared_job_id;

    if found then
      if v_created.website_id <> p_website_id
        or v_created.content_hash <> p_content_hash then
        raise exception 'Generation job produced conflicting artifact content';
      end if;
      if v_runtime_contract_version >= 3
        and (
          v_created.runtime_contract_version is distinct from v_runtime_contract_version
          or v_created.runtime_package_sha256 is distinct from v_runtime_package_sha256
          or v_created.asset_manifest is distinct from v_asset_manifest
          or v_created.asset_manifest_hash is distinct from v_asset_manifest_hash
          or v_created.operation_set is distinct from v_operation_set
          or v_created.operation_set_hash is distinct from v_operation_set_hash
        ) then
        raise exception 'Generation job produced conflicting runtime v3 identity';
      end if;
      update public.property_websites
      set current_artifact_version_id = v_created.id,
          blueprint = v_created.blueprint,
          pages_generated = v_created.blueprint->'pages',
          updated_at = timezone('utc', now())
      where id = p_website_id
        and current_artifact_version_id is null;
      return v_created;
    end if;

    v_next_version := 1;
    insert into public.siteforge_blueprint_versions (
      website_id, org_id, property_id, version, blueprint_schema_version,
      blueprint, content_hash, parent_version_id, change_type, changes_summary,
      edit_intent, patches_applied, source_plan_version_id, shared_job_id,
      quality_report, quality_score, created_by, asset_manifest,
      asset_manifest_hash, base_theme_package_id, base_theme_package_sha256,
      site_configuration, motion_configuration, runtime_contract_version,
      runtime_package_sha256, operation_set, operation_set_hash
    )
    values (
      p_website_id, v_website.org_id, v_website.property_id, v_next_version, 2,
      p_blueprint, p_content_hash, null, 'generation', p_changes_summary,
      p_edit_intent, p_patches_applied, v_source_plan_version_id,
      v_shared_job_id, p_quality_report, p_quality_score, null,
      v_asset_manifest, v_asset_manifest_hash, p_base_theme_package_id,
      p_base_theme_package_sha256,
      coalesce(p_blueprint->'siteConfiguration', '{}'::jsonb),
      coalesce(p_blueprint->'siteConfiguration'->'motion', '{}'::jsonb),
      v_runtime_contract_version, v_runtime_package_sha256, v_operation_set,
      v_operation_set_hash
    )
    returning * into v_created;
  else
    if v_website.current_artifact_version_id is distinct from p_expected_artifact_id then
      raise exception 'SiteForge artifact version conflict';
    end if;

    select * into v_parent
    from public.siteforge_blueprint_versions
    where id = p_expected_artifact_id
      and website_id = p_website_id;
    if not found then
      raise exception 'Parent SiteForge artifact not found';
    end if;

    v_release_source := v_parent;
    if p_change_type = 'rollback' then
      select * into v_release_source
      from public.siteforge_blueprint_versions
      where id = nullif(p_patches_applied->>'targetArtifactId', '')::uuid
        and website_id = p_website_id
        and content_hash = p_content_hash;
      if not found then
        raise exception 'Rollback release package identity not found';
      end if;
    end if;

    v_asset_manifest := coalesce(p_asset_manifest, v_release_source.asset_manifest);
    v_asset_manifest_hash :=
      coalesce(p_asset_manifest_hash, v_release_source.asset_manifest_hash);
    v_runtime_contract_version := coalesce(
      p_runtime_contract_version,
      v_release_source.runtime_contract_version,
      1
    );
    v_runtime_package_sha256 := coalesce(
      p_runtime_package_sha256,
      v_release_source.runtime_package_sha256
    );
    if v_runtime_contract_version >= 3 then
      v_operation_set := coalesce(p_operation_set, v_release_source.operation_set);
    else
      v_operation_set := coalesce(p_operation_set, p_patches_applied, '[]'::jsonb);
    end if;
    v_operation_set_hash := coalesce(
      p_operation_set_hash,
      v_release_source.operation_set_hash
    );

    if jsonb_typeof(v_asset_manifest) <> 'array'
      or v_asset_manifest_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Edited SiteForge asset snapshot is incomplete';
    end if;

    if v_runtime_contract_version >= 3 then
      if v_runtime_package_sha256 !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(v_asset_manifest) <> 'array'
        or v_asset_manifest_hash !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(v_operation_set) <> 'array'
        or v_operation_set_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'SiteForge runtime v3 artifact identity is incomplete';
      end if;

      perform 1
      from public.siteforge_runtime_packages package
      where package.package_sha256 = v_runtime_package_sha256
        and package.package_type = 'runtime_plugin'
        and package.runtime_contract_version = v_runtime_contract_version
        and package.publication_status = 'published'
        and package.revoked_at is null
        and jsonb_typeof(package.manifest) = 'object'
        and package.manifest <> '{}'::jsonb
        and package.manifest_sha256 ~ '^[a-f0-9]{64}$'
        and nullif(btrim(package.signature), '') is not null
        and package.signature_algorithm = 'ed25519-sha256'
        and nullif(btrim(package.signing_key_id), '') is not null;

      if not found then
        raise exception 'Published signed SiteForge runtime v3 package was not found';
      end if;
    end if;

    select coalesce(max(version), 0) + 1 into v_next_version
    from public.siteforge_blueprint_versions
    where website_id = p_website_id;

    insert into public.siteforge_blueprint_versions (
      website_id, org_id, property_id, version, blueprint_schema_version,
      blueprint, content_hash, parent_version_id, change_type, changes_summary,
      edit_intent, patches_applied, source_plan_version_id, quality_report,
      quality_score, created_by, asset_manifest, asset_manifest_hash,
      base_theme_package_id, base_theme_package_sha256, theme_overlay_id,
      overlay_package_sha256, site_configuration, motion_configuration,
      runtime_contract_version, runtime_package_sha256, operation_set,
      operation_set_hash
    )
    values (
      p_website_id, v_parent.org_id, v_parent.property_id, v_next_version,
      greatest(v_parent.blueprint_schema_version, 2), p_blueprint, p_content_hash,
      v_parent.id, p_change_type, p_changes_summary, p_edit_intent,
      p_patches_applied, v_release_source.source_plan_version_id, p_quality_report,
      p_quality_score, p_created_by, v_asset_manifest,
      v_asset_manifest_hash,
      coalesce(p_base_theme_package_id, v_release_source.base_theme_package_id),
      coalesce(p_base_theme_package_sha256, v_release_source.base_theme_package_sha256),
      v_release_source.theme_overlay_id, v_release_source.overlay_package_sha256,
      coalesce(p_blueprint->'siteConfiguration', v_release_source.site_configuration),
      coalesce(
        p_blueprint->'siteConfiguration'->'motion',
        v_release_source.motion_configuration
      ),
      v_runtime_contract_version, v_runtime_package_sha256, v_operation_set,
      v_operation_set_hash
    )
    returning * into v_created;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_asset_manifest) asset
    where asset->>'approvalStatus' is distinct from 'approved'
      or asset->>'rightsStatus' is null
      or asset->>'rightsStatus' not in ('owned', 'licensed', 'generated')
  ) then
    raise exception 'SiteForge artifact contains unapproved or uncleared assets';
  end if;

  update public.property_websites
  set current_artifact_version_id = v_created.id,
      blueprint = p_blueprint,
      pages_generated = p_blueprint->'pages',
      canonical_preview_url = null,
      canonical_preview_artifact_id = null,
      canonical_preview_content_hash = null,
      canonical_previewed_at = null,
      staging_artifact_id = null,
      staging_content_hash = null,
      staging_certified_at = null,
      editor_lifecycle_status = 'editing',
      generation_status = 'ready_for_preview',
      updated_at = timezone('utc', now())
  where id = p_website_id;

  if not found then
    raise exception 'SiteForge artifact projection was not updated';
  end if;
  return v_created;
end;
$$;

revoke all on function public.publish_siteforge_artifact_revision(
  uuid, uuid, jsonb, text, text, text, text, jsonb, jsonb, numeric, uuid,
  text, text, jsonb, text, integer, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.publish_siteforge_artifact_revision(
  uuid, uuid, jsonb, text, text, text, text, jsonb, jsonb, numeric, uuid,
  text, text, jsonb, text, integer, text, jsonb, text
) to service_role;

comment on table public.siteforge_runtime_target_rollouts is
  'Explicit per-target SiteForge runtime v3 assignment and rollback control. Absence of a row means runtime v3 is disabled.';
comment on column public.siteforge_runtime_packages.runtime_contract_version is
  'Exact SiteForge runtime protocol contract implemented by an immutable runtime plugin package.';
comment on column public.siteforge_runtime_packages.manifest_sha256 is
  'SHA-256 of the canonical internal package manifest covered by the detached package signature.';
comment on column public.siteforge_runtime_packages.publication_status is
  'Trust state for package selection. Revoked packages remain immutable and retained for audit history.';
comment on column public.siteforge_wordpress_targets.runtime_manifest_sha256 is
  'Manifest digest reported for the currently installed SiteForge runtime package.';
comment on column public.siteforge_wordpress_targets.last_verified_runtime_manifest_sha256 is
  'Manifest digest independently observed during the latest successful runtime health verification.';
comment on column public.siteforge_artifact_deployments.runtime_manifest_sha256 is
  'Expected signed runtime package manifest digest for this deployment attempt.';
comment on column public.siteforge_artifact_deployments.final_verified_runtime_manifest_sha256 is
  'Runtime package manifest digest observed during final deployment certification.';
comment on function public.register_siteforge_runtime_package(
  text, text, text, text, jsonb, integer, text, text, text, text, uuid
) is
  'Registers immutable SiteForge package identity after publisher-side signature verification; conflicting digest, path, or version reuse fails closed.';
comment on function public.set_siteforge_runtime_target_rollout(
  uuid, integer, text, text, uuid, text
) is
  'Assigns, pauses, disables, or rolls back a signed SiteForge runtime v3 package for one tenant-consistent WordPress target.';
comment on function public.publish_siteforge_artifact_revision(
  uuid, uuid, jsonb, text, text, text, text, jsonb, jsonb, numeric, uuid,
  text, text, jsonb, text, integer, text, jsonb, text
) is
  'Publishes immutable SiteForge artifacts while requiring complete signed registry, asset, and operation identity for runtime contract v3 or later.';
