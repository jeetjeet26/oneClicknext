-- Qualified against a schema-only copy of production plus the pending product work.
-- Retain existing values; no legacy row deletion or history stamping.
create unique index if not exists competitor_units_competitor_id_unit_type_key
 on public.competitor_units(competitor_id,unit_type);

alter table public.scrape_config drop constraint if exists scrape_config_scrape_frequency_check;
alter table public.scrape_config add constraint scrape_config_scrape_frequency_check
 check(scrape_frequency in('manual','hourly','daily','weekly'));
alter table public.import_jobs drop constraint if exists import_jobs_status_check;
alter table public.import_jobs add constraint import_jobs_status_check
 check(status in('pending','running','complete','failed','cancelled'));

-- RLS-authorized pending uploads can invalidate private readiness evidence without
-- granting browser roles SELECT access to private manifests or workspaces. This
-- trigger derives the property from the changed source row and returns no data.
alter function public.invalidate_readiness_from_source() security definer;
revoke all on function public.invalidate_readiness_from_source() from public,anon,authenticated;
grant execute on function public.invalidate_readiness_from_source() to service_role;
NOTIFY pgrst,'reload schema';
