-- =============================================
-- MARKETVISION 360 BASE SCHEMA
-- Core competitor tracking, pricing history, alerts, and scrape configuration
-- =============================================

-- Competitors
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  name text not null,
  address text,
  address_json jsonb default '{}'::jsonb,
  website_url text,
  phone text,
  units_count int,
  year_built int,
  property_type text default 'apartment',
  amenities text[] default '{}'::text[],
  photos text[] default '{}'::text[],
  ils_listings jsonb default '{}'::jsonb,
  notes text,
  is_active boolean default true,
  last_scraped_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(property_id, name)
);

create index if not exists idx_competitors_property on competitors(property_id);
create index if not exists idx_competitors_active on competitors(property_id) where is_active = true;
create index if not exists idx_competitors_name on competitors(name);
create index if not exists idx_competitors_website on competitors(website_url) where website_url is not null;

-- Competitor units and pricing
create table if not exists competitor_units (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid references competitors(id) on delete cascade not null,
  unit_type text not null,
  bedrooms int not null default 0,
  bathrooms numeric(3,1) default 1.0,
  sqft_min int,
  sqft_max int,
  rent_min numeric(10,2),
  rent_max numeric(10,2),
  deposit numeric(10,2),
  available_count int default 0,
  move_in_specials text,
  last_updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(competitor_id, unit_type)
);

create index if not exists idx_competitor_units_competitor on competitor_units(competitor_id);
create index if not exists idx_competitor_units_bedrooms on competitor_units(bedrooms);
create index if not exists idx_competitor_units_updated on competitor_units(last_updated_at desc);

create table if not exists competitor_price_history (
  id uuid primary key default gen_random_uuid(),
  competitor_unit_id uuid references competitor_units(id) on delete cascade not null,
  rent_min numeric(10,2),
  rent_max numeric(10,2),
  available_count int,
  recorded_at timestamptz default now(),
  source text default 'manual'
);

create index if not exists idx_competitor_price_history_unit on competitor_price_history(competitor_unit_id);
create index if not exists idx_competitor_price_history_recorded on competitor_price_history(recorded_at desc);

-- Alerts and cached insights
create table if not exists market_alerts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  competitor_id uuid references competitors(id) on delete set null,
  alert_type text not null,
  severity text default 'info',
  title text not null,
  description text,
  data jsonb default '{}'::jsonb,
  is_read boolean default false,
  is_dismissed boolean default false,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_market_alerts_property on market_alerts(property_id, created_at desc);
create index if not exists idx_market_alerts_unread on market_alerts(property_id) where is_read = false and is_dismissed = false;
create index if not exists idx_market_alerts_type on market_alerts(alert_type);

create table if not exists market_insights (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  insight_type text not null,
  period_start date,
  period_end date,
  data jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_market_insights_property on market_insights(property_id, created_at desc);
create index if not exists idx_market_insights_type on market_insights(insight_type);
create index if not exists idx_market_insights_expires on market_insights(expires_at) where expires_at is not null;

-- Scrape config
create table if not exists scrape_config (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null unique,
  is_enabled boolean default true,
  scrape_frequency text default 'daily',
  radius_miles numeric(6,2) default 3.0,
  max_competitors int default 20,
  auto_add boolean default true,
  last_run_at timestamptz,
  error_count int default 0,
  last_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_scrape_config_enabled on scrape_config(is_enabled) where is_enabled = true;
create index if not exists idx_scrape_config_last_run on scrape_config(last_run_at desc);

-- Updated-at helpers
create or replace function update_marketvision_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_competitors_updated_at on competitors;
create trigger trigger_competitors_updated_at
  before update on competitors
  for each row
  execute function update_marketvision_updated_at();

drop trigger if exists trigger_market_insights_updated_at on market_insights;
create trigger trigger_market_insights_updated_at
  before update on market_insights
  for each row
  execute function update_marketvision_updated_at();

drop trigger if exists trigger_scrape_config_updated_at on scrape_config;
create trigger trigger_scrape_config_updated_at
  before update on scrape_config
  for each row
  execute function update_marketvision_updated_at();

-- Row level security
alter table competitors enable row level security;
alter table competitor_units enable row level security;
alter table competitor_price_history enable row level security;
alter table market_alerts enable row level security;
alter table market_insights enable row level security;
alter table scrape_config enable row level security;

create policy "Users view competitors in their org"
  on competitors for select
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = competitors.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage competitors in their org"
  on competitors for all
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = competitors.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view competitor units in their org"
  on competitor_units for select
  using (
    exists (
      select 1 from competitors c
      join properties p on p.id = c.property_id
      join profiles pr on pr.org_id = p.org_id
      where c.id = competitor_units.competitor_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage competitor units in their org"
  on competitor_units for all
  using (
    exists (
      select 1 from competitors c
      join properties p on p.id = c.property_id
      join profiles pr on pr.org_id = p.org_id
      where c.id = competitor_units.competitor_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view competitor price history in their org"
  on competitor_price_history for select
  using (
    exists (
      select 1 from competitor_units cu
      join competitors c on c.id = cu.competitor_id
      join properties p on p.id = c.property_id
      join profiles pr on pr.org_id = p.org_id
      where cu.id = competitor_price_history.competitor_unit_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view market alerts in their org"
  on market_alerts for select
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = market_alerts.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage market alerts in their org"
  on market_alerts for all
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = market_alerts.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view market insights in their org"
  on market_insights for select
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = market_insights.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage market insights in their org"
  on market_insights for all
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = market_insights.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view scrape config in their org"
  on scrape_config for select
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = scrape_config.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage scrape config in their org"
  on scrape_config for all
  using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = scrape_config.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Service role full access competitors"
  on competitors for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access competitor_units"
  on competitor_units for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access competitor_price_history"
  on competitor_price_history for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access market_alerts"
  on market_alerts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access market_insights"
  on market_insights for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access scrape_config"
  on scrape_config for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
