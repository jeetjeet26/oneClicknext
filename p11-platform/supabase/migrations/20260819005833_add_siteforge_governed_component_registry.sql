create table public.siteforge_component_registry (
  id uuid primary key default gen_random_uuid(),
  component_key text not null unique
    check (component_key ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  display_name text not null check (length(display_name) between 1 and 200),
  lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'deprecated', 'retired')),
  current_version_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.siteforge_component_versions (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null
    references public.siteforge_component_registry(id) on delete restrict,
  semantic_version text not null
    check (
      semantic_version
      ~ '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$'
    ),
  schema_version integer not null check (schema_version = 1),
  compiler_version text not null
    check (
      compiler_version
      ~ '^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$'
    ),
  descriptor jsonb not null check (jsonb_typeof(descriptor) = 'object'),
  descriptor_sha256 text not null check (descriptor_sha256 ~ '^[a-f0-9]{64}$'),
  package_manifest jsonb not null
    check (
      jsonb_typeof(package_manifest) = 'object'
      and package_manifest ->> 'format' = 'siteforge-governed-component-package-v1'
    ),
  package_sha256 text not null check (package_sha256 ~ '^[a-f0-9]{64}$'),
  v2_catalog_entry jsonb not null
    check (
      jsonb_typeof(v2_catalog_entry) = 'object'
      and v2_catalog_entry ->> 'blockName' = 'acf/governed-component'
    ),
  v3_catalog_entry jsonb not null
    check (
      jsonb_typeof(v3_catalog_entry) = 'object'
      and v3_catalog_entry ->> 'blockName' = 'acf/governed-component'
    ),
  accessibility_contract jsonb not null
    check (
      jsonb_typeof(accessibility_contract) = 'object'
      and accessibility_contract ->> 'standard' = 'WCAG-2.2-AA'
    ),
  certification_scenarios jsonb not null
    check (
      jsonb_typeof(certification_scenarios) = 'array'
      and jsonb_array_length(certification_scenarios) >= 2
    ),
  published_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (component_id, semantic_version),
  unique (descriptor_sha256),
  unique (package_sha256)
);

alter table public.siteforge_component_registry
  add constraint siteforge_component_registry_current_version_fkey
  foreign key (current_version_id)
  references public.siteforge_component_versions(id)
  on delete restrict;

create index siteforge_component_versions_component_idx
  on public.siteforge_component_versions (component_id, published_at desc);

create or replace function public.protect_siteforge_component_version_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Published SiteForge governed component versions are immutable';
end;
$$;

create trigger protect_siteforge_component_version_identity
before update or delete on public.siteforge_component_versions
for each row execute function public.protect_siteforge_component_version_identity();

alter table public.siteforge_component_registry enable row level security;
alter table public.siteforge_component_versions enable row level security;

revoke all on public.siteforge_component_registry from anon, authenticated;
revoke all on public.siteforge_component_versions from anon, authenticated;
grant all on public.siteforge_component_registry to service_role;
grant all on public.siteforge_component_versions to service_role;

comment on table public.siteforge_component_registry is
  'Closed registry of governed reusable SiteForge components. No executable code is stored.';
comment on table public.siteforge_component_versions is
  'Immutable compiled component DSL versions projected into strict runtime v2 and v3 catalog entries.';
