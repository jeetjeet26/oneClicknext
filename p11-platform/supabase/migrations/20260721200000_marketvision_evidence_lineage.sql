-- =============================================
-- MARKETVISION 360: SCHEMA TRUTH RECONCILIATION + EVIDENCE LINEAGE
--
-- Part 1 reconciles drift between the base MarketVision migration
-- (20251209045000) and the live schema so a fresh replay and the live
-- database converge on the same shape:
--   - scrape_config: live has sources/proxy_enabled/next_run_at but lacks
--     radius_miles/max_competitors/auto_add (and vice versa on replay).
--   - market_insights: live has generated_at but lacks created_at/updated_at.
--   - competitors.amenities/photos: text[] on replay vs jsonb live.
--   - ownership columns are nullable live but NOT NULL in the base migration.
--
-- Part 2 introduces normalized evidence lineage:
--   - market_source_captures: one row per source fetch (URL, hash, time).
--   - market_observations: versioned, typed facts extracted from a capture.
--   - capture_id links from existing fact tables so prices, availability,
--     specials, amenities, and brand claims can cite their evidence.
-- =============================================

-- ---------------------------------------------------------------------------
-- Part 1a: scrape_config convergence
-- ---------------------------------------------------------------------------
alter table public.scrape_config add column if not exists radius_miles numeric(6,2) default 3.0;
alter table public.scrape_config add column if not exists max_competitors int default 20;
alter table public.scrape_config add column if not exists auto_add boolean default true;
alter table public.scrape_config add column if not exists sources jsonb default '["apartments_com", "zillow"]'::jsonb;
alter table public.scrape_config add column if not exists proxy_enabled boolean default false;
alter table public.scrape_config add column if not exists next_run_at timestamptz;

-- ---------------------------------------------------------------------------
-- Part 1b: market_insights convergence
-- ---------------------------------------------------------------------------
alter table public.market_insights add column if not exists generated_at timestamptz default now();
alter table public.market_insights add column if not exists created_at timestamptz default now();
alter table public.market_insights add column if not exists updated_at timestamptz default now();

create or replace function public.update_marketvision_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_market_insights_updated_at on public.market_insights;
create trigger trigger_market_insights_updated_at
  before update on public.market_insights
  for each row
  execute function public.update_marketvision_updated_at();

-- ---------------------------------------------------------------------------
-- Part 1c: competitors.amenities / photos -> jsonb (live truth)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'competitors'
      and column_name = 'amenities' and data_type = 'ARRAY'
  ) then
    alter table public.competitors alter column amenities drop default;
    alter table public.competitors
      alter column amenities type jsonb using coalesce(to_jsonb(amenities), '[]'::jsonb);
  end if;
  alter table public.competitors alter column amenities set default '[]'::jsonb;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'competitors'
      and column_name = 'photos' and data_type = 'ARRAY'
  ) then
    alter table public.competitors alter column photos drop default;
    alter table public.competitors
      alter column photos type jsonb using coalesce(to_jsonb(photos), '[]'::jsonb);
  end if;
  alter table public.competitors alter column photos set default '[]'::jsonb;
end
$$;

-- ---------------------------------------------------------------------------
-- Part 1d: ownership columns must be NOT NULL (base migration already
-- declares these; live drifted to nullable). All live rows are non-null.
-- ---------------------------------------------------------------------------
alter table public.competitors alter column property_id set not null;
alter table public.competitor_units alter column competitor_id set not null;
alter table public.competitor_price_history alter column competitor_unit_id set not null;
alter table public.market_alerts alter column property_id set not null;
alter table public.market_insights alter column property_id set not null;
alter table public.scrape_config alter column property_id set not null;
alter table public.competitor_brand_intelligence alter column competitor_id set not null;
alter table public.competitor_content_chunks alter column competitor_id set not null;
alter table public.competitor_scrape_jobs alter column property_id set not null;

-- ---------------------------------------------------------------------------
-- Part 2a: source captures (one row per fetch of an external source)
-- ---------------------------------------------------------------------------
create table if not exists public.market_source_captures (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete cascade,
  source_type text not null check (
    source_type in ('website', 'apartments_com', 'google_places', 'manual', 'other')
  ),
  source_url text,
  content_hash text,
  raw_ref text,
  status text not null default 'captured' check (status in ('captured', 'failed')),
  error_message text,
  captured_at timestamptz not null default now(),
  effective_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_market_source_captures_property
  on public.market_source_captures(property_id, captured_at desc);
create index if not exists idx_market_source_captures_competitor
  on public.market_source_captures(competitor_id, captured_at desc);
create index if not exists idx_market_source_captures_hash
  on public.market_source_captures(content_hash) where content_hash is not null;

-- ---------------------------------------------------------------------------
-- Part 2b: versioned observations (typed facts extracted from captures)
-- ---------------------------------------------------------------------------
create table if not exists public.market_observations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete cascade,
  capture_id uuid references public.market_source_captures(id) on delete set null,
  observation_type text not null check (
    observation_type in (
      'pricing', 'availability', 'special', 'amenity', 'brand_claim', 'contact', 'other'
    )
  ),
  entity_key text,
  value jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  observed_at timestamptz not null default now(),
  superseded_by uuid references public.market_observations(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_market_observations_property
  on public.market_observations(property_id, observed_at desc);
create index if not exists idx_market_observations_competitor
  on public.market_observations(competitor_id, observation_type, observed_at desc);
create index if not exists idx_market_observations_current
  on public.market_observations(competitor_id, observation_type, entity_key)
  where superseded_by is null;

-- ---------------------------------------------------------------------------
-- Part 2c: link existing fact tables to their evidence
-- ---------------------------------------------------------------------------
alter table public.competitor_price_history
  add column if not exists capture_id uuid references public.market_source_captures(id) on delete set null;
alter table public.competitor_units
  add column if not exists capture_id uuid references public.market_source_captures(id) on delete set null;
alter table public.competitor_brand_intelligence
  add column if not exists capture_id uuid references public.market_source_captures(id) on delete set null;
alter table public.competitor_content_chunks
  add column if not exists capture_id uuid references public.market_source_captures(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Part 2d: RLS (org-scoped read, service-role write, same pattern as base)
-- ---------------------------------------------------------------------------
alter table public.market_source_captures enable row level security;
alter table public.market_observations enable row level security;

drop policy if exists "Users view market source captures in their org" on public.market_source_captures;
create policy "Users view market source captures in their org"
  on public.market_source_captures for select using (
    exists (
      select 1 from public.profiles
      join public.properties on properties.id = market_source_captures.property_id
      where profiles.id = auth.uid() and profiles.org_id = properties.org_id
    )
  );

drop policy if exists "Service role full access market_source_captures" on public.market_source_captures;
create policy "Service role full access market_source_captures"
  on public.market_source_captures for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Users view market observations in their org" on public.market_observations;
create policy "Users view market observations in their org"
  on public.market_observations for select using (
    exists (
      select 1 from public.profiles
      join public.properties on properties.id = market_observations.property_id
      where profiles.id = auth.uid() and profiles.org_id = properties.org_id
    )
  );

drop policy if exists "Service role full access market_observations" on public.market_observations;
create policy "Service role full access market_observations"
  on public.market_observations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
