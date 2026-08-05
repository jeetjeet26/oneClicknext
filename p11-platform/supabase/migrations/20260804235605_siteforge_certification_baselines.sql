-- Policy-v4 SiteForge visual baselines and externally provisioned Lighthouse
-- evidence. Baseline identity is immutable and lifecycle transitions are only
-- available through approval-linked RPCs.

create table public.siteforge_visual_baselines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  runtime_package_sha256 text check (
    runtime_package_sha256 is null or runtime_package_sha256 ~ '^[a-f0-9]{64}$'
  ),
  runtime_manifest_sha256 text check (
    runtime_manifest_sha256 is null or runtime_manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  overlay_package_sha256 text check (
    overlay_package_sha256 is null or overlay_package_sha256 ~ '^[a-f0-9]{64}$'
  ),
  asset_manifest_hash text not null check (asset_manifest_hash ~ '^[a-f0-9]{64}$'),
  operation_set_hash text check (
    operation_set_hash is null or operation_set_hash ~ '^[a-f0-9]{64}$'
  ),
  page_url text not null,
  page_url_sha256 text not null check (page_url_sha256 ~ '^[a-f0-9]{64}$'),
  viewport text not null check (viewport in ('desktop', 'tablet', 'mobile')),
  viewport_width integer not null check (viewport_width > 0),
  viewport_height integer not null check (viewport_height > 0),
  environment text not null check (
    environment in ('protected_preview', 'staging', 'production')
  ),
  access_mode text not null check (access_mode in ('protected', 'public')),
  require_indexable boolean not null,
  policy_version text not null,
  binding_hash text not null check (binding_hash ~ '^[a-f0-9]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  screenshot_storage_path text not null,
  screenshot_sha256 text not null check (screenshot_sha256 ~ '^[a-f0-9]{64}$'),
  screenshot_bytes integer not null check (screenshot_bytes > 0),
  screenshot_content_type text not null check (screenshot_content_type = 'image/png'),
  captured_session_id text not null,
  captured_at timestamptz not null,
  captured_by_profile_id uuid references public.profiles(id) on delete restrict,
  status text not null default 'candidate'
    check (status in ('candidate', 'approved', 'superseded', 'revoked')),
  approval_action_attempt_id uuid references public.shared_action_attempts(id) on delete restrict,
  approval_id uuid references public.shared_approvals(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  superseded_by uuid references public.siteforge_visual_baselines(id) on delete restrict,
  superseded_at timestamptz,
  revocation_action_attempt_id uuid references public.shared_action_attempts(id) on delete restrict,
  revocation_approval_id uuid references public.shared_approvals(id) on delete restrict,
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_visual_baselines_tenant_identity_check check (
    length(trim(page_url)) > 0
    and length(trim(screenshot_storage_path)) > 0
    and length(trim(captured_session_id)) > 0
  ),
  constraint siteforge_visual_baselines_approval_state_check check (
    (status = 'candidate'
      and approval_id is null
      and approved_by is null
      and approved_at is null
      and superseded_by is null
      and superseded_at is null
      and revocation_action_attempt_id is null
      and revocation_approval_id is null
      and revoked_by is null
      and revoked_at is null)
    or
    (status = 'approved'
      and approval_action_attempt_id is not null
      and approval_id is not null
      and approved_by is not null
      and approved_at is not null
      and superseded_by is null
      and superseded_at is null
      and revocation_action_attempt_id is null
      and revocation_approval_id is null
      and revoked_by is null
      and revoked_at is null)
    or
    (status = 'superseded'
      and approval_id is not null
      and approved_by is not null
      and approved_at is not null
      and superseded_by is not null
      and superseded_at is not null
      and revocation_action_attempt_id is null
      and revocation_approval_id is null
      and revoked_by is null
      and revoked_at is null)
    or
    (status = 'revoked'
      and revocation_action_attempt_id is not null
      and revocation_approval_id is not null
      and revoked_by is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) > 0)
  ),
  unique (
    artifact_id,
    artifact_content_hash,
    page_url_sha256,
    viewport,
    environment,
    access_mode,
    require_indexable,
    policy_version,
    screenshot_sha256,
    binding_hash
  ),
  unique (screenshot_storage_path)
);

create unique index siteforge_visual_baselines_exact_approved_idx
  on public.siteforge_visual_baselines (
    org_id,
    property_id,
    website_id,
    artifact_id,
    artifact_content_hash,
    page_url_sha256,
    viewport,
    environment,
    access_mode,
    require_indexable,
    policy_version,
    binding_hash
  )
  where status = 'approved';

create index siteforge_visual_baselines_review_queue_idx
  on public.siteforge_visual_baselines (property_id, status, created_at desc);

create index siteforge_visual_baselines_exact_lookup_idx
  on public.siteforge_visual_baselines (
    website_id,
    artifact_id,
    artifact_content_hash,
    environment,
    access_mode,
    policy_version,
    page_url_sha256,
    viewport
  )
  where status = 'approved';

create table public.siteforge_lighthouse_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  page_url text not null,
  page_url_sha256 text not null check (page_url_sha256 ~ '^[a-f0-9]{64}$'),
  environment text not null check (environment in ('staging', 'production')),
  access_mode text not null check (access_mode in ('protected', 'public')),
  policy_version text not null,
  binding_hash text not null check (binding_hash ~ '^[a-f0-9]{64}$'),
  provider text not null,
  provider_run_id text not null,
  form_factor text not null check (form_factor in ('desktop', 'mobile')),
  report_storage_path text not null,
  report_sha256 text not null check (report_sha256 ~ '^[a-f0-9]{64}$'),
  runner_binary_sha256 text not null check (runner_binary_sha256 ~ '^[a-f0-9]{64}$'),
  runner_config_sha256 text not null check (runner_config_sha256 ~ '^[a-f0-9]{64}$'),
  tool_manifest_sha256 text not null check (tool_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (provider, provider_run_id),
  unique (report_storage_path),
  unique (
    artifact_id,
    page_url_sha256,
    environment,
    access_mode,
    policy_version,
    binding_hash,
    form_factor,
    report_sha256
  )
);

create index siteforge_lighthouse_evidence_identity_idx
  on public.siteforge_lighthouse_evidence (
    website_id,
    artifact_id,
    artifact_content_hash,
    environment,
    access_mode,
    policy_version,
    page_url_sha256,
    created_at desc
  );

alter table public.siteforge_certification_evidence
  add column binding_hash text check (
    binding_hash is null or binding_hash ~ '^[a-f0-9]{64}$'
  ),
  add column evidence_hash text check (
    evidence_hash is null or evidence_hash ~ '^[a-f0-9]{64}$'
  );

create or replace function public.guard_siteforge_visual_baseline_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'SiteForge visual baselines are immutable';
  end if;

  if row(
    old.org_id, old.property_id, old.website_id, old.artifact_id,
    old.artifact_content_hash, old.runtime_package_sha256,
    old.runtime_manifest_sha256, old.overlay_package_sha256,
    old.asset_manifest_hash, old.operation_set_hash, old.page_url,
    old.page_url_sha256, old.viewport, old.viewport_width,
    old.viewport_height, old.environment, old.access_mode,
    old.require_indexable, old.policy_version, old.binding_hash,
    old.evidence_digest, old.screenshot_storage_path,
    old.screenshot_sha256, old.screenshot_bytes,
    old.screenshot_content_type, old.captured_session_id,
    old.captured_at, old.captured_by_profile_id, old.created_at
  ) is distinct from row(
    new.org_id, new.property_id, new.website_id, new.artifact_id,
    new.artifact_content_hash, new.runtime_package_sha256,
    new.runtime_manifest_sha256, new.overlay_package_sha256,
    new.asset_manifest_hash, new.operation_set_hash, new.page_url,
    new.page_url_sha256, new.viewport, new.viewport_width,
    new.viewport_height, new.environment, new.access_mode,
    new.require_indexable, new.policy_version, new.binding_hash,
    new.evidence_digest, new.screenshot_storage_path,
    new.screenshot_sha256, new.screenshot_bytes,
    new.screenshot_content_type, new.captured_session_id,
    new.captured_at, new.captured_by_profile_id, new.created_at
  ) then
    raise exception 'SiteForge visual baseline identity is immutable';
  end if;

  if current_setting('siteforge.baseline_transition', true) <> 'approved' then
    raise exception 'SiteForge visual baseline lifecycle requires an approval-linked RPC';
  end if;
  return new;
end;
$$;

create or replace function public.validate_siteforge_visual_baseline_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'candidate'
    or new.approval_id is not null
    or new.approved_by is not null
    or new.approved_at is not null then
    raise exception 'Visual baselines must begin as unapproved candidates';
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
  ) or not exists (
    select 1
    from public.shared_action_attempts
    where id = new.approval_action_attempt_id
      and property_id = new.property_id
      and org_id = new.org_id
      and action_type = 'siteforge.certification:approve_visual_baseline'
      and proposal_decision_status = 'proposed'
  ) then
    raise exception 'Visual baseline tenant, artifact, or approval identity is invalid';
  end if;
  return new;
end;
$$;

create trigger validate_siteforge_visual_baseline_insert
before insert on public.siteforge_visual_baselines
for each row execute function public.validate_siteforge_visual_baseline_insert();

create trigger guard_siteforge_visual_baseline_immutability
before update or delete on public.siteforge_visual_baselines
for each row execute function public.guard_siteforge_visual_baseline_immutability();

create or replace function public.reject_siteforge_lighthouse_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'SiteForge Lighthouse evidence is immutable';
end;
$$;

create or replace function public.validate_siteforge_lighthouse_evidence_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
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
  ) then
    raise exception 'Lighthouse evidence tenant or artifact identity is invalid';
  end if;
  return new;
end;
$$;

create trigger validate_siteforge_lighthouse_evidence_insert
before insert on public.siteforge_lighthouse_evidence
for each row execute function public.validate_siteforge_lighthouse_evidence_insert();

create trigger reject_siteforge_lighthouse_evidence_mutation
before update or delete on public.siteforge_lighthouse_evidence
for each row execute function public.reject_siteforge_lighthouse_evidence_mutation();

create or replace function public.approve_siteforge_visual_baseline(
  p_baseline_id uuid,
  p_action_attempt_id uuid,
  p_approval_id uuid,
  p_reviewer_profile_id uuid
)
returns public.siteforge_visual_baselines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_baseline public.siteforge_visual_baselines;
  v_approval public.shared_approvals;
  v_action public.shared_action_attempts;
  v_role text;
begin
  select * into v_baseline
  from public.siteforge_visual_baselines
  where id = p_baseline_id
  for update;

  if v_baseline.id is null or v_baseline.status <> 'candidate' then
    raise exception 'Visual baseline candidate is unavailable';
  end if;

  select * into v_action
  from public.shared_action_attempts
  where id = p_action_attempt_id
    and org_id = v_baseline.org_id
    and property_id = v_baseline.property_id
    and action_type = 'siteforge.certification:approve_visual_baseline';

  select * into v_approval
  from public.shared_approvals
  where id = p_approval_id
    and action_attempt_id = p_action_attempt_id
    and org_id = v_baseline.org_id
    and property_id = v_baseline.property_id
    and reviewer_profile_id = p_reviewer_profile_id
    and decision_status = 'approved';

  select role into v_role
  from public.profiles
  where id = p_reviewer_profile_id
    and org_id = v_baseline.org_id;

  if v_action.id is null
    or v_action.proposal_decision_status <> 'approved'
    or v_approval.id is null
    or v_role not in ('admin', 'manager')
    or v_approval.created_at < v_baseline.created_at
    or v_baseline.captured_by_profile_id = p_reviewer_profile_id then
    raise exception 'Independent manager approval is required';
  end if;

  perform set_config('siteforge.baseline_transition', 'approved', true);

  update public.siteforge_visual_baselines
  set status = 'superseded',
      superseded_by = p_baseline_id,
      superseded_at = timezone('utc', now())
  where status = 'approved'
    and id <> p_baseline_id
    and org_id = v_baseline.org_id
    and property_id = v_baseline.property_id
    and website_id = v_baseline.website_id
    and artifact_id = v_baseline.artifact_id
    and artifact_content_hash = v_baseline.artifact_content_hash
    and page_url_sha256 = v_baseline.page_url_sha256
    and viewport = v_baseline.viewport
    and environment = v_baseline.environment
    and access_mode = v_baseline.access_mode
    and require_indexable = v_baseline.require_indexable
    and policy_version = v_baseline.policy_version
    and binding_hash = v_baseline.binding_hash;

  update public.siteforge_visual_baselines
  set status = 'approved',
      approval_action_attempt_id = p_action_attempt_id,
      approval_id = p_approval_id,
      approved_by = p_reviewer_profile_id,
      approved_at = timezone('utc', now())
  where id = p_baseline_id
  returning * into v_baseline;

  return v_baseline;
end;
$$;

create or replace function public.revoke_siteforge_visual_baseline(
  p_baseline_id uuid,
  p_action_attempt_id uuid,
  p_approval_id uuid,
  p_reviewer_profile_id uuid,
  p_reason text
)
returns public.siteforge_visual_baselines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_baseline public.siteforge_visual_baselines;
  v_approval public.shared_approvals;
  v_action public.shared_action_attempts;
  v_role text;
begin
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A revocation reason is required';
  end if;

  select * into v_baseline
  from public.siteforge_visual_baselines
  where id = p_baseline_id
  for update;

  if v_baseline.id is null or v_baseline.status not in ('candidate', 'approved') then
    raise exception 'Visual baseline is unavailable for revocation';
  end if;

  select * into v_action
  from public.shared_action_attempts
  where id = p_action_attempt_id
    and org_id = v_baseline.org_id
    and property_id = v_baseline.property_id
    and action_type in (
      'siteforge.certification:reject_visual_baseline',
      'siteforge.certification:revoke_visual_baseline'
    );

  select * into v_approval
  from public.shared_approvals
  where id = p_approval_id
    and action_attempt_id = p_action_attempt_id
    and org_id = v_baseline.org_id
    and property_id = v_baseline.property_id
    and reviewer_profile_id = p_reviewer_profile_id;

  select role into v_role
  from public.profiles
  where id = p_reviewer_profile_id
    and org_id = v_baseline.org_id;

  if v_action.id is null
    or v_approval.id is null
    or v_role not in ('admin', 'manager')
    or v_approval.created_at < v_baseline.created_at
    or v_baseline.captured_by_profile_id = p_reviewer_profile_id
    or (
      v_action.action_type = 'siteforge.certification:reject_visual_baseline'
      and v_approval.decision_status <> 'denied'
    )
    or (
      v_action.action_type = 'siteforge.certification:revoke_visual_baseline'
      and v_approval.decision_status <> 'approved'
    ) then
    raise exception 'Independent manager decision is required';
  end if;

  perform set_config('siteforge.baseline_transition', 'approved', true);
  update public.siteforge_visual_baselines
  set status = 'revoked',
      approval_action_attempt_id = coalesce(approval_action_attempt_id, p_action_attempt_id),
      approval_id = coalesce(approval_id, p_approval_id),
      revocation_action_attempt_id = p_action_attempt_id,
      revocation_approval_id = p_approval_id,
      revoked_by = p_reviewer_profile_id,
      revoked_at = timezone('utc', now()),
      revocation_reason = trim(p_reason)
  where id = p_baseline_id
  returning * into v_baseline;

  return v_baseline;
end;
$$;

alter table public.siteforge_visual_baselines enable row level security;
alter table public.siteforge_lighthouse_evidence enable row level security;

create policy "Users view property SiteForge visual baselines"
  on public.siteforge_visual_baselines for select
  using (
    exists (
      select 1
      from public.profiles
      join public.properties
        on properties.id = siteforge_visual_baselines.property_id
       and properties.org_id = siteforge_visual_baselines.org_id
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_visual_baselines.org_id
    )
  );

create policy "Service role manages SiteForge visual baselines"
  on public.siteforge_visual_baselines for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view property SiteForge Lighthouse evidence"
  on public.siteforge_lighthouse_evidence for select
  using (
    exists (
      select 1
      from public.profiles
      join public.properties
        on properties.id = siteforge_lighthouse_evidence.property_id
       and properties.org_id = siteforge_lighthouse_evidence.org_id
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_lighthouse_evidence.org_id
    )
  );

create policy "Service role manages SiteForge Lighthouse evidence"
  on public.siteforge_lighthouse_evidence for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.siteforge_visual_baselines,
  public.siteforge_lighthouse_evidence to authenticated;
grant all on public.siteforge_visual_baselines,
  public.siteforge_lighthouse_evidence to service_role;
revoke all on function public.approve_siteforge_visual_baseline(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.revoke_siteforge_visual_baseline(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.approve_siteforge_visual_baseline(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.revoke_siteforge_visual_baseline(
  uuid, uuid, uuid, uuid, text
) to service_role;

comment on table public.siteforge_visual_baselines is
  'Policy-v4 immutable screenshot candidates. Only an independently approved exact identity may be used for visual comparison.';
comment on table public.siteforge_lighthouse_evidence is
  'Immutable externally provisioned Lighthouse reports bound to URL, artifact, environment, access mode, policy, runner binary, config, and tool digests.';
