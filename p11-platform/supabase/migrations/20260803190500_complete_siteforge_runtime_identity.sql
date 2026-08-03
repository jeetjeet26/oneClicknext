alter table public.siteforge_wordpress_targets
  add column if not exists last_verified_artifact_id uuid
    references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists last_verified_asset_manifest_hash text
    check (
      last_verified_asset_manifest_hash is null
      or last_verified_asset_manifest_hash ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists last_verified_operation_hash text
    check (
      last_verified_operation_hash is null
      or last_verified_operation_hash ~ '^[a-f0-9]{64}$'
    );

alter table public.siteforge_artifact_deployments
  add column if not exists runtime_package_sha256 text
    check (
      runtime_package_sha256 is null
      or runtime_package_sha256 ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists deployment_idempotency_key text,
  add column if not exists final_verified_content_hash text
    check (
      final_verified_content_hash is null
      or final_verified_content_hash ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists final_verified_asset_manifest_hash text
    check (
      final_verified_asset_manifest_hash is null
      or final_verified_asset_manifest_hash ~ '^[a-f0-9]{64}$'
    );

create index if not exists siteforge_wordpress_targets_last_verified_artifact_idx
  on public.siteforge_wordpress_targets(last_verified_artifact_id);

create unique index if not exists siteforge_artifact_deployments_runtime_idempotency_idx
  on public.siteforge_artifact_deployments(target_id, deployment_idempotency_key)
  where deployment_idempotency_key is not null;

create or replace function public.validate_siteforge_revision_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_parent public.siteforge_blueprint_versions%rowtype;
begin
  if jsonb_typeof(new.asset_manifest) <> 'array'
    or new.asset_manifest_hash is null then
    raise exception 'SiteForge revision asset identity is incomplete';
  end if;

  if jsonb_typeof(new.operation_set) <> 'array' then
    raise exception 'SiteForge revision operation set must be an array';
  end if;
  if jsonb_array_length(new.operation_set) > 0
    and new.operation_set_hash is null then
    raise exception 'SiteForge revision operation set digest is required';
  end if;

  if new.parent_version_id is not null then
    select * into v_parent
    from public.siteforge_blueprint_versions
    where id = new.parent_version_id;

    if found
      and new.asset_manifest is distinct from v_parent.asset_manifest
      and new.asset_manifest_hash is not distinct from v_parent.asset_manifest_hash then
      raise exception 'Changed SiteForge asset manifest reused its parent digest';
    end if;

    if found
      and new.operation_set is distinct from v_parent.operation_set
      and new.operation_set_hash is not distinct from v_parent.operation_set_hash then
      raise exception 'Changed SiteForge operation set reused its parent digest';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_siteforge_revision_identity
  on public.siteforge_blueprint_versions;
create trigger validate_siteforge_revision_identity
before insert or update of asset_manifest, asset_manifest_hash, operation_set, operation_set_hash
on public.siteforge_blueprint_versions
for each row execute function public.validate_siteforge_revision_identity();
