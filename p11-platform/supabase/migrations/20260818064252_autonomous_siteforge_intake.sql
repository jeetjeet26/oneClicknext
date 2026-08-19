-- Canonical dual-mode intake for autonomous SiteForge.

create table if not exists public.siteforge_intake_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  brand_mode text not null check (brand_mode in ('generated', 'supplied')),
  lane text not null check (lane in ('multifamily_rental', 'for_sale_community')),
  phase text not null default 'subject_intake'
    check (
      phase in (
        'subject_intake',
        'source_ingestion',
        'normalization',
        'conflict_resolution',
        'brand',
        'readiness',
        'creative_commissioning',
        'planning',
        'building',
        'qa',
        'staging',
        'launch',
        'operations'
      )
    ),
  lifecycle_status text not null default 'queued'
    check (
      lifecycle_status in (
        'queued',
        'running',
        'succeeded',
        'failed',
        'retrying',
        'cancelled'
      )
    ),
  gate_status text not null default 'blocked'
    check (
      gate_status in (
        'blocked',
        'needs_input',
        'ready',
        'certified',
        'stale'
      )
    ),
  current_revision_id uuid,
  source_digest text,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (website_id)
);

create table if not exists public.siteforge_intake_revisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.siteforge_intake_sessions(id) on delete cascade,
  revision integer not null check (revision > 0),
  content_hash text not null check (char_length(content_hash) = 64),
  source_digest text not null check (char_length(source_digest) = 64),
  input_manifest jsonb not null,
  truth_snapshot jsonb not null,
  blocking_tasks jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  brand_asset_id uuid references public.property_brand_assets(id) on delete set null,
  brand_contract_hash text,
  competitive_positioning_hash text,
  site_story_hash text,
  created_by text not null default 'system',
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, revision),
  unique (session_id, content_hash)
);

alter table public.siteforge_intake_sessions
  add constraint siteforge_intake_sessions_current_revision_fkey
  foreign key (current_revision_id)
  references public.siteforge_intake_revisions(id)
  on delete set null;

create table if not exists public.siteforge_intake_sources (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.siteforge_intake_sessions(id) on delete cascade,
  source_type text not null,
  source_ref text,
  source_url text,
  content_hash text not null check (char_length(content_hash) = 64),
  authority text not null
    check (
      authority in (
        'operator',
        'approved_policy',
        'approved_brand',
        'structured_property',
        'approved_asset',
        'first_party_document',
        'existing_site',
        'marketvision',
        'ai_interpretation'
      )
    ),
  freshness_status text not null default 'current'
    check (freshness_status in ('current', 'stale', 'expired', 'unknown')),
  captured_at timestamptz,
  fresh_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, source_type, content_hash)
);

create table if not exists public.siteforge_intake_conflicts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.siteforge_intake_sessions(id) on delete cascade,
  revision_id uuid
    references public.siteforge_intake_revisions(id) on delete cascade,
  field_path text not null,
  severity text not null check (severity in ('blocking', 'material', 'advisory')),
  candidate_values jsonb not null,
  source_ids uuid[] not null default '{}',
  status text not null default 'open'
    check (status in ('open', 'system_resolved', 'needs_input', 'superseded')),
  resolution jsonb,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.siteforge_intake_checkpoint_bindings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.siteforge_intake_sessions(id) on delete cascade,
  revision_id uuid not null
    references public.siteforge_intake_revisions(id) on delete cascade,
  checkpoint_type text not null
    check (
      checkpoint_type in (
        'brand_contract',
        'competitive_positioning',
        'readiness_snapshot',
        'site_story',
        'creative_direction',
        'site_plan',
        'generation_job',
        'blueprint_artifact',
        'canonical_preview',
        'staging_release',
        'production_release'
      )
    ),
  checkpoint_id text not null,
  content_hash text not null check (char_length(content_hash) = 64),
  parent_hashes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (session_id, checkpoint_type, checkpoint_id)
);

alter table public.property_websites
  add column if not exists intake_session_id uuid
    references public.siteforge_intake_sessions(id) on delete set null;
alter table public.property_brand_assets
  add column if not exists intake_session_id uuid
    references public.siteforge_intake_sessions(id) on delete set null;
alter table public.property_onboarding_snapshots
  add column if not exists intake_session_id uuid
    references public.siteforge_intake_sessions(id) on delete set null;
alter table public.siteforge_plans
  add column if not exists intake_session_id uuid
    references public.siteforge_intake_sessions(id) on delete set null;

create index if not exists siteforge_intake_sessions_property_created_idx
  on public.siteforge_intake_sessions (property_id, created_at desc);
create index if not exists siteforge_intake_revisions_session_created_idx
  on public.siteforge_intake_revisions (session_id, created_at desc);
create index if not exists siteforge_intake_sources_session_created_idx
  on public.siteforge_intake_sources (session_id, created_at desc);
create index if not exists siteforge_intake_conflicts_open_idx
  on public.siteforge_intake_conflicts (session_id, severity, created_at desc)
  where status in ('open', 'needs_input');
create index if not exists siteforge_intake_bindings_revision_idx
  on public.siteforge_intake_checkpoint_bindings (revision_id, created_at desc);

alter table public.siteforge_intake_sessions enable row level security;
alter table public.siteforge_intake_revisions enable row level security;
alter table public.siteforge_intake_sources enable row level security;
alter table public.siteforge_intake_conflicts enable row level security;
alter table public.siteforge_intake_checkpoint_bindings enable row level security;

create policy "Service role manages siteforge_intake_sessions"
  on public.siteforge_intake_sessions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
create policy "Service role manages siteforge_intake_revisions"
  on public.siteforge_intake_revisions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
create policy "Service role manages siteforge_intake_sources"
  on public.siteforge_intake_sources for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
create policy "Service role manages siteforge_intake_conflicts"
  on public.siteforge_intake_conflicts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
create policy "Service role manages siteforge_intake_checkpoint_bindings"
  on public.siteforge_intake_checkpoint_bindings for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all privileges on
  public.siteforge_intake_sessions,
  public.siteforge_intake_revisions,
  public.siteforge_intake_sources,
  public.siteforge_intake_conflicts,
  public.siteforge_intake_checkpoint_bindings
from anon, authenticated;

grant all privileges on
  public.siteforge_intake_sessions,
  public.siteforge_intake_revisions,
  public.siteforge_intake_sources,
  public.siteforge_intake_conflicts,
  public.siteforge_intake_checkpoint_bindings
to service_role;
