-- Canonical existing-brand onboarding, asset governance, and SiteForge readiness.

alter table public.property_brand_assets
  add column if not exists contract_version text not null default '1.0',
  add column if not exists brand_origin text not null default 'generated',
  add column if not exists approval_status text not null default 'draft',
  add column if not exists contract_hash text,
  add column if not exists source_manifest jsonb not null default '[]'::jsonb,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.property_brand_assets
  drop constraint if exists property_brand_assets_brand_origin_check,
  drop constraint if exists property_brand_assets_approval_status_check;

alter table public.property_brand_assets
  add constraint property_brand_assets_brand_origin_check
    check (brand_origin in ('generated', 'imported', 'hybrid')),
  add constraint property_brand_assets_approval_status_check
    check (approval_status in ('draft', 'reviewing', 'approved', 'rejected'));

update public.property_brand_assets
set
  contract_version = coalesce(contract_version, '1.0'),
  brand_origin = coalesce(brand_origin, 'generated'),
  approval_status = case
    when generation_status = 'complete' then 'approved'
    when generation_status = 'reviewing' then 'reviewing'
    else coalesce(approval_status, 'draft')
  end,
  approved_at = case
    when generation_status = 'complete' then coalesce(approved_at, updated_at, created_at)
    else approved_at
  end;

create index if not exists property_brand_assets_contract_hash_idx
  on public.property_brand_assets (contract_hash)
  where contract_hash is not null;

create table if not exists public.property_brand_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'extracting', 'needs_review', 'confirmed', 'failed', 'cancelled')),
  source_type text not null
    check (source_type in ('package', 'website', 'manual', 'hybrid')),
  source_identity text not null,
  idempotency_key text not null,
  source_manifest jsonb not null default '[]'::jsonb,
  extracted_contract jsonb not null default '{}'::jsonb,
  conflicts jsonb not null default '[]'::jsonb,
  extraction_report jsonb not null default '{}'::jsonb,
  content_hash text,
  created_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (org_id, property_id, idempotency_key)
);

create index if not exists property_brand_imports_property_created_idx
  on public.property_brand_imports (property_id, created_at desc);

alter table public.content_assets
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists asset_role text,
  add column if not exists content_hash text,
  add column if not exists source_identity text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists rights_status text not null default 'unknown',
  add column if not exists rights_metadata jsonb not null default '{}'::jsonb,
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists focal_point jsonb,
  add column if not exists alt_text text,
  add column if not exists expires_at timestamptz;

update public.content_assets assets
set org_id = properties.org_id
from public.properties
where assets.property_id = properties.id
  and assets.org_id is null;

alter table public.content_assets
  drop constraint if exists content_assets_asset_role_check,
  drop constraint if exists content_assets_rights_status_check,
  drop constraint if exists content_assets_approval_status_check;

alter table public.content_assets
  add constraint content_assets_asset_role_check
    check (
      asset_role is null or asset_role in (
        'primary_logo', 'secondary_logo', 'monochrome_logo', 'brand_mark',
        'favicon', 'font', 'pattern', 'icon', 'brand_example',
        'hero', 'amenity', 'gallery', 'interior', 'exterior',
        'lifestyle', 'neighborhood', 'floorplan'
      )
    ),
  add constraint content_assets_rights_status_check
    check (rights_status in ('unknown', 'owned', 'licensed', 'generated', 'restricted')),
  add constraint content_assets_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected'));

create unique index if not exists content_assets_property_content_hash_idx
  on public.content_assets (property_id, content_hash)
  where property_id is not null and content_hash is not null;

create table if not exists public.property_legal_configs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded', 'rejected')),
  jurisdiction text,
  legal_entity_name text,
  privacy_policy jsonb not null default '{}'::jsonb,
  terms jsonb not null default '{}'::jsonb,
  accessibility jsonb not null default '{}'::jsonb,
  fair_housing jsonb not null default '{}'::jsonb,
  pricing_disclaimer jsonb not null default '{}'::jsonb,
  analytics_consent jsonb not null default '{}'::jsonb,
  communications_consent jsonb not null default '{}'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  effective_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (property_id, version)
);

create index if not exists property_legal_configs_property_status_idx
  on public.property_legal_configs (property_id, status, version desc);

create table if not exists public.property_points_of_interest (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  category text not null,
  address jsonb not null default '{}'::jsonb,
  latitude numeric(9,6),
  longitude numeric(9,6),
  distance_miles numeric(8,2),
  travel_time_minutes integer,
  source_url text,
  captured_at timestamptz,
  confidence numeric(5,4) not null default 0 check (confidence between 0 and 1),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists property_points_of_interest_property_category_idx
  on public.property_points_of_interest (property_id, category, approval_status);

create table if not exists public.property_onboarding_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'needs_review', 'ready', 'approved', 'stale', 'rejected')),
  schema_version integer not null default 1 check (schema_version > 0),
  domain_reports jsonb not null default '{}'::jsonb,
  source_references jsonb not null default '[]'::jsonb,
  unresolved_conflicts jsonb not null default '[]'::jsonb,
  snapshot_payload jsonb not null default '{}'::jsonb,
  content_hash text not null,
  brand_asset_id uuid references public.property_brand_assets(id) on delete restrict,
  brand_contract_version text,
  brand_contract_hash text,
  approval_action_attempt_id uuid references public.shared_action_attempts(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (property_id, content_hash)
);

create index if not exists property_onboarding_snapshots_property_created_idx
  on public.property_onboarding_snapshots (property_id, created_at desc);

alter table public.siteforge_plan_versions
  add column if not exists onboarding_snapshot_id uuid
    references public.property_onboarding_snapshots(id) on delete restrict,
  add column if not exists onboarding_snapshot_hash text,
  add column if not exists brand_asset_id uuid
    references public.property_brand_assets(id) on delete restrict,
  add column if not exists brand_contract_version text,
  add column if not exists brand_contract_hash text;

drop trigger if exists property_brand_imports_updated_at on public.property_brand_imports;
create trigger property_brand_imports_updated_at
  before update on public.property_brand_imports
  for each row execute function public.set_schema_truth_updated_at();

drop trigger if exists property_legal_configs_updated_at on public.property_legal_configs;
create trigger property_legal_configs_updated_at
  before update on public.property_legal_configs
  for each row execute function public.set_schema_truth_updated_at();

drop trigger if exists property_points_of_interest_updated_at on public.property_points_of_interest;
create trigger property_points_of_interest_updated_at
  before update on public.property_points_of_interest
  for each row execute function public.set_schema_truth_updated_at();

drop trigger if exists property_onboarding_snapshots_updated_at on public.property_onboarding_snapshots;
create trigger property_onboarding_snapshots_updated_at
  before update on public.property_onboarding_snapshots
  for each row execute function public.set_schema_truth_updated_at();

alter table public.property_brand_imports enable row level security;
alter table public.property_legal_configs enable row level security;
alter table public.property_points_of_interest enable row level security;
alter table public.property_onboarding_snapshots enable row level security;

create policy "Users view property brand imports in their org"
  on public.property_brand_imports for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = property_brand_imports.org_id
  ));

create policy "Users view property legal configs in their org"
  on public.property_legal_configs for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = property_legal_configs.org_id
  ));

create policy "Users view property POIs in their org"
  on public.property_points_of_interest for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = property_points_of_interest.org_id
  ));

create policy "Users view property onboarding snapshots in their org"
  on public.property_onboarding_snapshots for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = property_onboarding_snapshots.org_id
  ));

create policy "Service role manages property brand imports"
  on public.property_brand_imports for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role manages property legal configs"
  on public.property_legal_configs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role manages property POIs"
  on public.property_points_of_interest for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role manages property onboarding snapshots"
  on public.property_onboarding_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
