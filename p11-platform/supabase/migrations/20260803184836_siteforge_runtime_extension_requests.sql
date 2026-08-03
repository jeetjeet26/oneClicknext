create table public.siteforge_runtime_extension_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete cascade,
  requested_by uuid references auth.users(id) on delete set null,
  capability text not null check (length(capability) between 1 and 120),
  reason text not null check (length(reason) between 1 and 2000),
  requested_behavior text not null check (length(requested_behavior) between 1 and 4000),
  status text not null default 'proposed'
    check (
      status in (
        'proposed',
        'approved',
        'rejected',
        'building',
        'installed',
        'failed'
      )
    ),
  immutable_package_sha256 text
    check (
      immutable_package_sha256 is null
      or immutable_package_sha256 ~ '^[a-f0-9]{64}$'
    ),
  runtime_compatibility text,
  decision_by uuid references auth.users(id) on delete set null,
  decision_reason text,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index siteforge_runtime_extension_requests_website_idx
  on public.siteforge_runtime_extension_requests (website_id, created_at desc);

alter table public.siteforge_runtime_extension_requests enable row level security;

create policy "Users view org SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_runtime_extension_requests.org_id
  ));

create policy "Managers decide SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests for update
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_runtime_extension_requests.org_id
      and profiles.role in ('admin', 'manager')
  ))
  with check (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_runtime_extension_requests.org_id
      and profiles.role in ('admin', 'manager')
  ));

create policy "Service role manages SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select, update on public.siteforge_runtime_extension_requests
  to authenticated;
grant all on public.siteforge_runtime_extension_requests to service_role;
