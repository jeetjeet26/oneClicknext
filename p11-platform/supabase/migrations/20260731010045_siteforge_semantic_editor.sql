-- SiteForge semantic editor: durable chat turns, immutable release inputs,
-- exact WordPress targets, and staging-only deployment lifecycle.

create table if not exists public.siteforge_theme_overlays (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null default '{}'::jsonb,
  storage_path text not null,
  package_sha256 text not null check (package_sha256 ~ '^[a-f0-9]{64}$'),
  signature text not null,
  validation_report jsonb not null default '{}'::jsonb,
  screenshot_manifest jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (website_id, content_hash),
  unique (storage_path)
);

create table if not exists public.siteforge_wordpress_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  target_type text not null check (target_type in ('canonical_preview', 'staging')),
  provider text not null,
  provider_application_id text,
  provider_parent_application_id text,
  provider_server_id text,
  site_url text,
  admin_url text,
  dashboard_url text,
  credential_ref text,
  protection_mode text not null default 'noindex'
    check (protection_mode in ('noindex', 'password_noindex')),
  status text not null default 'pending'
    check (status in ('pending', 'provisioning', 'ready', 'failed', 'disabled')),
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists siteforge_wordpress_targets_active_type_idx
  on public.siteforge_wordpress_targets (website_id, target_type)
  where is_active;

create table if not exists public.siteforge_edit_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'archived')),
  active_artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  last_activity_at timestamptz not null default timezone('utc', now()),
  archived_at timestamptz
);

create unique index if not exists siteforge_edit_sessions_one_active_idx
  on public.siteforge_edit_sessions (website_id, created_by)
  where status = 'active';

create table if not exists public.siteforge_edit_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.siteforge_edit_sessions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  status text not null default 'complete'
    check (status in ('queued', 'running', 'complete', 'failed', 'cancelled')),
  content text not null default '',
  client_request_id text,
  parent_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete restrict,
  parent_content_hash text,
  shared_job_id uuid references public.shared_jobs(id) on delete set null,
  resulting_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete restrict,
  tool_summary jsonb not null default '[]'::jsonb,
  progress jsonb not null default '[]'::jsonb,
  failure_code text,
  failure_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  unique (session_id, client_request_id)
);

create index if not exists siteforge_edit_messages_session_created_idx
  on public.siteforge_edit_messages (session_id, created_at, id);
create unique index if not exists siteforge_edit_messages_shared_job_idx
  on public.siteforge_edit_messages (shared_job_id)
  where shared_job_id is not null;

create table if not exists public.siteforge_artifact_deployments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  target_id uuid not null references public.siteforge_wordpress_targets(id) on delete restrict,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  asset_manifest_hash text not null check (asset_manifest_hash ~ '^[a-f0-9]{64}$'),
  base_theme_package_sha256 text not null check (base_theme_package_sha256 ~ '^[a-f0-9]{64}$'),
  overlay_package_sha256 text,
  approval_id uuid references public.shared_approvals(id) on delete restrict,
  shared_job_id uuid references public.shared_jobs(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'deploying', 'certifying', 'ready', 'failed', 'superseded')),
  remote_manifest_hash text,
  certification_report jsonb not null default '{}'::jsonb,
  deployed_url text,
  admin_url text,
  deployed_at timestamptz,
  certified_at timestamptz,
  externally_promoted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (target_id, artifact_id)
);

create unique index if not exists siteforge_artifact_deployments_job_idx
  on public.siteforge_artifact_deployments (shared_job_id)
  where shared_job_id is not null;

alter table public.siteforge_blueprint_versions
  add column if not exists asset_manifest jsonb not null default '[]'::jsonb,
  add column if not exists asset_manifest_hash text,
  add column if not exists base_theme_package_id text,
  add column if not exists base_theme_package_sha256 text,
  add column if not exists theme_overlay_id uuid references public.siteforge_theme_overlays(id) on delete restrict,
  add column if not exists overlay_package_sha256 text,
  add column if not exists site_configuration jsonb not null default '{}'::jsonb,
  add column if not exists motion_configuration jsonb not null default '{}'::jsonb;

alter table public.website_assets
  add column if not exists byte_sha256 text,
  add column if not exists storage_path text;

alter table public.property_websites
  add column if not exists editor_lifecycle_status text not null default 'editing',
  add column if not exists canonical_preview_target_id uuid references public.siteforge_wordpress_targets(id) on delete set null,
  add column if not exists staging_target_id uuid references public.siteforge_wordpress_targets(id) on delete set null,
  add column if not exists staging_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists staging_content_hash text,
  add column if not exists staging_url text,
  add column if not exists staging_admin_url text,
  add column if not exists staging_certified_at timestamptz,
  add column if not exists externally_promoted_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists externally_promoted_at timestamptz;

alter table public.property_websites
  drop constraint if exists property_websites_editor_lifecycle_status_check;
alter table public.property_websites
  add constraint property_websites_editor_lifecycle_status_check
  check (editor_lifecycle_status in (
    'editing',
    'preview_ready',
    'approved_for_staging',
    'deploying_staging',
    'staging_ready'
  ));

alter table public.siteforge_blueprint_versions
  drop constraint if exists siteforge_blueprint_versions_change_type_check;
alter table public.siteforge_blueprint_versions
  add constraint siteforge_blueprint_versions_change_type_check
  check (change_type in ('generation', 'edit', 'rollback', 'import'));

-- shared_jobs is authoritative. Legacy rows remain readable, but no semantic
-- editor or staging workflow is required to dual-write siteforge_jobs.
comment on table public.siteforge_jobs is
  'Legacy compatibility projection. New SiteForge work is authoritative in shared_jobs.';

create index if not exists siteforge_theme_overlays_tenant_idx
  on public.siteforge_theme_overlays (org_id, property_id, website_id, created_at desc);
create index if not exists siteforge_wordpress_targets_tenant_idx
  on public.siteforge_wordpress_targets (org_id, property_id, website_id, target_type);
create index if not exists siteforge_edit_sessions_tenant_idx
  on public.siteforge_edit_sessions (org_id, property_id, website_id, last_activity_at desc);
create index if not exists siteforge_artifact_deployments_tenant_idx
  on public.siteforge_artifact_deployments (org_id, property_id, website_id, created_at desc);

alter table public.siteforge_theme_overlays enable row level security;
alter table public.siteforge_wordpress_targets enable row level security;
alter table public.siteforge_edit_sessions enable row level security;
alter table public.siteforge_edit_messages enable row level security;
alter table public.siteforge_artifact_deployments enable row level security;

create policy "Users view their org SiteForge overlays"
  on public.siteforge_theme_overlays for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_theme_overlays.org_id
  ));
create policy "Service role manages SiteForge overlays"
  on public.siteforge_theme_overlays for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view their org SiteForge WordPress targets"
  on public.siteforge_wordpress_targets for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_wordpress_targets.org_id
  ));
create policy "Service role manages SiteForge WordPress targets"
  on public.siteforge_wordpress_targets for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view their org SiteForge edit sessions"
  on public.siteforge_edit_sessions for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_edit_sessions.org_id
  ));
create policy "Service role manages SiteForge edit sessions"
  on public.siteforge_edit_sessions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view their org SiteForge edit messages"
  on public.siteforge_edit_messages for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_edit_messages.org_id
  ));
create policy "Service role manages SiteForge edit messages"
  on public.siteforge_edit_messages for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view their org SiteForge artifact deployments"
  on public.siteforge_artifact_deployments for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_artifact_deployments.org_id
  ));
create policy "Service role manages SiteForge artifact deployments"
  on public.siteforge_artifact_deployments for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.siteforge_theme_overlays to authenticated;
grant select on public.siteforge_wordpress_targets to authenticated;
grant select on public.siteforge_edit_sessions to authenticated;
grant select on public.siteforge_edit_messages to authenticated;
grant select on public.siteforge_artifact_deployments to authenticated;
grant all on public.siteforge_theme_overlays to service_role;
grant all on public.siteforge_wordpress_targets to service_role;
grant all on public.siteforge_edit_sessions to service_role;
grant all on public.siteforge_edit_messages to service_role;
grant all on public.siteforge_artifact_deployments to service_role;

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
  select * into v_website
  from public.property_websites
  where id = p_website_id
  for update;

  if not found then
    raise exception 'SiteForge website not found';
  end if;
  if v_website.current_artifact_version_id is distinct from p_expected_artifact_id then
    raise exception 'SiteForge artifact version conflict';
  end if;
  if p_change_type not in ('generation', 'edit', 'rollback', 'import') then
    raise exception 'Unsupported SiteForge artifact change type';
  end if;
  if p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid SiteForge artifact content hash';
  end if;

  select * into v_parent
  from public.siteforge_blueprint_versions
  where id = p_expected_artifact_id
    and website_id = p_website_id;
  if not found then
    raise exception 'Parent SiteForge artifact not found';
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
    p_patches_applied, v_parent.source_plan_version_id, p_quality_report,
    p_quality_score, p_created_by, v_parent.asset_manifest,
    v_parent.asset_manifest_hash, v_parent.base_theme_package_id,
    v_parent.base_theme_package_sha256, v_parent.theme_overlay_id,
    v_parent.overlay_package_sha256, v_parent.site_configuration,
    v_parent.motion_configuration
  )
  returning * into v_created;

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

  return v_created;
end;
$$;

comment on function public.publish_siteforge_artifact_revision is
  'Atomically publishes an immutable semantic edit/rollback artifact with optimistic concurrency and invalidates stale preview/staging freshness.';
