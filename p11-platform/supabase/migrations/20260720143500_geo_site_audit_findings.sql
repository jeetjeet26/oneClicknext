-- GEO Site Audit Schema
-- Full-site technical crawl storage, occurrence-counted findings with a
-- discovered/fixed lifecycle, and persisted LLM-generated recommendations.

-- ============================================================================
-- ENUMS
-- ============================================================================

do $$ begin
  create type geo_crawl_status_enum as enum ('queued', 'running', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type geo_finding_status_enum as enum ('todo', 'in_progress', 'fixed', 'wont_fix');
exception when duplicate_object then null; end $$;

do $$ begin
  create type geo_finding_severity_enum as enum ('critical', 'high', 'medium', 'low', 'info');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- GEO SITE CRAWLS
-- One row per full-site technical crawl of a property website
-- ============================================================================

create table if not exists geo_site_crawls (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  batch_id uuid, -- optional link to the geo_runs batch that triggered this crawl
  status geo_crawl_status_enum not null default 'queued',
  seed_url text not null,
  page_cap int not null default 500,
  pages_discovered int not null default 0,
  pages_crawled int not null default 0,
  robots_summary jsonb default '{}', -- {reachable, rules: [...], blocked_url_count, blocked_resource_count}
  sitemap_summary jsonb default '{}', -- {reachable, url_count, not_crawled_count, orphan_count}
  llms_txt_summary jsonb default '{}', -- {reachable, content_preview}
  crawl_state jsonb default '{}', -- resumable checkpoint (frontier, visited counts)
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  last_updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_geo_site_crawls_property on geo_site_crawls(property_id, created_at desc);
create index if not exists idx_geo_site_crawls_status on geo_site_crawls(status);
create index if not exists idx_geo_site_crawls_batch on geo_site_crawls(batch_id);

-- ============================================================================
-- GEO CRAWL PAGES
-- Per-URL capture from a crawl
-- ============================================================================

create table if not exists geo_crawl_pages (
  id uuid primary key default gen_random_uuid(),
  crawl_id uuid not null references geo_site_crawls(id) on delete cascade,
  url text not null,
  final_url text, -- after redirects
  status_code int,
  redirect_chain jsonb default '[]', -- [{url, status}]
  content_type text,
  response_headers jsonb default '{}', -- security-relevant response headers
  title text,
  meta_description text,
  meta_robots text,
  canonical_url text,
  h1s jsonb default '[]',
  h2s jsonb default '[]',
  word_count int default 0,
  html_bytes int default 0,
  text_html_ratio numeric,
  images jsonb default '[]', -- [{src, alt, width, height, bytes, broken}]
  internal_links jsonb default '[]', -- [{url, anchor, rel, target}]
  external_links jsonb default '[]', -- [{url, anchor, rel, target}]
  structured_data jsonb default '{}', -- {types: [], parse_errors, faq, organization}
  mixed_content jsonb default '[]', -- http resource URLs on https page
  blocked_resources jsonb default '[]', -- resources disallowed by robots.txt
  page_type text default 'unknown',
  crawl_depth int default 0,
  inlink_count int default 0,
  in_sitemap boolean default false,
  blocked_by_robots boolean default false,
  fetch_error text,
  created_at timestamptz default now()
);

create unique index if not exists idx_geo_crawl_pages_crawl_url on geo_crawl_pages(crawl_id, url);
create index if not exists idx_geo_crawl_pages_crawl on geo_crawl_pages(crawl_id);
create index if not exists idx_geo_crawl_pages_status on geo_crawl_pages(crawl_id, status_code);

-- ============================================================================
-- GEO SITE FINDINGS
-- Occurrence-counted technical findings with discovered/fixed lifecycle.
-- Fingerprint is stable across crawls so findings persist and can be resolved.
-- ============================================================================

create table if not exists geo_site_findings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  source_crawl_id uuid references geo_site_crawls(id) on delete set null,
  fingerprint text not null, -- detector + normalized issue key
  category text not null, -- 'crawling_indexing' | 'canonicals' | 'titles' | ...
  detector text not null, -- machine name of the detector that produced it
  severity geo_finding_severity_enum not null default 'medium',
  title text not null,
  description text not null,
  occurrences int not null default 0,
  affected_urls jsonb default '[]', -- capped sample of URLs
  affected_url_count int not null default 0, -- true total
  evidence jsonb default '{}', -- detector-specific evidence payload
  status geo_finding_status_enum not null default 'todo',
  owner text, -- 'web_developer' | 'content' | 'seo' | 'partnerships'
  notes text,
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fixed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (property_id, fingerprint)
);

create index if not exists idx_geo_site_findings_property on geo_site_findings(property_id, status);
create index if not exists idx_geo_site_findings_category on geo_site_findings(property_id, category);
create index if not exists idx_geo_site_findings_crawl on geo_site_findings(source_crawl_id);

-- ============================================================================
-- GEO RECOMMENDATIONS
-- Persisted LLM-generated audit recommendations (per audit batch, versioned
-- by generation batch; prior generations are kept for history).
-- ============================================================================

create table if not exists geo_recommendations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  batch_id uuid, -- geo_runs batch this generation was grounded in
  crawl_id uuid references geo_site_crawls(id) on delete set null,
  generation_id uuid not null default gen_random_uuid(), -- groups one LLM generation pass
  is_current boolean not null default true,
  type text not null, -- 'technical_fix' | 'content_proposal' | 'strategic' | 'citation'
  priority text not null default 'medium', -- 'high' | 'medium' | 'low'
  owner text, -- 'web_developer' | 'content' | 'seo' | 'partnerships'
  title text not null,
  narrative text not null, -- LLM-written property-specific analysis
  proposed_changes jsonb default '[]', -- [{url, field, current, proposed, rationale}]
  grounding jsonb default '{}', -- {finding_ids: [], query_evidence: [], citations: []}
  status geo_finding_status_enum not null default 'todo',
  model_used text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_geo_recommendations_property on geo_recommendations(property_id, is_current);
create index if not exists idx_geo_recommendations_generation on geo_recommendations(generation_id);
create index if not exists idx_geo_recommendations_crawl on geo_recommendations(crawl_id);

-- ============================================================================
-- PER-PROPERTY CRAWL CONFIG
-- ============================================================================

alter table geo_property_config
  add column if not exists crawl_page_cap int default 500;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table geo_site_crawls enable row level security;
alter table geo_crawl_pages enable row level security;
alter table geo_site_findings enable row level security;
alter table geo_recommendations enable row level security;

-- geo_site_crawls
create policy "Users can view geo_site_crawls for their properties"
  on geo_site_crawls for select
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Service role has full access to geo_site_crawls"
  on geo_site_crawls for all
  using (auth.role() = 'service_role');

-- geo_crawl_pages
create policy "Users can view geo_crawl_pages for their properties"
  on geo_crawl_pages for select
  using (
    crawl_id in (
      select c.id from geo_site_crawls c
      join properties p on p.id = c.property_id
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Service role has full access to geo_crawl_pages"
  on geo_crawl_pages for all
  using (auth.role() = 'service_role');

-- geo_site_findings (users can update lifecycle fields via authenticated routes)
create policy "Users can view geo_site_findings for their properties"
  on geo_site_findings for select
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Users can update geo_site_findings for their properties"
  on geo_site_findings for update
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Service role has full access to geo_site_findings"
  on geo_site_findings for all
  using (auth.role() = 'service_role');

-- geo_recommendations
create policy "Users can view geo_recommendations for their properties"
  on geo_recommendations for select
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Users can update geo_recommendations for their properties"
  on geo_recommendations for update
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Service role has full access to geo_recommendations"
  on geo_recommendations for all
  using (auth.role() = 'service_role');
