drop policy if exists "Users view their org-independent SiteForge runtime packages"
  on public.siteforge_runtime_packages;
drop policy if exists "Service role manages SiteForge runtime packages"
  on public.siteforge_runtime_packages;

drop policy if exists "Users view org SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests;
create policy "Users view org SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests
  for select
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.org_id = siteforge_runtime_extension_requests.org_id
  ));

drop policy if exists "Managers decide SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests;
create policy "Managers decide SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests
  for update
  to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.org_id = siteforge_runtime_extension_requests.org_id
      and profiles.role in ('admin', 'manager')
  ))
  with check (exists (
    select 1 from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.org_id = siteforge_runtime_extension_requests.org_id
      and profiles.role in ('admin', 'manager')
  ));

drop policy if exists "Service role manages SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests;

create index if not exists siteforge_runtime_packages_created_by_idx
  on public.siteforge_runtime_packages (created_by)
  where created_by is not null;
create index if not exists siteforge_runtime_extension_artifact_idx
  on public.siteforge_runtime_extension_requests (artifact_id);
create index if not exists siteforge_runtime_extension_decision_by_idx
  on public.siteforge_runtime_extension_requests (decision_by)
  where decision_by is not null;
create index if not exists siteforge_runtime_extension_org_idx
  on public.siteforge_runtime_extension_requests (org_id);
create index if not exists siteforge_runtime_extension_property_idx
  on public.siteforge_runtime_extension_requests (property_id);
create index if not exists siteforge_runtime_extension_requested_by_idx
  on public.siteforge_runtime_extension_requests (requested_by)
  where requested_by is not null;
