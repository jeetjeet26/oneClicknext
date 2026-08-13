-- SiteAudit checkpoints must retain the evidence required to produce a
-- deterministic SiteForge migration manifest after a worker restart.
alter table public.geo_crawl_pages
  add column if not exists content jsonb not null default '{}'::jsonb,
  add column if not exists forms jsonb not null default '[]'::jsonb,
  add column if not exists provenance jsonb not null default '{}'::jsonb;

comment on column public.geo_crawl_pages.content is
  'Read-only parsed page content retained for migration manifest generation.';
comment on column public.geo_crawl_pages.forms is
  'Read-only form structure; submitted values are never captured.';
comment on column public.geo_crawl_pages.provenance is
  'Source URL, capture mode, timestamp, and content hash for migration evidence.';
