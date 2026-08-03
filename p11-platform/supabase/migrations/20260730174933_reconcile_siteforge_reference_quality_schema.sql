-- Reconcile SiteForge around durable plans, immutable artifacts, shared jobs,
-- tenant ownership, and a canonical blueprint projection.

-- ---------------------------------------------------------------------------
-- Property website projection
-- ---------------------------------------------------------------------------

update public.property_websites pw
set org_id = p.org_id
from public.properties p
where p.id = pw.property_id
  and pw.org_id is null;

do $$
begin
  if exists (
    select 1
    from public.property_websites
    where org_id is null
  ) then
    raise exception 'Cannot enforce property_websites.org_id: unresolved rows remain';
  end if;
end
$$;

alter table public.property_websites
  alter column org_id set not null,
  add column if not exists current_artifact_version_id uuid,
  add column if not exists wordpress_credential_ref text,
  add column if not exists site_blueprint jsonb;

update public.property_websites
set blueprint = coalesce(
  blueprint,
  site_blueprint,
  case
    when pages_generated is not null then jsonb_build_object(
      'version', coalesce(site_blueprint_version, 1),
      'propertyId', property_id,
      'updatedAt', coalesce(site_blueprint_updated_at, updated_at, now()),
      'pages', pages_generated
    )
    else null
  end
)
where blueprint is null;

alter table public.property_websites
  drop constraint if exists property_websites_generation_status_check;

alter table public.property_websites
  add constraint property_websites_generation_status_check
  check (
    generation_status in (
      'queued',
      'analyzing_brand',
      'planning_architecture',
      'creating_design',
      'planning_photos',
      'generating_content',
      'preparing_assets',
      'executing_photos',
      'validating_quality',
      'ready_for_preview',
      'deploying',
      'complete',
      'failed',
      'deploy_failed'
    )
  );

-- ---------------------------------------------------------------------------
-- Server-owned, revisioned plans
-- ---------------------------------------------------------------------------

create table if not exists public.siteforge_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'draft'
    check (status in (
      'draft',
      'ready_for_review',
      'confirmed',
      'consumed',
      'superseded',
      'denied'
    )),
  current_revision integer not null default 0 check (current_revision >= 0),
  confirmed_version_id uuid,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists siteforge_plans_property_updated_idx
  on public.siteforge_plans (property_id, updated_at desc);

create index if not exists siteforge_plans_org_status_idx
  on public.siteforge_plans (org_id, status, updated_at desc);

create table if not exists public.siteforge_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.siteforge_plans(id) on delete cascade,
  revision integer not null check (revision > 0),
  context_snapshot_id uuid references public.shared_context_snapshots(id) on delete set null,
  plan jsonb not null,
  preferences jsonb not null default '{}'::jsonb,
  readiness_report jsonb not null default '{}'::jsonb,
  content_hash text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (plan_id, revision),
  unique (plan_id, content_hash)
);

create index if not exists siteforge_plan_versions_plan_created_idx
  on public.siteforge_plan_versions (plan_id, revision desc);

alter table public.siteforge_plans
  drop constraint if exists siteforge_plans_confirmed_version_id_fkey;

alter table public.siteforge_plans
  add constraint siteforge_plans_confirmed_version_id_fkey
  foreign key (confirmed_version_id)
  references public.siteforge_plan_versions(id)
  on delete set null;

drop trigger if exists siteforge_plans_updated_at on public.siteforge_plans;
create trigger siteforge_plans_updated_at
  before update on public.siteforge_plans
  for each row execute function public.set_schema_truth_updated_at();

-- ---------------------------------------------------------------------------
-- Immutable artifact history (evolves the existing blueprint versions table)
-- ---------------------------------------------------------------------------

alter table public.siteforge_blueprint_versions
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists blueprint_schema_version integer default 1,
  add column if not exists content_hash text,
  add column if not exists parent_version_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists change_type text default 'generation',
  add column if not exists changes_summary text,
  add column if not exists edit_intent text,
  add column if not exists patches_applied jsonb,
  add column if not exists source_plan_version_id uuid references public.siteforge_plan_versions(id) on delete set null,
  add column if not exists shared_job_id uuid references public.shared_jobs(id) on delete set null,
  add column if not exists quality_score numeric(5,2),
  add column if not exists quality_report jsonb;

update public.siteforge_blueprint_versions bv
set
  org_id = pw.org_id,
  property_id = pw.property_id,
  content_hash = coalesce(bv.content_hash, md5(bv.blueprint::text)),
  blueprint_schema_version = coalesce(bv.blueprint_schema_version, 1),
  change_type = coalesce(bv.change_type, 'generation')
from public.property_websites pw
where pw.id = bv.website_id
  and (
    bv.org_id is null
    or bv.property_id is null
    or bv.content_hash is null
  );

insert into public.siteforge_blueprint_versions (
  website_id,
  org_id,
  property_id,
  version,
  blueprint,
  blueprint_schema_version,
  content_hash,
  change_type,
  changes_summary,
  quality_score,
  created_at
)
select
  pw.id,
  pw.org_id,
  pw.property_id,
  greatest(coalesce(pw.site_blueprint_version, 1), 1),
  pw.blueprint,
  1,
  md5(pw.blueprint::text),
  'generation',
  'Backfilled canonical artifact during SiteForge schema reconciliation',
  case
    when jsonb_typeof(pw.blueprint -> 'qualityReport') = 'object'
      and (pw.blueprint -> 'qualityReport' ->> 'score') ~ '^[0-9]+(\.[0-9]+)?$'
    then (pw.blueprint -> 'qualityReport' ->> 'score')::numeric
    else null
  end,
  coalesce(pw.site_blueprint_updated_at, pw.updated_at, pw.created_at, now())
from public.property_websites pw
where pw.blueprint is not null
  and not exists (
    select 1
    from public.siteforge_blueprint_versions existing
    where existing.website_id = pw.id
  );

update public.siteforge_blueprint_versions
set
  content_hash = coalesce(content_hash, md5(blueprint::text)),
  blueprint_schema_version = coalesce(blueprint_schema_version, 1),
  change_type = coalesce(change_type, 'generation')
where
  content_hash is null
  or blueprint_schema_version is null
  or change_type is null;

alter table public.siteforge_blueprint_versions
  alter column org_id set not null,
  alter column property_id set not null,
  alter column blueprint_schema_version set not null,
  alter column content_hash set not null,
  alter column change_type set not null,
  drop constraint if exists siteforge_blueprint_versions_change_type_check;

alter table public.siteforge_blueprint_versions
  add constraint siteforge_blueprint_versions_change_type_check
  check (change_type in ('generation', 'edit', 'rollback', 'import'));

create index if not exists siteforge_blueprint_versions_property_created_idx
  on public.siteforge_blueprint_versions (property_id, created_at desc);

create index if not exists siteforge_blueprint_versions_job_idx
  on public.siteforge_blueprint_versions (shared_job_id)
  where shared_job_id is not null;

update public.property_websites pw
set current_artifact_version_id = (
  select bv.id
  from public.siteforge_blueprint_versions bv
  where bv.website_id = pw.id
  order by bv.version desc, bv.created_at desc
  limit 1
)
where pw.current_artifact_version_id is null
  and exists (
    select 1
    from public.siteforge_blueprint_versions bv
    where bv.website_id = pw.id
  );

alter table public.property_websites
  drop constraint if exists property_websites_current_artifact_version_id_fkey;

alter table public.property_websites
  add constraint property_websites_current_artifact_version_id_fkey
  foreign key (current_artifact_version_id)
  references public.siteforge_blueprint_versions(id)
  on delete set null;

-- Legacy jobs remain readable while shared_jobs becomes authoritative.
alter table public.siteforge_jobs
  add column if not exists shared_job_id uuid references public.shared_jobs(id) on delete set null,
  add column if not exists migrated_at timestamptz;

create unique index if not exists siteforge_jobs_shared_job_idx
  on public.siteforge_jobs (shared_job_id)
  where shared_job_id is not null;

-- ---------------------------------------------------------------------------
-- Durable asset provenance
-- ---------------------------------------------------------------------------

alter table public.website_assets
  add column if not exists source_asset_id uuid,
  add column if not exists content_hash text,
  add column if not exists width integer,
  add column if not exists height integer,
  add column if not exists focal_point jsonb,
  add column if not exists rights_status text default 'unknown',
  add column if not exists approval_status text default 'pending',
  add column if not exists wp_media_url text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists generation_prompt text,
  add column if not exists quality_score numeric(3,1),
  add column if not exists brand_alignment_score numeric(3,1);

alter table public.website_assets
  drop constraint if exists website_assets_rights_status_check,
  drop constraint if exists website_assets_approval_status_check;

alter table public.website_assets
  add constraint website_assets_rights_status_check
    check (rights_status in ('unknown', 'owned', 'licensed', 'generated', 'restricted')),
  add constraint website_assets_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected'));

create unique index if not exists website_assets_website_content_hash_idx
  on public.website_assets (website_id, content_hash)
  where content_hash is not null;

-- ---------------------------------------------------------------------------
-- Tenant-safe read policies; writes stay behind authenticated service routes.
-- ---------------------------------------------------------------------------

alter table public.siteforge_plans enable row level security;
alter table public.siteforge_plan_versions enable row level security;

drop policy if exists "Users view their org SiteForge plans" on public.siteforge_plans;
create policy "Users view their org SiteForge plans"
  on public.siteforge_plans for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.org_id = siteforge_plans.org_id
    )
  );

drop policy if exists "Service role manages SiteForge plans" on public.siteforge_plans;
create policy "Service role manages SiteForge plans"
  on public.siteforge_plans for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Users view their org SiteForge plan versions" on public.siteforge_plan_versions;
create policy "Users view their org SiteForge plan versions"
  on public.siteforge_plan_versions for select
  using (
    exists (
      select 1
      from public.siteforge_plans plans
      join public.profiles on profiles.org_id = plans.org_id
      where plans.id = siteforge_plan_versions.plan_id
        and profiles.id = auth.uid()
    )
  );

drop policy if exists "Service role manages SiteForge plan versions" on public.siteforge_plan_versions;
create policy "Service role manages SiteForge plan versions"
  on public.siteforge_plan_versions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Service role full access blueprint versions" on public.siteforge_blueprint_versions;
create policy "Service role full access blueprint versions"
  on public.siteforge_blueprint_versions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.siteforge_plans to authenticated;
grant select on public.siteforge_plan_versions to authenticated;
grant select on public.siteforge_blueprint_versions to authenticated;

grant all on public.siteforge_plans to service_role;
grant all on public.siteforge_plan_versions to service_role;
grant all on public.siteforge_blueprint_versions to service_role;

comment on table public.siteforge_plans is
  'Server-owned SiteForge planning sessions. Approval applies only to an immutable plan version.';

comment on table public.siteforge_plan_versions is
  'Immutable structured SiteForge plan revisions with trusted context, readiness, and content hash.';

comment on table public.siteforge_blueprint_versions is
  'Immutable deployable SiteForge artifact history for generation, edits, imports, and rollback lineage.';

comment on column public.property_websites.current_artifact_version_id is
  'Current immutable SiteForge artifact projected by this operator-facing website record.';

comment on column public.property_websites.wordpress_credential_ref is
  'Reference to server-side WordPress credentials; never contains the credential value.';
