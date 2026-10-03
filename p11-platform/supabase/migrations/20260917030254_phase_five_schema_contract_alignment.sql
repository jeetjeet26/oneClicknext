-- Match the verified oneClick hosted contract (metadata checked read-only September 16, 2026).
-- Retain textual bedroom preferences such as "studio" or "3+" without truncating intent.
do $$
begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='leads' and column_name='bedrooms' and data_type<>'text') then
  alter table public.leads alter column bedrooms type text using bedrooms::text;
 end if;
end;$$;
-- Legacy artifacts must have real verified hashes before this constraint can be installed.
-- Never substitute an invented or placeholder content hash.
alter table public.siteforge_blueprint_versions alter column content_hash set not null;
alter table public.siteforge_blueprint_versions alter column created_at set not null;
-- These service policies must not be evaluated for browser roles.
alter policy "Service role manages shared_execution_budgets" on public.shared_execution_budgets to service_role using(true) with check(true);
alter policy "Service role manages shared_execution_budget_events" on public.shared_execution_budget_events to service_role using(true) with check(true);
alter policy "Service role manages SiteForge edit attachments" on public.siteforge_edit_attachments to service_role using(true) with check(true);
alter policy "Users view their org SiteForge edit attachments" on public.siteforge_edit_attachments to authenticated using(exists(select 1 from public.profiles where profiles.id=(select auth.uid()) and profiles.org_id=siteforge_edit_attachments.org_id));

revoke insert,update,delete,truncate,references,trigger on public.siteforge_edit_attachments from authenticated;
revoke all on public.siteforge_edit_attachments from anon;
grant select on public.siteforge_edit_attachments to authenticated;

notify pgrst,'reload schema';
