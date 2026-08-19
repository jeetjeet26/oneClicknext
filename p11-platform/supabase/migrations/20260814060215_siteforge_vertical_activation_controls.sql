-- SiteForge Vertical Platform V2: database-owned, immutable activation
-- decisions for shadow/canary/on cutover and rollback.

create table if not exists public.siteforge_vertical_activation_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  website_id uuid not null,
  version integer not null check (version > 0),
  mode text not null check (mode in ('off', 'shadow', 'canary', 'on')),
  enabled boolean not null default false,
  vertical_profile_content_hash text
    check (
      vertical_profile_content_hash is null
      or vertical_profile_content_hash ~ '^[a-f0-9]{64}$'
    ),
  vertical_pack_content_hash text
    check (
      vertical_pack_content_hash is null
      or vertical_pack_content_hash ~ '^[a-f0-9]{64}$'
    ),
  registry_version integer check (registry_version is null or registry_version > 0),
  qualification_report_hash text
    check (
      qualification_report_hash is null
      or qualification_report_hash ~ '^[a-f0-9]{64}$'
    ),
  reason text not null check (nullif(btrim(reason), '') is not null),
  expires_at timestamptz,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default timezone('utc', now()),
  constraint siteforge_vertical_activation_website_tenant_fkey
    foreign key (website_id, org_id, property_id)
    references public.property_websites(id, org_id, property_id)
    on delete cascade,
  constraint siteforge_vertical_activation_approval_check
    check (
      (enabled = false and mode in ('off', 'shadow'))
      or (
        enabled = true
        and mode in ('canary', 'on')
        and vertical_profile_content_hash is not null
        and vertical_pack_content_hash is not null
        and registry_version is not null
        and qualification_report_hash is not null
        and approved_by is not null
        and approved_at is not null
      )
    ),
  unique (website_id, version),
  unique (website_id, content_hash)
);

create unique index if not exists siteforge_vertical_activation_tenant_identity_idx
  on public.siteforge_vertical_activation_versions
  (id, org_id, property_id, website_id);
create index if not exists siteforge_vertical_activation_current_idx
  on public.siteforge_vertical_activation_versions
  (org_id, property_id, website_id, version desc);
create index if not exists siteforge_vertical_activation_enabled_idx
  on public.siteforge_vertical_activation_versions
  (mode, website_id)
  where enabled = true;

drop trigger if exists siteforge_vertical_activation_versions_immutable
  on public.siteforge_vertical_activation_versions;
create trigger siteforge_vertical_activation_versions_immutable
  before update or delete on public.siteforge_vertical_activation_versions
  for each row execute function public.reject_vertical_immutable_mutation();

alter table public.siteforge_vertical_activation_versions enable row level security;

create policy "Managers view their org vertical activation"
  on public.siteforge_vertical_activation_versions for select to authenticated
  using (org_id in (
    select profiles.org_id from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role in ('admin', 'manager')
  ));
create policy "Service role creates vertical activation"
  on public.siteforge_vertical_activation_versions for insert to service_role
  with check (true);
create policy "Service role reads vertical activation"
  on public.siteforge_vertical_activation_versions for select to service_role
  using (true);

revoke all on table public.siteforge_vertical_activation_versions
  from anon, authenticated;
grant select on table public.siteforge_vertical_activation_versions
  to authenticated;
grant select, insert on table public.siteforge_vertical_activation_versions
  to service_role;
