-- SiteForge control-plane and release-safety repair.
-- This migration is intentionally additive/redefining only; apply through the
-- normal local migration workflow after review.

create unique index if not exists shared_jobs_siteforge_preview_global_lease_idx
  on public.shared_jobs (lease_owner)
  where lease_owner = 'siteforge-canonical-preview'
    and lifecycle_status in ('running', 'retrying');

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
  p_base_theme_package_sha256 text default null
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

  if p_change_type = 'generation' then
    if p_expected_artifact_id is distinct from p_website_id
      or v_website.current_artifact_version_id is not null then
      raise exception 'SiteForge artifact version conflict';
    end if;

    v_shared_job_id := nullif(p_patches_applied->>'sharedJobId', '')::uuid;
    v_source_plan_version_id :=
      nullif(p_patches_applied->>'sourcePlanVersionId', '')::uuid;
    v_asset_manifest := p_patches_applied->'assetManifest';
    v_asset_manifest_hash := p_patches_applied->>'assetManifestHash';

    if v_shared_job_id is null or v_source_plan_version_id is null then
      raise exception 'Initial SiteForge artifact identity is incomplete';
    end if;
    if jsonb_typeof(v_asset_manifest) <> 'array'
      or v_asset_manifest_hash !~ '^[a-f0-9]{64}$' then
      raise exception 'Initial SiteForge asset snapshot is incomplete';
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
    insert into public.siteforge_blueprint_versions (
      website_id, org_id, property_id, version, blueprint_schema_version,
      blueprint, content_hash, parent_version_id, change_type, changes_summary,
      edit_intent, patches_applied, source_plan_version_id, shared_job_id,
      quality_report, quality_score, created_by, asset_manifest,
      asset_manifest_hash, base_theme_package_id, base_theme_package_sha256,
      site_configuration, motion_configuration
    )
    values (
      p_website_id, v_website.org_id, v_website.property_id, v_next_version, 2,
      p_blueprint, p_content_hash, null, 'generation', p_changes_summary,
      p_edit_intent, p_patches_applied, v_source_plan_version_id,
      v_shared_job_id, p_quality_report, p_quality_score, null,
      v_asset_manifest, v_asset_manifest_hash, p_base_theme_package_id,
      p_base_theme_package_sha256,
      coalesce(p_blueprint->'siteConfiguration', '{}'::jsonb),
      coalesce(p_blueprint->'siteConfiguration'->'motion', '{}'::jsonb)
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

    select coalesce(max(version), 0) + 1 into v_next_version
    from public.siteforge_blueprint_versions
    where website_id = p_website_id;

    insert into public.siteforge_blueprint_versions (
      website_id, org_id, property_id, version, blueprint_schema_version,
      blueprint, content_hash, parent_version_id, change_type, changes_summary,
      edit_intent, patches_applied, source_plan_version_id, quality_report,
      quality_score, created_by, asset_manifest, asset_manifest_hash,
      base_theme_package_id, base_theme_package_sha256, theme_overlay_id,
      overlay_package_sha256, site_configuration, motion_configuration
    )
    values (
      p_website_id, v_parent.org_id, v_parent.property_id, v_next_version,
      greatest(v_parent.blueprint_schema_version, 2), p_blueprint, p_content_hash,
      v_parent.id, p_change_type, p_changes_summary, p_edit_intent,
      p_patches_applied, v_release_source.source_plan_version_id, p_quality_report,
      p_quality_score, p_created_by, v_release_source.asset_manifest,
      v_release_source.asset_manifest_hash,
      coalesce(p_base_theme_package_id, v_release_source.base_theme_package_id),
      coalesce(p_base_theme_package_sha256, v_release_source.base_theme_package_sha256),
      v_release_source.theme_overlay_id, v_release_source.overlay_package_sha256,
      v_release_source.site_configuration, v_release_source.motion_configuration
    )
    returning * into v_created;
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
  text, text
) to service_role;

comment on function public.publish_siteforge_artifact_revision is
  'Atomically publishes initial, edit, import, or exact-package rollback SiteForge artifacts and reconciles the canonical website projection.';
