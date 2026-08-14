create or replace function public.apply_siteforge_direction_edit(
  p_parent_set_id uuid,
  p_property_id uuid,
  p_expected_set_hash text,
  p_expected_direction_hash text,
  p_selected_ordinal integer,
  p_candidates jsonb,
  p_result_set_hash text,
  p_client_request_id text,
  p_model text,
  p_request_summary text,
  p_tool_summary text,
  p_actor_id uuid
)
returns setof public.siteforge_creative_direction_sets
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.siteforge_creative_direction_sets;
  v_result public.siteforge_creative_direction_sets;
  v_candidate jsonb;
  v_selected_id uuid;
  v_job_id uuid;
  v_action_id uuid;
  v_existing_result_id uuid;
  v_now timestamptz := timezone('utc', now());
begin
  if nullif(btrim(p_client_request_id), '') is null or
     length(p_client_request_id) > 160 then
    raise exception 'A valid client request identifier is required';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' or
     jsonb_array_length(p_candidates) not between 2 and 3 then
    raise exception 'Creative direction edits require two or three candidates';
  end if;

  select * into v_parent
  from public.siteforge_creative_direction_sets
  where id = p_parent_set_id and property_id = p_property_id
  for update;

  if v_parent.id is null then
    raise exception 'Creative direction set not found';
  end if;

  select nullif(payload->>'resultSetId', '')::uuid into v_existing_result_id
  from public.shared_jobs
  where org_id = v_parent.org_id
    and domain = 'siteforge.direction.edit'
    and dedupe_key = 'siteforge-direction-edit:' || v_parent.id::text || ':' || p_client_request_id
  limit 1;
  if v_existing_result_id is not null then
    return query
      select * from public.siteforge_creative_direction_sets
      where id = v_existing_result_id and property_id = p_property_id;
    return;
  end if;

  if v_parent.status not in ('ready_for_review', 'draft') or
     v_parent.content_hash <> p_expected_set_hash then
    raise exception 'Creative direction set changed; reload before editing';
  end if;
  if not exists (
    select 1 from public.siteforge_creative_directions
    where direction_set_id = v_parent.id
      and ordinal = p_selected_ordinal
      and content_hash = p_expected_direction_hash
  ) then
    raise exception 'Selected creative direction changed; reload before editing';
  end if;
  if p_result_set_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid creative direction result hash';
  end if;

  insert into public.siteforge_creative_direction_sets (
    org_id, property_id, website_id, brief_version_id, version, status,
    selection_notes, content_hash, created_by
  ) values (
    v_parent.org_id, v_parent.property_id, v_parent.website_id,
    v_parent.brief_version_id, v_parent.version + 1, 'ready_for_review',
    v_parent.selection_notes, p_result_set_hash, p_actor_id
  )
  returning * into v_result;

  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if (v_candidate->>'contentHash') !~ '^[a-f0-9]{64}$' or
       jsonb_typeof(v_candidate->'direction') <> 'object' or
       jsonb_typeof(v_candidate->'previewManifest') <> 'object' then
      raise exception 'Invalid creative direction candidate';
    end if;
    insert into public.siteforge_creative_directions (
      direction_set_id, org_id, property_id, website_id, ordinal, name,
      direction, preview_manifest, content_hash
    ) values (
      v_result.id, v_parent.org_id, v_parent.property_id, v_parent.website_id,
      (v_candidate->>'ordinal')::integer, v_candidate->>'name',
      v_candidate->'direction', v_candidate->'previewManifest',
      v_candidate->>'contentHash'
    )
    returning id into v_action_id;
    if (v_candidate->>'ordinal')::integer = p_selected_ordinal then
      v_selected_id := v_action_id;
    end if;
  end loop;

  if v_selected_id is null then
    raise exception 'Revised selected creative direction is missing';
  end if;

  update public.siteforge_creative_direction_sets
  set selected_direction_id = v_selected_id
  where id = v_result.id
  returning * into v_result;

  insert into public.shared_jobs (
    org_id, property_id, domain, subject_type, subject_id,
    lifecycle_status, status_reason, dedupe_key, payload, output,
    attempt_count, started_at, finished_at
  ) values (
    v_parent.org_id, v_parent.property_id, 'siteforge.direction.edit',
    'siteforge_creative_direction_set', v_result.id::text, 'succeeded',
    'creative_direction_revision_created',
    'siteforge-direction-edit:' || v_parent.id::text || ':' || p_client_request_id,
    jsonb_build_object(
      'websiteId', v_parent.website_id,
      'parentSetId', v_parent.id,
      'resultSetId', v_result.id,
      'parentHash', v_parent.content_hash,
      'resultHash', v_result.content_hash,
      'model', p_model,
      'requestSummary', p_request_summary,
      'toolSummary', p_tool_summary,
      'actorId', p_actor_id
    ),
    jsonb_build_object('resultSetId', v_result.id, 'resultHash', v_result.content_hash),
    1, v_now, v_now
  ) returning id into v_job_id;

  insert into public.shared_action_attempts (
    job_id, org_id, property_id, action_type, lifecycle_status,
    proposal_decision_status, execution_status, requested_by, reviewed_by,
    request_payload, execution_payload, execution_result, confidence_score,
    policy_reason, decided_at, executed_at
  ) values (
    v_job_id, v_parent.org_id, v_parent.property_id,
    'siteforge.direction:apply_conversational_edit',
    'succeeded', 'approved', 'executed', p_actor_id, p_actor_id,
    jsonb_build_object(
      'clientRequestId', p_client_request_id,
      'parentSetId', v_parent.id,
      'parentHash', v_parent.content_hash,
      'expectedDirectionHash', p_expected_direction_hash,
      'model', p_model,
      'requestSummary', p_request_summary,
      'toolSummary', p_tool_summary,
      'actorId', p_actor_id
    ),
    jsonb_build_object('resultSetId', v_result.id, 'resultHash', v_result.content_hash),
    jsonb_build_object(
      'parentSetId', v_parent.id,
      'resultSetId', v_result.id,
      'parentHash', v_parent.content_hash,
      'resultHash', v_result.content_hash
    ),
    1, 'Operator accepted a structured, brand-bound creative direction edit.',
    v_now, v_now
  ) returning id into v_action_id;

  update public.siteforge_creative_direction_sets
  set status = 'superseded'
  where id = v_parent.id
    and content_hash = p_expected_set_hash;

  return next v_result;
end;
$$;

revoke all on function public.apply_siteforge_direction_edit(
  uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.apply_siteforge_direction_edit(
  uuid, uuid, text, text, integer, jsonb, text, text, text, text, text, uuid
) to service_role;
