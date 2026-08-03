create unique index if not exists siteforge_blueprint_versions_shared_job_unique
  on public.siteforge_blueprint_versions (shared_job_id)
  where shared_job_id is not null;

comment on index public.siteforge_blueprint_versions_shared_job_unique is
  'Makes one immutable SiteForge artifact the canonical output of each durable generation job.';
