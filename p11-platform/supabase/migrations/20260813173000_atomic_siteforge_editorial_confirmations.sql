create or replace function public.save_current_siteforge_brief(
  p_website_id uuid,
  p_expected_version integer,
  p_brief jsonb,
  p_onboarding_snapshot_id uuid,
  p_onboarding_snapshot_hash text,
  p_brand_asset_id uuid,
  p_brand_contract_hash text,
  p_content_hash text,
  p_actor_id uuid,
  p_reason text
)
returns setof public.siteforge_brief_versions
language plpgsql
set search_path = ''
as $$
declare
  v_website public.property_websites;
  v_latest_version integer;
  v_brief public.siteforge_brief_versions;
  v_job_id uuid;
  v_action_id uuid;
  v_approval_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select * into v_website
  from public.property_websites
  where id = p_website_id
  for update;

  if v_website.id is null then
    raise exception 'SiteForge website not found';
  end if;
  if jsonb_array_length(coalesce(p_brief->'unresolvedContradictions', '[]'::jsonb)) > 0 then
    raise exception 'Resolve every brief contradiction before saving it as current';
  end if;

  select coalesce(max(version), 0) into v_latest_version
  from public.siteforge_brief_versions
  where website_id = p_website_id;
  if v_latest_version <> p_expected_version then
    raise exception 'Brief version changed; reload before saving';
  end if;

  update public.siteforge_brief_versions
  set status = 'superseded'
  where website_id = p_website_id
    and status in ('draft', 'ready_for_review', 'approved', 'modified');

  insert into public.siteforge_brief_versions (
    org_id, property_id, website_id, version, status, brief,
    unresolved_contradictions, onboarding_snapshot_id,
    onboarding_snapshot_hash, brand_asset_id, brand_contract_hash,
    content_hash, decision_reason, approved_by, approved_at, created_by
  ) values (
    v_website.org_id, v_website.property_id, v_website.id,
    v_latest_version + 1, 'approved', p_brief->'brief', '[]'::jsonb,
    p_onboarding_snapshot_id, p_onboarding_snapshot_hash, p_brand_asset_id,
    p_brand_contract_hash, p_content_hash, p_reason, p_actor_id, v_now, p_actor_id
  )
  returning * into v_brief;

  insert into public.shared_jobs (
    org_id, property_id, domain, subject_type, subject_id,
    lifecycle_status, status_reason, dedupe_key, payload,
    attempt_count, started_at, finished_at
  ) values (
    v_website.org_id, v_website.property_id, 'siteforge.brief',
    'siteforge_brief_version', v_brief.id::text, 'succeeded',
    'current_brief_saved', 'siteforge-brief-current:' || v_brief.id::text,
    jsonb_build_object('websiteId', v_website.id, 'briefVersionId', v_brief.id,
      'version', v_brief.version, 'contentHash', p_content_hash),
    1, v_now, v_now
  ) returning id into v_job_id;

  insert into public.shared_action_attempts (
    job_id, org_id, property_id, action_type, lifecycle_status,
    proposal_decision_status, execution_status, requested_by, reviewed_by,
    request_payload, execution_payload, execution_result, confidence_score,
    policy_reason, decided_at, executed_at
  ) values (
    v_job_id, v_website.org_id, v_website.property_id,
    'siteforge.brief:save_current', 'succeeded', 'approved', 'executed',
    p_actor_id, p_actor_id,
    jsonb_build_object('briefVersionId', v_brief.id, 'contentHash', p_content_hash),
    jsonb_build_object('briefVersionId', v_brief.id),
    jsonb_build_object('savedAsCurrent', true), 1, p_reason, v_now, v_now
  ) returning id into v_action_id;

  insert into public.shared_approvals (
    action_attempt_id, org_id, property_id, decision_status,
    decision_reason, reviewer_profile_id, decision_payload
  ) values (
    v_action_id, v_website.org_id, v_website.property_id, 'approved',
    p_reason, p_actor_id,
    jsonb_build_object('briefVersionId', v_brief.id, 'version', v_brief.version,
      'contentHash', p_content_hash, 'sources', jsonb_build_object(
        'onboardingSnapshotId', p_onboarding_snapshot_id,
        'onboardingSnapshotHash', p_onboarding_snapshot_hash,
        'brandAssetId', p_brand_asset_id,
        'brandContractHash', p_brand_contract_hash))
  ) returning id into v_approval_id;

  insert into public.shared_policy_decisions (
    org_id, property_id, job_id, action_attempt_id, policy_name,
    policy_version, decision_status, decision_reason, confidence_score,
    decision_payload
  ) values (
    v_website.org_id, v_website.property_id, v_job_id, v_action_id,
    'siteforge_brief_confirmation', 'v2', 'approved', p_reason, 1,
    jsonb_build_object('unresolvedContradictions', '[]'::jsonb)
  );

  update public.siteforge_brief_versions
  set approval_action_attempt_id = v_action_id,
      confirmed_approval_id = v_approval_id
  where id = v_brief.id
  returning * into v_brief;

  return next v_brief;
end;
$$;

revoke all on function public.save_current_siteforge_brief(
  uuid, integer, jsonb, uuid, text, uuid, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.save_current_siteforge_brief(
  uuid, integer, jsonb, uuid, text, uuid, text, text, uuid, text
) to service_role;

create or replace function public.confirm_siteforge_creative_direction(
  p_direction_set_id uuid,
  p_property_id uuid,
  p_selected_direction_id uuid,
  p_expected_content_hash text,
  p_confirmed_content_hash text,
  p_selection_notes text,
  p_actor_id uuid,
  p_reason text
)
returns setof public.siteforge_creative_direction_sets
language plpgsql
set search_path = ''
as $$
declare
  v_set public.siteforge_creative_direction_sets;
  v_job_id uuid;
  v_action_id uuid;
  v_approval_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select * into v_set
  from public.siteforge_creative_direction_sets
  where id = p_direction_set_id and property_id = p_property_id
  for update;

  if v_set.id is null then raise exception 'Creative direction set not found'; end if;
  if v_set.status not in ('draft', 'ready_for_review') or
     v_set.content_hash <> p_expected_content_hash then
    raise exception 'Creative direction set changed; reload before selecting';
  end if;
  if not exists (
    select 1 from public.siteforge_creative_directions
    where id = p_selected_direction_id and direction_set_id = v_set.id
      and org_id = v_set.org_id and property_id = v_set.property_id
      and website_id = v_set.website_id
  ) then
    raise exception 'Selected direction does not belong to this set';
  end if;
  if not exists (
    select 1 from public.siteforge_brief_versions
    where id = v_set.brief_version_id and status = 'approved'
  ) then
    raise exception 'Pinned brief is no longer approved';
  end if;

  insert into public.shared_jobs (
    org_id, property_id, domain, subject_type, subject_id,
    lifecycle_status, status_reason, dedupe_key, payload,
    attempt_count, started_at, finished_at
  ) values (
    v_set.org_id, v_set.property_id, 'siteforge.direction',
    'siteforge_creative_direction_set', v_set.id::text, 'succeeded',
    'creative_direction_confirmed',
    'siteforge-direction-confirm:' || v_set.id::text || ':' || p_confirmed_content_hash,
    jsonb_build_object('websiteId', v_set.website_id, 'directionSetId', v_set.id,
      'selectedDirectionId', p_selected_direction_id,
      'contentHash', p_confirmed_content_hash),
    1, v_now, v_now
  ) returning id into v_job_id;

  insert into public.shared_action_attempts (
    job_id, org_id, property_id, action_type, lifecycle_status,
    proposal_decision_status, execution_status, requested_by, reviewed_by,
    request_payload, execution_payload, execution_result, confidence_score,
    policy_reason, decided_at, executed_at
  ) values (
    v_job_id, v_set.org_id, v_set.property_id,
    'siteforge.direction:confirm_selection', 'succeeded', 'approved', 'executed',
    p_actor_id, p_actor_id,
    jsonb_build_object('directionSetId', v_set.id,
      'selectedDirectionId', p_selected_direction_id,
      'contentHash', p_confirmed_content_hash),
    jsonb_build_object('directionSetId', v_set.id),
    jsonb_build_object('confirmed', true), 1, p_reason, v_now, v_now
  ) returning id into v_action_id;

  insert into public.shared_approvals (
    action_attempt_id, org_id, property_id, decision_status,
    decision_reason, reviewer_profile_id, decision_payload
  ) values (
    v_action_id, v_set.org_id, v_set.property_id, 'approved',
    p_reason, p_actor_id,
    jsonb_build_object('directionSetId', v_set.id,
      'selectedDirectionId', p_selected_direction_id,
      'contentHash', p_confirmed_content_hash,
      'selectionNotes', nullif(btrim(p_selection_notes), ''))
  ) returning id into v_approval_id;

  insert into public.shared_policy_decisions (
    org_id, property_id, job_id, action_attempt_id, policy_name,
    policy_version, decision_status, decision_reason, confidence_score,
    decision_payload
  ) values (
    v_set.org_id, v_set.property_id, v_job_id, v_action_id,
    'siteforge_creative_direction_confirmation', 'v2', 'approved',
    p_reason, 1, jsonb_build_object('briefVersionId', v_set.brief_version_id)
  );

  update public.siteforge_creative_direction_sets
  set selected_direction_id = p_selected_direction_id,
      selection_notes = nullif(btrim(p_selection_notes), ''),
      content_hash = p_confirmed_content_hash,
      status = 'approved',
      approval_action_attempt_id = v_action_id,
      confirmed_approval_id = v_approval_id,
      approved_by = p_actor_id,
      approved_at = v_now
  where id = v_set.id
  returning * into v_set;

  return next v_set;
end;
$$;

revoke all on function public.confirm_siteforge_creative_direction(
  uuid, uuid, uuid, text, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.confirm_siteforge_creative_direction(
  uuid, uuid, uuid, text, text, text, uuid, text
) to service_role;
