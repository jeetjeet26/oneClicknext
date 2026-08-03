create table if not exists public.siteforge_runtime_packages (
  id uuid primary key default gen_random_uuid(),
  package_type text not null check (package_type in ('runtime_plugin', 'base_theme', 'extension')),
  version text not null,
  package_sha256 text not null unique check (package_sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique,
  manifest jsonb not null default '{}'::jsonb,
  signature text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.siteforge_runtime_packages enable row level security;

drop policy if exists "Users view their org-independent SiteForge runtime packages"
  on public.siteforge_runtime_packages;
create policy "Users view their org-independent SiteForge runtime packages"
  on public.siteforge_runtime_packages for select
  using (auth.role() in ('authenticated', 'service_role'));

drop policy if exists "Service role manages SiteForge runtime packages"
  on public.siteforge_runtime_packages;
create policy "Service role manages SiteForge runtime packages"
  on public.siteforge_runtime_packages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

alter table public.siteforge_blueprint_versions
  add column if not exists runtime_contract_version integer not null default 1
    check (runtime_contract_version between 1 and 100),
  add column if not exists runtime_package_sha256 text
    check (runtime_package_sha256 is null or runtime_package_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists operation_set jsonb not null default '[]'::jsonb,
  add column if not exists operation_set_hash text
    check (operation_set_hash is null or operation_set_hash ~ '^[a-f0-9]{64}$');

alter table public.siteforge_wordpress_targets
  add column if not exists runtime_contract_version integer not null default 1
    check (runtime_contract_version between 1 and 100),
  add column if not exists runtime_version text,
  add column if not exists runtime_package_sha256 text
    check (runtime_package_sha256 is null or runtime_package_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists last_verified_content_hash text
    check (last_verified_content_hash is null or last_verified_content_hash ~ '^[a-f0-9]{64}$'),
  add column if not exists last_runtime_health_at timestamptz;

alter table public.siteforge_artifact_deployments
  add column if not exists runtime_contract_version integer not null default 1
    check (runtime_contract_version between 1 and 100),
  add column if not exists runtime_version text,
  add column if not exists operation_set_hash text
    check (operation_set_hash is null or operation_set_hash ~ '^[a-f0-9]{64}$'),
  add column if not exists expected_remote_content_hash text
    check (
      expected_remote_content_hash is null
      or expected_remote_content_hash ~ '^[a-f0-9]{64}$'
    ),
  add column if not exists remote_transaction_id text,
  add column if not exists failure_phase text,
  add column if not exists failure_code text;

drop index if exists public.shared_jobs_siteforge_preview_global_lease_idx;
create unique index if not exists shared_jobs_siteforge_preview_target_lease_idx
  on public.shared_jobs ((payload->>'targetId'))
  where domain = 'siteforge.preview'
    and lifecycle_status in ('running', 'retrying')
    and payload ? 'targetId';

drop function if exists public.publish_siteforge_artifact_revision(
  uuid, uuid, jsonb, text, text, text, text, jsonb, jsonb, numeric, uuid,
  text, text
);

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
set search_path = public
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

    if v_shared_job_id is null or v_source_plan_version_id is null then
      raise exception 'Initial SiteForge artifact identity is incomplete';
    end if;
    if jsonb_typeof(v_asset_manifest) <> 'array'
      or v_asset_manifest_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Initial SiteForge asset snapshot is incomplete';
    end if;

    select * into v_created
    from public.siteforge_blueprint_versions
    where shared_job_id = v_shared_job_id;

    if found then
      if v_created.website_id <> p_website_id
        or v_created.content_hash <> p_content_hash then
        raise exception 'Generation job produced conflicting artifact content';
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
    v_runtime_contract_version := coalesce(p_runtime_contract_version, 1);
    v_runtime_package_sha256 := p_runtime_package_sha256;
    v_operation_set := coalesce(p_operation_set, p_patches_applied, '[]'::jsonb);
    v_operation_set_hash := p_operation_set_hash;
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
    v_operation_set := coalesce(p_operation_set, p_patches_applied, '[]'::jsonb);
    v_operation_set_hash := coalesce(
      p_operation_set_hash,
      v_release_source.operation_set_hash
    );

    if jsonb_typeof(v_asset_manifest) <> 'array'
      or v_asset_manifest_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Edited SiteForge asset snapshot is incomplete';
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

grant execute on function public.publish_siteforge_artifact_revision(
  uuid, uuid, jsonb, text, text, text, text, jsonb, jsonb, numeric, uuid,
  text, text, jsonb, text, integer, text, jsonb, text
) to service_role;

comment on function public.publish_siteforge_artifact_revision is
  'Publishes immutable SiteForge runtime-v2 artifacts with exact assets, operation sets, and runtime package identity.';
