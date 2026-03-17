-- =============================================
-- ADD SITEFORGE AGENTIC FIELDS TO EXISTING TABLES
-- Adds blueprint, agent outputs, and conversational editing support
-- Created: December 16, 2025
-- =============================================

-- Add org_id to property_websites (for RLS)
ALTER TABLE property_websites 
ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- Add agentic system fields
ALTER TABLE property_websites 
ADD COLUMN IF NOT EXISTS blueprint jsonb,
ADD COLUMN IF NOT EXISTS site_blueprint_version int DEFAULT 1,
ADD COLUMN IF NOT EXISTS site_blueprint_updated_at timestamptz,
ADD COLUMN IF NOT EXISTS generation_input jsonb;

-- Add existing fields if missing
ALTER TABLE property_websites 
ADD COLUMN IF NOT EXISTS generation_status text DEFAULT 'queued',
ADD COLUMN IF NOT EXISTS generation_progress int DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_step text,
ADD COLUMN IF NOT EXISTS error_message text,
ADD COLUMN IF NOT EXISTS brand_source text,
ADD COLUMN IF NOT EXISTS brand_confidence numeric(3,2),
ADD COLUMN IF NOT EXISTS site_architecture jsonb,
ADD COLUMN IF NOT EXISTS pages_generated jsonb,
ADD COLUMN IF NOT EXISTS assets_manifest jsonb,
ADD COLUMN IF NOT EXISTS generation_started_at timestamptz,
ADD COLUMN IF NOT EXISTS generation_completed_at timestamptz,
ADD COLUMN IF NOT EXISTS generation_duration_seconds int,
ADD COLUMN IF NOT EXISTS deployed_at timestamptz,
ADD COLUMN IF NOT EXISTS page_views int DEFAULT 0,
ADD COLUMN IF NOT EXISTS tour_requests int DEFAULT 0,
ADD COLUMN IF NOT EXISTS conversion_rate numeric(5,2),
ADD COLUMN IF NOT EXISTS version int DEFAULT 1,
ADD COLUMN IF NOT EXISTS previous_version_id uuid REFERENCES property_websites(id),
ADD COLUMN IF NOT EXISTS user_preferences jsonb,
ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Update existing rows to set org_id
UPDATE property_websites pw
SET org_id = p.org_id
FROM properties p
WHERE pw.property_id = p.id
AND pw.org_id IS NULL;

-- Add agentic fields to website_assets if table exists
ALTER TABLE website_assets 
ADD COLUMN IF NOT EXISTS generation_prompt text,
ADD COLUMN IF NOT EXISTS quality_score numeric(3,1),
ADD COLUMN IF NOT EXISTS brand_alignment_score numeric(3,1);

-- Add agent_logs to siteforge_jobs if table exists
ALTER TABLE siteforge_jobs
ADD COLUMN IF NOT EXISTS agent_logs jsonb;

-- Create blueprint versions table
CREATE TABLE IF NOT EXISTS siteforge_blueprint_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  website_id uuid REFERENCES property_websites(id) ON DELETE CASCADE NOT NULL,
  version int NOT NULL,
  blueprint jsonb NOT NULL,
  changes_summary text,
  edit_intent text,
  patches_applied jsonb,
  quality_score numeric(5,2),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(website_id, version)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_property_websites_org ON property_websites(org_id);
CREATE INDEX IF NOT EXISTS idx_blueprint_versions_website ON siteforge_blueprint_versions(website_id, version DESC);

-- Enable RLS on blueprint versions
ALTER TABLE siteforge_blueprint_versions ENABLE ROW LEVEL SECURITY;

-- Add policies
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'siteforge_blueprint_versions'
      and policyname = 'Users view org blueprint versions'
  ) then
    create policy "Users view org blueprint versions"
    on siteforge_blueprint_versions for select using (
      exists (
        select 1 from profiles
        join property_websites on property_websites.id = siteforge_blueprint_versions.website_id
        join properties on properties.id = property_websites.property_id
        where profiles.id = auth.uid()
        and profiles.org_id = properties.org_id
      )
    );
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'siteforge_blueprint_versions'
      and policyname = 'Service role full access blueprint versions'
  ) then
    create policy "Service role full access blueprint versions"
    on siteforge_blueprint_versions for all using (auth.role() = 'service_role');
  end if;
end
$$;

-- Add comments
COMMENT ON COLUMN property_websites.blueprint IS 
'Complete SiteBlueprint from Orchestrator with all agent outputs: brandContext, architecture, designSystem, photoManifest, qualityReport, agentLogs';

COMMENT ON COLUMN property_websites.site_blueprint_version IS 
'Version number for editing history. Increments with each conversational edit.';

COMMENT ON TABLE siteforge_blueprint_versions IS 
'Version history for conversational editing. Each edit creates new version with patches_applied showing what changed.';










