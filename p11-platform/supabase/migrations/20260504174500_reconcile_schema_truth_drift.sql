-- Reconcile local, hosted, and generated-type schema drift.
-- This migration is additive/idempotent so it can safely run on environments
-- that already contain one side of the drift.

create or replace function public.set_schema_truth_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Hosted and local evolved different ad account column names. Keep both so
-- current routes, data-engine jobs, and generated types agree across envs.
alter table public.ad_account_connections
  add column if not exists account_timezone text,
  add column if not exists connected_at timestamptz default now(),
  add column if not exists currency text,
  add column if not exists error_count integer default 0,
  add column if not exists last_error text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_error text,
  add column if not exists last_sync_status text,
  add column if not exists manager_account_id text,
  add column if not exists platform_metadata jsonb default '{}'::jsonb;

alter table public.ad_account_connections
  alter column property_id drop not null;

alter table public.lead_scores
  add column if not exists expires_at timestamptz,
  add column if not exists created_at timestamptz default now();

-- Local-only community onboarding tables were missing from hosted.
create table if not exists public.community_profiles (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade unique,
  legal_name text,
  community_type text check (community_type in ('multifamily', 'senior', 'student', 'mixed_use', 'affordable', 'luxury')),
  website_url text,
  unit_count integer,
  year_built integer,
  amenities text[] default '{}',
  pet_policy jsonb default '{}'::jsonb,
  parking_info jsonb default '{}'::jsonb,
  special_features text[] default '{}',
  brand_voice text,
  target_audience text,
  office_hours jsonb default '{}'::jsonb,
  social_media jsonb default '{}'::jsonb,
  intake_completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_community_profiles_property
  on public.community_profiles(property_id);

alter table public.community_profiles enable row level security;

drop policy if exists "Users can view their org community profiles" on public.community_profiles;
create policy "Users can view their org community profiles"
  on public.community_profiles for select
  using (
    exists (
      select 1
      from public.properties prop
      join public.profiles pr on pr.org_id = prop.org_id
      where prop.id = community_profiles.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Admins can manage community profiles" on public.community_profiles;
create policy "Admins can manage community profiles"
  on public.community_profiles for all
  using (
    exists (
      select 1
      from public.properties prop
      join public.profiles pr on pr.org_id = prop.org_id
      where prop.id = community_profiles.property_id
        and pr.id = auth.uid()
        and pr.role in ('admin', 'owner')
    )
  );

drop policy if exists "Service role full access community profiles" on public.community_profiles;
create policy "Service role full access community profiles"
  on public.community_profiles for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists update_community_profiles_updated_at on public.community_profiles;
create trigger update_community_profiles_updated_at
  before update on public.community_profiles
  for each row execute function public.set_schema_truth_updated_at();

create table if not exists public.community_contacts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  contact_type text not null check (contact_type in ('primary', 'secondary', 'billing', 'emergency')),
  name text not null,
  email text not null,
  phone text,
  role text,
  billing_address jsonb,
  billing_method text check (billing_method in ('ops_merchant', 'nexus', 'ach', 'check', 'credit_card', 'other')),
  special_instructions text,
  needs_w9 boolean default false,
  is_primary boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_community_contacts_property
  on public.community_contacts(property_id);
create index if not exists idx_community_contacts_type
  on public.community_contacts(contact_type);

alter table public.community_contacts enable row level security;

drop policy if exists "Users can view their org community contacts" on public.community_contacts;
create policy "Users can view their org community contacts"
  on public.community_contacts for select
  using (
    exists (
      select 1
      from public.properties prop
      join public.profiles pr on pr.org_id = prop.org_id
      where prop.id = community_contacts.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Admins can manage community contacts" on public.community_contacts;
create policy "Admins can manage community contacts"
  on public.community_contacts for all
  using (
    exists (
      select 1
      from public.properties prop
      join public.profiles pr on pr.org_id = prop.org_id
      where prop.id = community_contacts.property_id
        and pr.id = auth.uid()
        and pr.role in ('admin', 'owner')
    )
  );

drop policy if exists "Service role full access community contacts" on public.community_contacts;
create policy "Service role full access community contacts"
  on public.community_contacts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists update_community_contacts_updated_at on public.community_contacts;
create trigger update_community_contacts_updated_at
  before update on public.community_contacts
  for each row execute function public.set_schema_truth_updated_at();

-- SiteForge/ForgeStudio code references these tables outside the current
-- schema-truth scan. Create them explicitly with tenant-safe access.
create table if not exists public.floorplans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade not null,
  name text,
  bedrooms integer default 0,
  bathrooms numeric(3,1) default 1.0,
  sqft integer,
  rent_min numeric(10,2),
  rent_max numeric(10,2),
  is_available boolean default true,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_floorplans_property on public.floorplans(property_id);
alter table public.floorplans enable row level security;

drop policy if exists "Users view floorplans in their org" on public.floorplans;
create policy "Users view floorplans in their org"
  on public.floorplans for select
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = floorplans.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Service role full access floorplans" on public.floorplans;
create policy "Service role full access floorplans"
  on public.floorplans for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists trigger_floorplans_updated_at on public.floorplans;
create trigger trigger_floorplans_updated_at
  before update on public.floorplans
  for each row execute function public.set_schema_truth_updated_at();

create table if not exists public.property_photos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  url text not null,
  alt_text text,
  category text,
  sort_order integer default 0,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_property_photos_property
  on public.property_photos(property_id, sort_order, created_at);

alter table public.property_photos enable row level security;

drop policy if exists "Users view property photos in their org" on public.property_photos;
create policy "Users view property photos in their org"
  on public.property_photos for select
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = property_photos.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Service role full access property photos" on public.property_photos;
create policy "Service role full access property photos"
  on public.property_photos for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists trigger_property_photos_updated_at on public.property_photos;
create trigger trigger_property_photos_updated_at
  before update on public.property_photos
  for each row execute function public.set_schema_truth_updated_at();

create table if not exists public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  competitor_name text,
  source_url text,
  snapshot_data jsonb not null default '{}'::jsonb,
  scraped_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_competitor_snapshots_property_scraped
  on public.competitor_snapshots(property_id, scraped_at desc);

alter table public.competitor_snapshots enable row level security;

drop policy if exists "Users view competitor snapshots in their org" on public.competitor_snapshots;
create policy "Users view competitor snapshots in their org"
  on public.competitor_snapshots for select
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = competitor_snapshots.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Service role full access competitor snapshots" on public.competitor_snapshots;
create policy "Service role full access competitor snapshots"
  on public.competitor_snapshots for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.social_app_credentials (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  platform text not null,
  app_id text not null,
  app_secret text not null,
  is_active boolean not null default true,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(property_id, platform)
);

create index if not exists idx_social_app_credentials_property_platform
  on public.social_app_credentials(property_id, platform)
  where is_active = true;

alter table public.social_app_credentials enable row level security;

drop policy if exists "Service role full access social app credentials" on public.social_app_credentials;
create policy "Service role full access social app credentials"
  on public.social_app_credentials for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists trigger_social_app_credentials_updated_at on public.social_app_credentials;
create trigger trigger_social_app_credentials_updated_at
  before update on public.social_app_credentials
  for each row execute function public.set_schema_truth_updated_at();

-- Hosted/type tables that were absent from the local migration replay.
create table if not exists public.field_mapping_suggestions (
  id uuid primary key default gen_random_uuid(),
  crm_type text not null,
  tourspark_field text not null,
  suggested_crm_field text not null,
  final_crm_field text,
  times_suggested integer default 1,
  times_accepted integer default 0,
  times_corrected integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(crm_type, tourspark_field, suggested_crm_field)
);

create index if not exists idx_field_mapping_suggestions_crm_type
  on public.field_mapping_suggestions(crm_type);
create index if not exists idx_field_mapping_suggestions_accepted
  on public.field_mapping_suggestions(times_accepted desc);

alter table public.field_mapping_suggestions enable row level security;

drop policy if exists "Authenticated users can read mapping suggestions" on public.field_mapping_suggestions;
create policy "Authenticated users can read mapping suggestions"
  on public.field_mapping_suggestions for select
  using (auth.role() = 'authenticated');

drop policy if exists "Service role can manage mapping suggestions" on public.field_mapping_suggestions;
create policy "Service role can manage mapping suggestions"
  on public.field_mapping_suggestions for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists trigger_field_mapping_suggestions_updated_at on public.field_mapping_suggestions;
create trigger trigger_field_mapping_suggestions_updated_at
  before update on public.field_mapping_suggestions
  for each row execute function public.set_schema_truth_updated_at();

create table if not exists public.scoring_config (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade unique,
  engagement_weight integer default 30 check (engagement_weight between 0 and 100),
  timing_weight integer default 25 check (timing_weight between 0 and 100),
  source_weight integer default 20 check (source_weight between 0 and 100),
  completeness_weight integer default 15 check (completeness_weight between 0 and 100),
  behavior_weight integer default 10 check (behavior_weight between 0 and 100),
  hot_threshold integer default 75 check (hot_threshold between 0 and 100),
  warm_threshold integer default 50 check (warm_threshold between 0 and 100),
  cold_threshold integer default 25 check (cold_threshold between 0 and 100),
  source_scores jsonb default '{"Other": 40, "Zillow": 60, "Walk-in": 90, "Referral": 85, "Google Ad": 65, "Phone Call": 85, "Facebook Ad": 50, "Website Form": 70, "Apartments.com": 55, "LumaLeasing Widget": 80}'::jsonb,
  active_model text default 'v1-rules',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.scoring_config enable row level security;

drop policy if exists "Users can view scoring config for their properties" on public.scoring_config;
create policy "Users can view scoring config for their properties"
  on public.scoring_config for select
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = scoring_config.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Admins can update scoring config" on public.scoring_config;
create policy "Admins can update scoring config"
  on public.scoring_config for update
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = scoring_config.property_id
        and pr.id = auth.uid()
        and pr.role in ('admin', 'owner')
    )
  );

drop policy if exists "Service role full access scoring config" on public.scoring_config;
create policy "Service role full access scoring config"
  on public.scoring_config for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists trigger_scoring_config_updated_at on public.scoring_config;
create trigger trigger_scoring_config_updated_at
  before update on public.scoring_config
  for each row execute function public.set_schema_truth_updated_at();

create table if not exists public.conversation_analytics (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  total_messages integer default 0,
  user_messages integer default 0,
  ai_messages integer default 0,
  human_messages integer default 0,
  first_response_ms integer,
  avg_response_ms integer,
  total_duration_seconds integer,
  lead_captured boolean default false,
  tour_booked boolean default false,
  human_takeover boolean default false,
  sentiment_score double precision,
  created_at timestamptz default now()
);

alter table public.conversation_analytics enable row level security;

drop policy if exists "Users view their org conversation analytics" on public.conversation_analytics;
create policy "Users view their org conversation analytics"
  on public.conversation_analytics for select
  using (
    exists (
      select 1
      from public.profiles
      join public.properties on properties.id = conversation_analytics.property_id
      where profiles.id = auth.uid()
        and profiles.org_id = properties.org_id
    )
  );

drop policy if exists "Service role full access conversation analytics" on public.conversation_analytics;
create policy "Service role full access conversation analytics"
  on public.conversation_analytics for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create table if not exists public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id),
  content_draft_id uuid references public.content_drafts(id),
  scheduled_date date not null,
  scheduled_time time,
  timezone text default 'America/Chicago',
  platform text not null,
  account_id text,
  status text default 'scheduled' check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  published_at timestamptz,
  error_message text,
  platform_post_id text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_content_calendar_property
  on public.content_calendar(property_id);
create index if not exists idx_content_calendar_scheduled
  on public.content_calendar(scheduled_date, scheduled_time);

alter table public.content_calendar enable row level security;

drop policy if exists "Users can view content_calendar for their properties" on public.content_calendar;
create policy "Users can view content_calendar for their properties"
  on public.content_calendar for select
  using (
    property_id in (
      select p.id
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

drop policy if exists "Users can manage content_calendar for their properties" on public.content_calendar;
create policy "Users can manage content_calendar for their properties"
  on public.content_calendar for all
  using (
    property_id in (
      select p.id
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid()
    )
  );

drop policy if exists "Service role full access to content_calendar" on public.content_calendar;
create policy "Service role full access to content_calendar"
  on public.content_calendar for all to service_role
  using (true)
  with check (true);

drop trigger if exists trigger_content_calendar_updated_at on public.content_calendar;
create trigger trigger_content_calendar_updated_at
  before update on public.content_calendar
  for each row execute function public.set_schema_truth_updated_at();

create table if not exists public.website_generations (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.property_websites(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('initial', 'brand_updated', 'user_requested', 'refinement', 'a_b_test', 'performance_optimization')),
  changes_requested text,
  changes_made jsonb,
  performance_delta jsonb,
  generated_by uuid references auth.users(id),
  generated_at timestamptz default now()
);

create index if not exists idx_website_generations_website_id
  on public.website_generations(website_id);

alter table public.website_generations enable row level security;

drop policy if exists "Users can view generations for their websites" on public.website_generations;
create policy "Users can view generations for their websites"
  on public.website_generations for select
  using (
    website_id in (
      select property_websites.id
      from public.property_websites
      where property_websites.property_id in (
        select properties.id
        from public.properties
        where properties.org_id in (
          select profiles.org_id
          from public.profiles
          where profiles.id = auth.uid()
        )
      )
    )
  );

drop policy if exists "Users can create generations for their websites" on public.website_generations;
create policy "Users can create generations for their websites"
  on public.website_generations for insert
  with check (
    website_id in (
      select property_websites.id
      from public.property_websites
      where property_websites.property_id in (
        select properties.id
        from public.properties
        where properties.org_id in (
          select profiles.org_id
          from public.profiles
          where profiles.id = auth.uid()
        )
      )
    )
  );

drop policy if exists "Service role full access website generations" on public.website_generations;
create policy "Service role full access website generations"
  on public.website_generations for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Reporting tables need RLS locally to match production behavior.
alter table public.metric_goals enable row level security;
alter table public.scheduled_reports enable row level security;
alter table public.report_send_history enable row level security;

drop policy if exists "Users can view goals for properties in their organization" on public.metric_goals;
create policy "Users can view goals for properties in their organization"
  on public.metric_goals for select
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = metric_goals.property_id
        and pr.id = auth.uid()
    )
  );

drop policy if exists "Admins and managers can manage goals" on public.metric_goals;
create policy "Admins and managers can manage goals"
  on public.metric_goals for all
  using (
    exists (
      select 1
      from public.properties p
      join public.profiles pr on pr.org_id = p.org_id
      where p.id = metric_goals.property_id
        and pr.id = auth.uid()
        and pr.role in ('admin', 'manager')
    )
  );

drop policy if exists "Service role can manage all goals" on public.metric_goals;
create policy "Service role can manage all goals"
  on public.metric_goals for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Users can view their organization's scheduled reports" on public.scheduled_reports;
create policy "Users can view their organization's scheduled reports"
  on public.scheduled_reports for select
  using (
    org_id in (
      select profiles.org_id
      from public.profiles
      where profiles.id = auth.uid()
    )
  );

drop policy if exists "Admins and managers can manage scheduled reports" on public.scheduled_reports;
create policy "Admins and managers can manage scheduled reports"
  on public.scheduled_reports for all
  using (
    org_id in (
      select profiles.org_id
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role in ('admin', 'manager')
    )
  );

drop policy if exists "Users can view their report history" on public.report_send_history;
create policy "Users can view their report history"
  on public.report_send_history for select
  using (
    scheduled_report_id in (
      select scheduled_reports.id
      from public.scheduled_reports
      where scheduled_reports.org_id in (
        select profiles.org_id
        from public.profiles
        where profiles.id = auth.uid()
      )
    )
  );

drop policy if exists "Service role can manage report send history" on public.report_send_history;
create policy "Service role can manage report send history"
  on public.report_send_history for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Views present on only one side of the drift.
create or replace view public.lead_scores_latest
with (security_invoker = true) as
select distinct on (ls.lead_id)
  ls.id,
  ls.lead_id,
  ls.total_score,
  ls.engagement_score,
  ls.timing_score,
  ls.source_score,
  ls.completeness_score,
  ls.behavior_score,
  ls.score_bucket,
  ls.factors,
  ls.model_version,
  ls.scored_at,
  ls.expires_at,
  ls.created_at,
  l.first_name,
  l.last_name,
  l.email,
  l.phone,
  l.status,
  l.source,
  l.created_at as lead_created_at
from public.lead_scores ls
join public.leads l on l.id = ls.lead_id
order by ls.lead_id, ls.scored_at desc;

create or replace view public.vw_import_status
with (security_invoker = true) as
select
  p.id as property_id,
  p.name as property_name,
  ac.platform,
  ac.account_id,
  ac.last_imported_at,
  ac.last_sync_at,
  (
    select count(*)::bigint
    from public.import_jobs ij
    where ij.property_id = p.id
      and ij.status = 'running'
  ) as active_imports,
  (
    select max(ij.completed_at)
    from public.import_jobs ij
    where ij.property_id = p.id
      and ij.status = 'complete'
  ) as last_successful_import
from public.properties p
join public.ad_account_connections ac on p.id = ac.property_id
where ac.is_active = true;

create or replace view public.vw_property_marketing_setup
with (security_invoker = true) as
select
  p.id as property_id,
  p.name as property_name,
  p.org_id,
  max(case when ac.platform = 'google_ads' then ac.account_id end) as google_ads_customer_id,
  max(case when ac.platform = 'meta_ads' then ac.account_id end) as meta_ad_account_id,
  max(case when ac.platform = 'ga4' then ac.account_id end) as ga4_property_id,
  count(distinct ac.id) filter (where ac.is_active) as active_connections,
  max(ac.last_sync_at) as last_marketing_sync
from public.properties p
left join public.ad_account_connections ac
  on p.id = ac.property_id
  and ac.is_active = true
group by p.id, p.name, p.org_id;

create or replace view public.website_summary
with (security_invoker = true) as
select
  pw.id,
  pw.property_id,
  p.name as property_name,
  pw.generation_status,
  pw.generation_progress,
  pw.brand_source,
  pw.brand_confidence,
  pw.wp_url,
  pw.version,
  coalesce(jsonb_array_length(pw.pages_generated), 0) as pages_count,
  count(distinct wa.id) as assets_count,
  pw.created_at,
  pw.updated_at
from public.property_websites pw
join public.properties p on p.id = pw.property_id
left join public.website_assets wa on wa.website_id = pw.id
group by pw.id, p.name;
