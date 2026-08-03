-- Autonomous SiteForge operations control plane.
-- Legal/rights decisions and production launch remain explicit human gates.

alter table public.content_assets
  add column if not exists file_size_bytes bigint,
  add column if not exists format text,
  add column if not exists storage_bucket text,
  add column if not exists storage_path text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'content_assets'
      and column_name = 'file_size'
  ) then
    execute $backfill$
      update public.content_assets
      set file_size_bytes = file_size
      where file_size_bytes is null
        and file_size is not null
    $backfill$;
  end if;
end
$$;

alter table public.lead_engagement_events
  add column if not exists idempotency_key text;

create unique index if not exists lead_engagement_events_idempotency_idx
  on public.lead_engagement_events (property_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.siteforge_rollout_audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  original_content_hash text,
  canonical_content_hash text,
  classification text not null check (classification in ('deployable', 'repairable', 'quarantined')),
  reason_codes jsonb not null default '[]'::jsonb,
  repair_metadata jsonb not null default '{}'::jsonb,
  repaired_at timestamptz,
  audited_at timestamptz not null default timezone('utc', now()),
  unique (website_id, artifact_id)
);

create index if not exists siteforge_rollout_audits_classification_idx
  on public.siteforge_rollout_audits (classification, audited_at desc);

insert into public.siteforge_rollout_audits (
  org_id, property_id, website_id, artifact_id, original_content_hash,
  classification, reason_codes
)
select
  bv.org_id,
  bv.property_id,
  bv.website_id,
  bv.id,
  bv.content_hash,
  case
    when bv.content_hash ~ '^[a-f0-9]{64}$'
      and bv.asset_manifest_hash ~ '^[a-f0-9]{64}$'
      and bv.base_theme_package_sha256 ~ '^[a-f0-9]{64}$'
      then 'deployable'
    when bv.content_hash ~ '^[a-f0-9]{32}$'
      and jsonb_typeof(bv.blueprint) = 'object'
      then 'repairable'
    else 'quarantined'
  end,
  case
    when bv.content_hash ~ '^[a-f0-9]{64}$'
      and bv.asset_manifest_hash ~ '^[a-f0-9]{64}$'
      and bv.base_theme_package_sha256 ~ '^[a-f0-9]{64}$'
      then '[]'::jsonb
    when bv.content_hash ~ '^[a-f0-9]{32}$'
      and jsonb_typeof(bv.blueprint) = 'object'
      then '["legacy_md5_content_hash"]'::jsonb
    else jsonb_build_array(
      case when bv.content_hash !~ '^[a-f0-9]{32}$|^[a-f0-9]{64}$'
        then 'invalid_content_hash' else 'incomplete_release_identity' end
    )
  end
from public.siteforge_blueprint_versions bv
on conflict (website_id, artifact_id) do nothing;

create table if not exists public.siteforge_launch_releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  release_version integer not null check (release_version > 0),
  state text not null default 'prepared' check (state in (
    'prepared', 'certified', 'launch_approved', 'backed_up', 'promoted',
    'production_certified', 'live', 'failed', 'rolled_back'
  )),
  state_version integer not null default 1 check (state_version > 0),
  artifact_id uuid not null references public.siteforge_blueprint_versions(id),
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  staging_deployment_id uuid references public.siteforge_artifact_deployments(id) on delete restrict,
  launch_action_attempt_id uuid references public.shared_action_attempts(id) on delete restrict,
  launch_approval_id uuid references public.shared_approvals(id) on delete restrict,
  approval_expires_at timestamptz,
  legal_rights_snapshot jsonb not null default '{}'::jsonb,
  approval_rationale text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  rollback_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete restrict,
  rollback_content_hash text check (rollback_content_hash is null or rollback_content_hash ~ '^[a-f0-9]{64}$'),
  backup_provider text,
  backup_id text,
  backup_operation_id text,
  backed_up_at timestamptz,
  promotion_provider text,
  promotion_operation_id text,
  promotion_token_hash text,
  promotion_token_expires_at timestamptz,
  promotion_token_consumed_at timestamptz,
  promoted_at timestamptz,
  production_certification_report jsonb,
  production_certified_at timestamptz,
  live_at timestamptz,
  rolled_back_at timestamptz,
  failure_code text,
  failure_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (website_id, release_version)
);

create unique index if not exists siteforge_launch_one_active_idx
  on public.siteforge_launch_releases (website_id)
  where state not in ('live', 'failed', 'rolled_back');
create index if not exists siteforge_launch_state_idx
  on public.siteforge_launch_releases (org_id, state, updated_at desc);

create table if not exists public.siteforge_launch_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.siteforge_launch_releases(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  from_state text,
  to_state text not null,
  actor_type text not null check (actor_type in ('system', 'operator', 'provider')),
  actor_id uuid references public.profiles(id) on delete set null,
  rationale text,
  evidence jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists siteforge_launch_events_release_idx
  on public.siteforge_launch_events (release_id, created_at);

create table if not exists public.siteforge_certification_evidence (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete cascade,
  release_id uuid references public.siteforge_launch_releases(id) on delete set null,
  policy_version text not null,
  environment text not null check (environment in ('preview', 'staging', 'production')),
  status text not null check (status in ('passed', 'failed', 'waived')),
  report jsonb not null default '{}'::jsonb,
  evidence_manifest jsonb not null default '{}'::jsonb,
  report_hash text not null check (report_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.siteforge_certification_waivers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete cascade,
  check_code text not null,
  policy_version text not null,
  rationale text not null,
  evidence jsonb not null default '{}'::jsonb,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.siteforge_outbox_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete set null,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  handler_version text not null default 'v1',
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  consent_evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'retrying', 'delivered', 'dead_lettered', 'cancelled'
  )),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  available_at timestamptz not null default timezone('utc', now()),
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, event_type, idempotency_key)
);

create index if not exists siteforge_outbox_claim_idx
  on public.siteforge_outbox_events (status, available_at, created_at)
  where status in ('pending', 'retrying');

create table if not exists public.siteforge_outbox_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.siteforge_outbox_events(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  provider text,
  provider_request_id text,
  provider_response jsonb,
  status text not null check (status in ('started', 'delivered', 'retryable_failure', 'permanent_failure')),
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  unique (event_id, attempt_number)
);

create table if not exists public.siteforge_attribution_touches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete set null,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  session_id text not null,
  lead_id uuid references public.leads(id) on delete set null,
  touch_position text not null check (touch_position in ('first', 'last', 'intermediate')),
  source text,
  medium text,
  campaign text,
  term text,
  content text,
  click_ids jsonb not null default '{}'::jsonb,
  landing_page text,
  referrer text,
  consent_evidence jsonb not null default '{}'::jsonb,
  touched_at timestamptz not null default timezone('utc', now())
);

create index if not exists siteforge_attribution_session_idx
  on public.siteforge_attribution_touches (website_id, session_id, touched_at);

create table if not exists public.siteforge_inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null check (provider in ('siteforge', 'manual', 'csv', 'yardi', 'rentcafe')),
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'expired')),
  source_cursor text,
  source_watermark timestamptz,
  raw_snapshot jsonb,
  snapshot_hash text check (snapshot_hash is null or snapshot_hash ~ '^[a-f0-9]{64}$'),
  units_seen integer not null default 0,
  units_changed integer not null default 0,
  units_deactivated integer not null default 0,
  expires_at timestamptz,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.property_units
  add column if not exists inventory_sync_run_id uuid
    references public.siteforge_inventory_sync_runs(id) on delete set null,
  add column if not exists expires_at timestamptz;

create table if not exists public.siteforge_analytics_destinations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete cascade,
  destination_type text not null check (destination_type in ('ga4', 'gtm', 'webhook')),
  destination_identity text not null,
  configuration jsonb not null default '{}'::jsonb,
  consent_mode text not null default 'required' check (consent_mode in ('required', 'not_required')),
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (property_id, destination_type, destination_identity)
);

create table if not exists public.siteforge_funnel_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete cascade,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  metrics jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default timezone('utc', now()),
  unique (website_id, artifact_id, window_start, window_end)
);

create table if not exists public.siteforge_health_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  status text not null check (status in ('running', 'healthy', 'degraded', 'unhealthy', 'failed')),
  trigger_type text not null check (trigger_type in ('scheduled', 'launch', 'manual', 'repair', 'restore')),
  checks jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create table if not exists public.siteforge_incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  dedupe_key text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'repairing', 'resolved')),
  category text not null,
  title text not null,
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  owner_id uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists siteforge_incidents_active_dedupe_idx
  on public.siteforge_incidents (website_id, dedupe_key)
  where status <> 'resolved';

create table if not exists public.siteforge_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.siteforge_incidents(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.siteforge_repair_attempts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.siteforge_incidents(id) on delete cascade,
  shared_job_id uuid references public.shared_jobs(id) on delete set null,
  repair_type text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  status text not null check (status in ('proposed', 'approved', 'running', 'succeeded', 'failed', 'reverted')),
  attempt_number integer not null default 1,
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (incident_id, repair_type, attempt_number)
);

create table if not exists public.siteforge_restore_drills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  release_id uuid references public.siteforge_launch_releases(id) on delete set null,
  backup_id text not null,
  expected_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete restrict,
  expected_content_hash text not null check (expected_content_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('queued', 'restoring', 'verifying', 'succeeded', 'failed')),
  provider_operation_id text,
  verification_report jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.siteforge_autonomy_modes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  action_scope text not null,
  mode text not null check (mode in ('observe_only', 'recommend', 'supervised', 'bounded_auto')),
  limits jsonb not null default '{}'::jsonb,
  holdout_percent integer not null default 0 check (holdout_percent between 0 and 100),
  policy_version text not null,
  rationale text not null,
  promoted_by uuid references public.profiles(id) on delete set null,
  frozen_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  superseded_at timestamptz
);

create unique index if not exists siteforge_autonomy_active_scope_idx
  on public.siteforge_autonomy_modes (org_id, coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid), action_scope)
  where superseded_at is null;

create table if not exists public.siteforge_failure_injections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  failpoint text not null,
  scope_key text not null,
  remaining_hits integer not null default 1 check (remaining_hits >= 0),
  expires_at timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (org_id, failpoint, scope_key)
);

create or replace function public.transition_siteforge_launch_release(
  p_release_id uuid,
  p_expected_state_version integer,
  p_to_state text,
  p_actor_type text,
  p_actor_id uuid,
  p_rationale text,
  p_evidence jsonb,
  p_request_id text
)
returns public.siteforge_launch_releases
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_release public.siteforge_launch_releases%rowtype;
  v_from_state text;
begin
  select * into v_release
  from public.siteforge_launch_releases
  where id = p_release_id
  for update;

  if not found then raise exception 'SiteForge launch release not found'; end if;
  v_from_state := v_release.state;
  if v_release.state_version <> p_expected_state_version then
    raise exception 'SiteForge launch release version conflict';
  end if;
  if not (
    (v_release.state = 'prepared' and p_to_state in ('certified', 'failed')) or
    (v_release.state = 'certified' and p_to_state in ('launch_approved', 'failed')) or
    (v_release.state = 'launch_approved' and p_to_state in ('backed_up', 'failed')) or
    (v_release.state = 'backed_up' and p_to_state in ('promoted', 'failed')) or
    (v_release.state = 'promoted' and p_to_state in ('production_certified', 'failed', 'rolled_back')) or
    (v_release.state = 'production_certified' and p_to_state in ('live', 'failed', 'rolled_back')) or
    (v_release.state = 'live' and p_to_state = 'rolled_back') or
    (v_release.state = 'failed' and p_to_state = 'rolled_back')
  ) then
    raise exception 'Invalid SiteForge launch state transition: % -> %', v_release.state, p_to_state;
  end if;

  update public.siteforge_launch_releases
  set state = p_to_state,
      state_version = state_version + 1,
      updated_at = timezone('utc', now()),
      live_at = case when p_to_state = 'live' then timezone('utc', now()) else live_at end,
      rolled_back_at = case when p_to_state = 'rolled_back' then timezone('utc', now()) else rolled_back_at end
  where id = p_release_id
  returning * into v_release;

  insert into public.siteforge_launch_events (
    release_id, org_id, from_state, to_state, actor_type, actor_id,
    rationale, evidence, request_id
  ) values (
    v_release.id, v_release.org_id,
    v_from_state,
    p_to_state, p_actor_type, p_actor_id, p_rationale,
    coalesce(p_evidence, '{}'::jsonb), p_request_id
  );

  return v_release;
end;
$$;

create or replace function public.claim_siteforge_outbox_events(
  p_worker_id text,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.siteforge_outbox_events
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with claimable as (
    select id
    from public.siteforge_outbox_events
    where status in ('pending', 'retrying')
      and available_at <= timezone('utc', now())
      and (lease_expires_at is null or lease_expires_at < timezone('utc', now()))
    order by available_at, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.siteforge_outbox_events event
  set status = 'processing',
      lease_owner = p_worker_id,
      lease_expires_at = timezone('utc', now()) + make_interval(secs => greatest(30, p_lease_seconds)),
      attempts = attempts + 1,
      updated_at = timezone('utc', now())
  from claimable
  where event.id = claimable.id
  returning event.*;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'siteforge_rollout_audits', 'siteforge_launch_releases',
    'siteforge_launch_events', 'siteforge_certification_evidence',
    'siteforge_certification_waivers', 'siteforge_outbox_events',
    'siteforge_outbox_attempts', 'siteforge_attribution_touches',
    'siteforge_inventory_sync_runs', 'siteforge_analytics_destinations',
    'siteforge_funnel_snapshots', 'siteforge_health_runs',
    'siteforge_incidents', 'siteforge_incident_events',
    'siteforge_repair_attempts', 'siteforge_restore_drills',
    'siteforge_autonomy_modes', 'siteforge_failure_injections'
  ]
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
      'Service role manages ' || v_table, v_table
    );
  end loop;
end
$$;

create policy "Users view org SiteForge rollout audits"
  on public.siteforge_rollout_audits for select using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_rollout_audits.org_id
  ));
create policy "Users view org SiteForge launch releases"
  on public.siteforge_launch_releases for select using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_launch_releases.org_id
  ));
create policy "Users view org SiteForge launch events"
  on public.siteforge_launch_events for select using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_launch_events.org_id
  ));
create policy "Users view org SiteForge certification evidence"
  on public.siteforge_certification_evidence for select using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_certification_evidence.org_id
  ));
create policy "Users view org SiteForge incidents"
  on public.siteforge_incidents for select using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_incidents.org_id
  ));
create policy "Users view org SiteForge health"
  on public.siteforge_health_runs for select using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_health_runs.org_id
  ));

grant select on public.siteforge_rollout_audits,
  public.siteforge_launch_releases, public.siteforge_launch_events,
  public.siteforge_certification_evidence, public.siteforge_incidents,
  public.siteforge_health_runs to authenticated;
grant all on public.siteforge_rollout_audits,
  public.siteforge_launch_releases, public.siteforge_launch_events,
  public.siteforge_certification_evidence, public.siteforge_certification_waivers,
  public.siteforge_outbox_events, public.siteforge_outbox_attempts,
  public.siteforge_attribution_touches, public.siteforge_inventory_sync_runs,
  public.siteforge_analytics_destinations, public.siteforge_funnel_snapshots,
  public.siteforge_health_runs, public.siteforge_incidents,
  public.siteforge_incident_events, public.siteforge_repair_attempts,
  public.siteforge_restore_drills, public.siteforge_autonomy_modes,
  public.siteforge_failure_injections to service_role;
grant execute on function public.transition_siteforge_launch_release(
  uuid, integer, text, text, uuid, text, jsonb, text
) to service_role;
grant execute on function public.claim_siteforge_outbox_events(text, integer, integer)
  to service_role;

comment on table public.siteforge_launch_releases is
  'Versioned, immutable-identity production launch transaction. Final launch approval remains human-owned.';
comment on table public.siteforge_outbox_events is
  'Replayable exactly-once convergence ledger for SiteForge-triggered external side effects.';
comment on table public.siteforge_autonomy_modes is
  'Evidence-gated SiteForge autonomy rollout mode. Production launch is never an automatic action.';
