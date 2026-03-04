-- PropertyAudit: per-query run counts + AI Overviews visibility signals

-- Add per-query run count for repeated executions
alter table geo_queries
  add column if not exists run_count int default 1;

-- Create AI Overviews visibility tracking table
create table if not exists geo_ai_overviews (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  query_id uuid not null references geo_queries(id) on delete cascade,
  visible boolean not null default false,
  source_url text,
  observed_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_geo_ai_overviews_property on geo_ai_overviews(property_id);
create index if not exists idx_geo_ai_overviews_query on geo_ai_overviews(query_id);
create index if not exists idx_geo_ai_overviews_observed on geo_ai_overviews(property_id, observed_at desc);

-- RLS (align with geo_queries policies using org_id pattern)
alter table geo_ai_overviews enable row level security;

-- Drop existing policies first
drop policy if exists "Users can view geo_ai_overviews for their properties" on geo_ai_overviews;
drop policy if exists "Users can manage geo_ai_overviews for their properties" on geo_ai_overviews;
drop policy if exists "Service role has full access to geo_ai_overviews" on geo_ai_overviews;

create policy "Users can view geo_ai_overviews for their properties"
  on geo_ai_overviews for select
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Users can manage geo_ai_overviews for their properties"
  on geo_ai_overviews for all
  using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

create policy "Service role has full access to geo_ai_overviews"
  on geo_ai_overviews for all
  using (auth.role() = 'service_role');
