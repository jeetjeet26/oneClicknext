alter table public.siteforge_visual_baselines
  add column if not exists system_policy_decision_id uuid
    references public.shared_policy_decisions(id);

alter table public.siteforge_visual_baselines
  drop constraint if exists siteforge_visual_baselines_decision_identity_check;

alter table public.siteforge_visual_baselines
  add constraint siteforge_visual_baselines_decision_identity_check
  check (
    (approval_action_attempt_id is not null and system_policy_decision_id is null)
    or
    (approval_action_attempt_id is null and system_policy_decision_id is not null)
  );

create or replace function public.validate_siteforge_visual_baseline_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_has_decision boolean;
begin
  if new.status <> 'candidate'
    or new.approval_id is not null
    or new.approved_by is not null
    or new.approved_at is not null then
    raise exception 'Visual baselines must begin as immutable candidates';
  end if;

  if new.approval_action_attempt_id is not null then
    select exists (
      select 1
      from public.shared_action_attempts
      where id = new.approval_action_attempt_id
        and property_id = new.property_id
        and org_id = new.org_id
        and action_type = 'siteforge.certification:approve_visual_baseline'
        and proposal_decision_status = 'proposed'
    ) into v_has_decision;
  else
    select exists (
      select 1
      from public.shared_policy_decisions
      where id = new.system_policy_decision_id
        and property_id = new.property_id
        and org_id = new.org_id
        and policy_name = 'siteforge.visual_baseline_seed'
        and policy_version = new.policy_version
        and decision_status = 'approved'
        and actor_type = 'system_policy'
        and enforcement_outcome = 'allow'
        and decision_payload->>'baselineId' = new.id::text
        and decision_payload->>'screenshotSha256' = new.screenshot_sha256
        and decision_payload->>'bindingHash' = new.binding_hash
    ) into v_has_decision;
  end if;

  if not exists (
    select 1
    from public.properties
    where id = new.property_id
      and org_id = new.org_id
  ) or not exists (
    select 1
    from public.property_websites
    where id = new.website_id
      and property_id = new.property_id
      and org_id = new.org_id
  ) or not exists (
    select 1
    from public.siteforge_blueprint_versions
    where id = new.artifact_id
      and website_id = new.website_id
      and property_id = new.property_id
      and org_id = new.org_id
      and content_hash = new.artifact_content_hash
  ) or not v_has_decision then
    raise exception 'Visual baseline tenant, artifact, or policy identity is invalid';
  end if;
  return new;
end;
$$;
