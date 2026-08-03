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
  p_created_by uuid
)
returns public.siteforge_blueprint_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_website public.property_websites%rowtype;
  v_parent public.siteforge_blueprint_versions%rowtype;
  v_created public.siteforge_blueprint_versions%rowtype;
  v_next_version integer;
begin
  select *
  into v_website
  from public.property_websites
  where id = p_website_id
  for update;

  if not found then
    raise exception 'SiteForge website not found';
  end if;
  if v_website.current_artifact_version_id is distinct from p_expected_artifact_id then
    raise exception 'SiteForge artifact version conflict';
  end if;
  if p_change_type not in ('edit', 'rollback', 'regeneration') then
    raise exception 'Unsupported SiteForge artifact change type';
  end if;
  if p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge artifact content hash';
  end if;

  select *
  into v_parent
  from public.siteforge_blueprint_versions
  where id = p_expected_artifact_id
    and website_id = p_website_id;
  if not found then
    raise exception 'Parent SiteForge artifact not found';
  end if;

  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.siteforge_blueprint_versions
  where website_id = p_website_id;

  insert into public.siteforge_blueprint_versions (
    website_id,
    org_id,
    property_id,
    version,
    blueprint_schema_version,
    blueprint,
    content_hash,
    parent_version_id,
    change_type,
    changes_summary,
    edit_intent,
    patches_applied,
    source_plan_version_id,
    quality_report,
    quality_score,
    created_by
  )
  values (
    p_website_id,
    v_parent.org_id,
    v_parent.property_id,
    v_next_version,
    v_parent.blueprint_schema_version,
    p_blueprint,
    p_content_hash,
    v_parent.id,
    p_change_type,
    p_changes_summary,
    p_edit_intent,
    p_patches_applied,
    v_parent.source_plan_version_id,
    p_quality_report,
    p_quality_score,
    p_created_by
  )
  returning * into v_created;

  update public.property_websites
  set
    current_artifact_version_id = v_created.id,
    blueprint = p_blueprint,
    pages_generated = p_blueprint->'pages',
    canonical_preview_url = null,
    canonical_preview_artifact_id = null,
    canonical_preview_content_hash = null,
    canonical_previewed_at = null,
    generation_status = 'ready_for_preview',
    updated_at = timezone('utc', now())
  where id = p_website_id;

  return v_created;
end;
$$;

grant execute on function public.publish_siteforge_artifact_revision(
  uuid,
  uuid,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb,
  numeric,
  uuid
) to service_role;

comment on function public.publish_siteforge_artifact_revision is
  'Atomically publishes an immutable edit or rollback artifact using optimistic concurrency and invalidates prior preview approval.';
