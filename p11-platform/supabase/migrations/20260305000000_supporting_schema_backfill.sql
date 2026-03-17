-- Supporting schema backfill for app-referenced tables that were
-- never added to the original migration set.

-- Extend properties with onboarding/profile fields used across the app.
alter table properties
  add column if not exists property_type text,
  add column if not exists website_url text,
  add column if not exists unit_count int,
  add column if not exists year_built int,
  add column if not exists amenities text[] default '{}'::text[],
  add column if not exists pet_policy jsonb default '{}'::jsonb,
  add column if not exists parking_info jsonb default '{}'::jsonb,
  add column if not exists special_features text[] default '{}'::text[],
  add column if not exists brand_voice text,
  add column if not exists target_audience text,
  add column if not exists office_hours jsonb default '{}'::jsonb,
  add column if not exists social_media jsonb default '{}'::jsonb,
  add column if not exists onboarding_completed_at timestamptz;

-- Property contacts used by onboarding and property management routes.
create table if not exists property_contacts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  contact_type text not null,
  name text not null,
  email text not null,
  phone text,
  role text,
  billing_address jsonb,
  billing_method text,
  special_instructions text,
  needs_w9 boolean default false,
  is_primary boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_property_contacts_property on property_contacts(property_id);
create index if not exists idx_property_contacts_primary on property_contacts(property_id, is_primary desc);

-- BrandForge persistence.
create table if not exists property_brand_assets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null unique,
  generated_by uuid references auth.users(id) on delete set null,
  generation_status text default 'draft',
  competitive_analysis jsonb,
  gemini_conversation_history jsonb default '[]'::jsonb,
  conversation_summary jsonb,
  section_1_introduction jsonb,
  section_2_positioning jsonb,
  section_3_target_audience jsonb,
  section_4_personas jsonb,
  section_5_name_story jsonb,
  section_6_logo jsonb,
  section_7_typography jsonb,
  section_8_colors jsonb,
  section_9_design_elements jsonb,
  section_10_photo_yep jsonb,
  section_11_photo_nope jsonb,
  section_12_implementation jsonb,
  vision_board_url text,
  brand_book_pdf_url text,
  pdf_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_property_brand_assets_property on property_brand_assets(property_id);
create index if not exists idx_property_brand_assets_status on property_brand_assets(generation_status);

-- Compatibility view for PropertyAudit query generation.
create or replace view brand_books as
select
  id,
  property_id,
  coalesce(
    array(
      select jsonb_array_elements_text(
        coalesce(section_2_positioning->'differentiators', '[]'::jsonb)
      )
    ),
    array[]::text[]
  ) as unique_selling_points,
  coalesce(
    section_3_target_audience->>'primary',
    conversation_summary->>'targetAudience'
  ) as target_audience,
  created_at
from property_brand_assets;

-- Site analysis helpers.
create table if not exists floorplans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  name text,
  bedrooms int default 0,
  bathrooms numeric(3,1) default 1.0,
  sqft int,
  rent_min numeric(10,2),
  rent_max numeric(10,2),
  is_available boolean default true,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_floorplans_property on floorplans(property_id);

-- Extended analytics import tables.
create table if not exists fact_marketing_extended (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  channel_id text not null,
  campaign_name text,
  report_type text not null,
  dimension_key text not null,
  dimension_value text not null,
  date_range_start date,
  date_range_end date,
  metrics jsonb not null default '{}'::jsonb,
  raw_source text,
  created_at timestamptz default now(),
  unique(property_id, channel_id, report_type, dimension_value, date_range_start, date_range_end)
);

create index if not exists idx_fact_marketing_extended_property on fact_marketing_extended(property_id);
create index if not exists idx_fact_marketing_extended_report on fact_marketing_extended(report_type);

create table if not exists marketing_data_uploads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  platform text not null,
  report_type text not null,
  file_name text not null,
  date_range_start date,
  date_range_end date,
  rows_imported int default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists idx_marketing_data_uploads_property on marketing_data_uploads(property_id, created_at desc);

create table if not exists import_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  channels text[] default '{}'::text[],
  date_range text,
  status text default 'pending',
  progress_pct numeric default 0,
  current_step text,
  records_imported int default 0,
  campaigns_found int default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_import_jobs_property on import_jobs(property_id, created_at desc);
create index if not exists idx_import_jobs_status on import_jobs(status);

-- Ad account links for BI sync.
create table if not exists ad_account_connections (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  org_id uuid references organizations(id) on delete cascade,
  platform text not null,
  account_id text not null,
  account_name text,
  account_timezone text,
  currency text,
  is_active boolean default true,
  connected_by uuid references profiles(id) on delete set null,
  connected_at timestamptz default now(),
  last_synced_at timestamptz,
  last_imported_at timestamptz,
  error_count int default 0,
  last_error text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(property_id, platform, account_id)
);

create index if not exists idx_ad_account_connections_property on ad_account_connections(property_id);
create index if not exists idx_ad_account_connections_org on ad_account_connections(org_id);
create index if not exists idx_ad_account_connections_platform on ad_account_connections(platform);
create index if not exists idx_ad_account_connections_active on ad_account_connections(is_active) where is_active = true;

-- Audit trails.
create table if not exists mcp_audit_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete set null,
  platform text,
  server text,
  tool text,
  tool_name text,
  operation_type text,
  parameters jsonb,
  result jsonb,
  action_details jsonb,
  success boolean default true,
  error_message text,
  timestamp timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_mcp_audit_log_property on mcp_audit_log(property_id, created_at desc);
create index if not exists idx_mcp_audit_log_platform on mcp_audit_log(platform);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  entity_name text,
  details jsonb default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);

create index if not exists idx_audit_logs_org on audit_logs(org_id, created_at desc);
create index if not exists idx_audit_logs_user on audit_logs(user_id);

-- Lightweight update triggers.
create or replace function update_supporting_schema_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trigger_property_contacts_updated_at on property_contacts;
create trigger trigger_property_contacts_updated_at
  before update on property_contacts
  for each row execute function update_supporting_schema_updated_at();

drop trigger if exists trigger_property_brand_assets_updated_at on property_brand_assets;
create trigger trigger_property_brand_assets_updated_at
  before update on property_brand_assets
  for each row execute function update_supporting_schema_updated_at();

drop trigger if exists trigger_floorplans_updated_at on floorplans;
create trigger trigger_floorplans_updated_at
  before update on floorplans
  for each row execute function update_supporting_schema_updated_at();

drop trigger if exists trigger_ad_account_connections_updated_at on ad_account_connections;
create trigger trigger_ad_account_connections_updated_at
  before update on ad_account_connections
  for each row execute function update_supporting_schema_updated_at();

-- Org-aware RLS for user-facing tables.
alter table property_contacts enable row level security;
alter table property_brand_assets enable row level security;
alter table floorplans enable row level security;
alter table fact_marketing_extended enable row level security;
alter table marketing_data_uploads enable row level security;
alter table import_jobs enable row level security;
alter table ad_account_connections enable row level security;
alter table mcp_audit_log enable row level security;
alter table audit_logs enable row level security;

create policy "Users view property contacts in their org"
  on property_contacts for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = property_contacts.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage property contacts in their org"
  on property_contacts for all using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = property_contacts.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view property brand assets in their org"
  on property_brand_assets for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = property_brand_assets.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage property brand assets in their org"
  on property_brand_assets for all using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = property_brand_assets.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view floorplans in their org"
  on floorplans for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = floorplans.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view marketing extended in their org"
  on fact_marketing_extended for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = fact_marketing_extended.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view marketing uploads in their org"
  on marketing_data_uploads for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = marketing_data_uploads.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view import jobs in their org"
  on import_jobs for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = import_jobs.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users view ad account connections in their org"
  on ad_account_connections for select using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = ad_account_connections.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Users manage ad account connections in their org"
  on ad_account_connections for all using (
    exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = ad_account_connections.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Admins view audit logs in their org"
  on audit_logs for select using (
    exists (
      select 1 from profiles pr
      where pr.id = auth.uid()
      and pr.org_id = audit_logs.org_id
      and pr.role = 'admin'
    )
  );

create policy "Users insert own audit logs"
  on audit_logs for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from profiles pr
      where pr.id = auth.uid()
      and pr.org_id = audit_logs.org_id
    )
  );

create policy "Users view mcp audit log in their org"
  on mcp_audit_log for select using (
    property_id is null or exists (
      select 1 from properties p
      join profiles pr on pr.org_id = p.org_id
      where p.id = mcp_audit_log.property_id
      and pr.id = auth.uid()
    )
  );

create policy "Service role full access property supporting schema"
  on property_contacts for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access brand assets"
  on property_brand_assets for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access floorplans"
  on floorplans for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access fact marketing extended"
  on fact_marketing_extended for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access marketing uploads"
  on marketing_data_uploads for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access import jobs"
  on import_jobs for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access ad account connections"
  on ad_account_connections for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Service role full access mcp audit log"
  on mcp_audit_log for all using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
