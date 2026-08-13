-- SiteForge Web Director collaboration and operating-loop domain records.
-- Execution and approvals continue to use the shared substrate; these tables
-- preserve versioned product inputs, client review, migration, and connector
-- evidence without creating a second control plane.

create unique index if not exists property_websites_tenant_identity_idx
  on public.property_websites (id, org_id, property_id);

create table public.siteforge_brief_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'ready_for_review', 'approved', 'modified', 'denied', 'superseded')),
  brief jsonb not null default '{}'::jsonb check (jsonb_typeof(brief) = 'object'),
  unresolved_contradictions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(unresolved_contradictions) = 'array'),
  onboarding_snapshot_id uuid references public.property_onboarding_snapshots(id) on delete restrict,
  onboarding_snapshot_hash text
    check (onboarding_snapshot_hash is null or onboarding_snapshot_hash ~ '^[a-f0-9]{64}$'),
  brand_asset_id uuid references public.property_brand_assets(id) on delete restrict,
  brand_contract_hash text
    check (brand_contract_hash is null or brand_contract_hash ~ '^[a-f0-9]{64}$'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  approval_action_attempt_id uuid references public.shared_action_attempts(id) on delete restrict,
  confirmed_approval_id uuid references public.shared_approvals(id) on delete restrict,
  decision_reason text,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (website_id, version),
  unique (website_id, content_hash),
  constraint siteforge_brief_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade
);

create unique index siteforge_brief_one_active_idx
  on public.siteforge_brief_versions (website_id)
  where status in ('draft', 'ready_for_review', 'approved', 'modified');
create index siteforge_brief_property_idx
  on public.siteforge_brief_versions (org_id, property_id, created_at desc);

create table public.siteforge_creative_direction_sets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  brief_version_id uuid not null references public.siteforge_brief_versions(id) on delete restrict,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'ready_for_review', 'approved', 'modified', 'denied', 'superseded')),
  selection_notes text,
  selected_direction_id uuid,
  approval_action_attempt_id uuid references public.shared_action_attempts(id) on delete restrict,
  confirmed_approval_id uuid references public.shared_approvals(id) on delete restrict,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (website_id, version),
  unique (website_id, content_hash),
  constraint siteforge_direction_set_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade
);

create table public.siteforge_creative_directions (
  id uuid primary key default gen_random_uuid(),
  direction_set_id uuid not null references public.siteforge_creative_direction_sets(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  ordinal integer not null check (ordinal between 1 and 5),
  name text not null check (nullif(btrim(name), '') is not null),
  direction jsonb not null default '{}'::jsonb check (jsonb_typeof(direction) = 'object'),
  preview_manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(preview_manifest) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (direction_set_id, ordinal),
  unique (direction_set_id, content_hash),
  constraint siteforge_direction_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade
);

alter table public.siteforge_creative_direction_sets
  add constraint siteforge_direction_set_selected_direction_fkey
  foreign key (selected_direction_id)
  references public.siteforge_creative_directions(id)
  on delete restrict;

create index siteforge_direction_sets_website_idx
  on public.siteforge_creative_direction_sets (website_id, created_at desc);
create index siteforge_directions_set_idx
  on public.siteforge_creative_directions (direction_set_id, ordinal);

alter table public.content_assets
  add column if not exists curation_status text not null default 'needs_review'
    check (curation_status in (
      'raw', 'needs_review', 'approved', 'selected', 'rejected', 'generated', 'in_use'
    )),
  add column if not exists rejection_reason text,
  add column if not exists duplicate_of uuid references public.content_assets(id) on delete set null,
  add column if not exists hero_rank integer check (hero_rank is null or hero_rank > 0),
  add column if not exists quality_score numeric
    check (quality_score is null or (quality_score >= 0 and quality_score <= 1)),
  add column if not exists crop_suggestion jsonb,
  add column if not exists usage_manifest jsonb not null default '[]'::jsonb
    check (jsonb_typeof(usage_manifest) = 'array'),
  add column if not exists analyzed_at timestamptz;

create index if not exists content_assets_curation_idx
  on public.content_assets (org_id, property_id, curation_status, created_at desc);
create unique index if not exists content_assets_property_hash_idx
  on public.content_assets (property_id, content_hash)
  where content_hash is not null and duplicate_of is null;

create table public.siteforge_asset_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete cascade,
  provider text not null check (provider in ('upload', 'google_drive', 'dropbox')),
  status text not null default 'active'
    check (status in ('active', 'paused', 'revoked', 'error')),
  external_folder_id text,
  external_folder_name text,
  credential_ref text,
  scope_manifest jsonb not null default '{}'::jsonb check (jsonb_typeof(scope_manifest) = 'object'),
  checkpoint jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoint) = 'object'),
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (property_id, provider, external_folder_id)
);

create table public.siteforge_asset_ingest_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.siteforge_asset_sources(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete cascade,
  shared_job_id uuid references public.shared_jobs(id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  source_checkpoint jsonb not null default '{}'::jsonb,
  result_manifest jsonb not null default '{}'::jsonb,
  discovered_count integer not null default 0 check (discovered_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index siteforge_asset_ingest_source_idx
  on public.siteforge_asset_ingest_runs (source_id, created_at desc);

create table public.siteforge_review_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'open'
    check (status in ('open', 'changes_requested', 'approved', 'expired', 'superseded', 'closed')),
  title text not null,
  instructions text,
  client_safe_summary jsonb not null default '{}'::jsonb,
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default timezone('utc', now()),
  closes_at timestamptz,
  closed_at timestamptz,
  constraint siteforge_review_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade
);

create table public.siteforge_revision_rounds (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.siteforge_review_sessions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  status text not null default 'collecting'
    check (status in ('collecting', 'ready_for_work', 'in_progress', 'ready_for_verification', 'verified', 'closed')),
  requested_by_name text,
  requested_by_email text,
  assigned_to uuid references public.profiles(id) on delete set null,
  due_at timestamptz,
  resulting_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete restrict,
  resulting_content_hash text
    check (resulting_content_hash is null or resulting_content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (review_session_id, round_number)
);

create table public.siteforge_review_comments (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.siteforge_review_sessions(id) on delete cascade,
  revision_round_id uuid references public.siteforge_revision_rounds(id) on delete set null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  parent_comment_id uuid references public.siteforge_review_comments(id) on delete cascade,
  author_type text not null check (author_type in ('client', 'operator', 'system')),
  author_profile_id uuid references public.profiles(id) on delete set null,
  author_name text,
  author_email text,
  page_path text not null,
  section_id text,
  viewport text check (viewport is null or viewport in ('desktop', 'tablet', 'mobile')),
  anchor jsonb not null default '{}'::jsonb,
  body text not null check (nullif(btrim(body), '') is not null),
  category text not null default 'general'
    check (category in ('general', 'brand', 'copy', 'layout', 'image', 'conversion', 'legal', 'accessibility', 'seo', 'bug')),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'clarification_needed', 'rejected', 'resolved', 'verified')),
  disposition_reason text,
  semantic_operations jsonb not null default '[]'::jsonb,
  resulting_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.siteforge_review_tokens (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.siteforge_review_sessions(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  reviewer_name text,
  reviewer_email text,
  permissions jsonb not null default '["view","comment","decide"]'::jsonb
    check (jsonb_typeof(permissions) = 'array'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.siteforge_client_decisions (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.siteforge_review_sessions(id) on delete cascade,
  review_token_id uuid references public.siteforge_review_tokens(id) on delete set null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approved', 'approved_with_notes', 'changes_requested')),
  rationale text not null check (nullif(btrim(rationale), '') is not null),
  reviewer_name text,
  reviewer_email text,
  created_at timestamptz not null default timezone('utc', now())
);

create index siteforge_review_sessions_website_idx
  on public.siteforge_review_sessions (website_id, opened_at desc);
create index siteforge_review_comments_session_idx
  on public.siteforge_review_comments (review_session_id, created_at);
create index siteforge_review_tokens_active_idx
  on public.siteforge_review_tokens (token_hash, expires_at)
  where revoked_at is null;

create table public.siteforge_migration_manifests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'crawling', 'ready_for_review', 'approved', 'imported', 'verified', 'failed', 'superseded')),
  source_url text not null,
  source_read_only boolean not null default true check (source_read_only),
  source_inventory jsonb not null default '{}'::jsonb,
  content_manifest jsonb not null default '{}'::jsonb,
  asset_manifest jsonb not null default '[]'::jsonb,
  form_manifest jsonb not null default '[]'::jsonb,
  redirect_map jsonb not null default '[]'::jsonb,
  unmigrated_items jsonb not null default '[]'::jsonb,
  dns_snapshot jsonb not null default '{}'::jsonb,
  parity_report jsonb not null default '{}'::jsonb,
  post_launch_crawl jsonb not null default '{}'::jsonb,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  shared_job_id uuid references public.shared_jobs(id) on delete set null,
  approval_action_attempt_id uuid references public.shared_action_attempts(id) on delete restrict,
  confirmed_approval_id uuid references public.shared_approvals(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (website_id, version),
  unique (website_id, content_hash),
  constraint siteforge_migration_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade
);

create table public.siteforge_connector_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid references public.property_websites(id) on delete cascade,
  provider text not null,
  capability text not null check (capability in ('conversion', 'inventory', 'analytics', 'tag_manager', 'maps', 'accessibility')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'degraded', 'paused', 'revoked', 'error')),
  credential_ref text,
  mapping jsonb not null default '{}'::jsonb,
  health jsonb not null default '{}'::jsonb,
  freshness_seconds integer check (freshness_seconds is null or freshness_seconds > 0),
  source_watermark timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (property_id, provider, capability)
);

create table public.siteforge_dns_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  release_id uuid references public.siteforge_launch_releases(id) on delete set null,
  provider text not null,
  domain text not null,
  record_manifest jsonb not null default '[]'::jsonb,
  ownership_evidence jsonb not null default '{}'::jsonb,
  rollback_manifest jsonb not null default '[]'::jsonb,
  propagation_report jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default timezone('utc', now()),
  restored_at timestamptz,
  unique (website_id, release_id, captured_at)
);

create table public.siteforge_report_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  recipient_email text not null,
  cadence text not null check (cadence in ('weekly', 'monthly', 'quarterly')),
  status text not null default 'active' check (status in ('active', 'paused', 'revoked')),
  report_config jsonb not null default '{}'::jsonb,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'siteforge_brief_versions',
    'siteforge_creative_direction_sets',
    'siteforge_creative_directions',
    'siteforge_asset_sources',
    'siteforge_asset_ingest_runs',
    'siteforge_review_sessions',
    'siteforge_revision_rounds',
    'siteforge_review_comments',
    'siteforge_review_tokens',
    'siteforge_client_decisions',
    'siteforge_migration_manifests',
    'siteforge_connector_configs',
    'siteforge_dns_snapshots',
    'siteforge_report_subscriptions'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select using (
        exists (
          select 1 from public.profiles
          where profiles.id = auth.uid()
            and profiles.org_id = %I.org_id
        )
      )',
      table_name || '_tenant_select',
      table_name,
      table_name
    );
  end loop;
end
$$;

create policy siteforge_asset_sources_tenant_write
  on public.siteforge_asset_sources
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_asset_sources.org_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_asset_sources.org_id
    )
  );

create policy siteforge_report_subscriptions_tenant_write
  on public.siteforge_report_subscriptions
  for all
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_report_subscriptions.org_id
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_report_subscriptions.org_id
    )
  );

create trigger siteforge_asset_sources_set_updated_at
  before update on public.siteforge_asset_sources
  for each row execute function public.update_updated_at_column();
create trigger siteforge_revision_rounds_set_updated_at
  before update on public.siteforge_revision_rounds
  for each row execute function public.update_updated_at_column();
create trigger siteforge_review_comments_set_updated_at
  before update on public.siteforge_review_comments
  for each row execute function public.update_updated_at_column();
create trigger siteforge_migration_manifests_set_updated_at
  before update on public.siteforge_migration_manifests
  for each row execute function public.update_updated_at_column();
create trigger siteforge_connector_configs_set_updated_at
  before update on public.siteforge_connector_configs
  for each row execute function public.update_updated_at_column();
create trigger siteforge_report_subscriptions_set_updated_at
  before update on public.siteforge_report_subscriptions
  for each row execute function public.update_updated_at_column();

comment on table public.siteforge_brief_versions is
  'Immutable, approval-bound client brief versions for SiteForge.';
comment on table public.siteforge_review_tokens is
  'Hashed, expiring client review credentials. Raw tokens are never persisted.';
comment on table public.siteforge_migration_manifests is
  'Immutable source-site crawl, redirect, parity, and cutover evidence.';
