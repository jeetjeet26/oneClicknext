-- ForgeStudio social pipeline canonical editorial + execution records.
--
-- social_content_briefs        user intent: objective, audience, facts, assets, channels, timing
-- social_content_packages      one coordinated creative concept
-- social_content_revisions     immutable revision of a package (content + provenance + approval)
-- social_content_variants      per-channel payloads for one revision
-- social_publications          one approved revision scheduled to one connection
-- social_publication_attempts  every publish/reconcile attempt with idempotency + classification

-- ---------------------------------------------------------------------------
-- Briefs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_content_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  title text NOT NULL,
  objective text NOT NULL,
  topic text,
  audience text,
  source_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels text[] NOT NULL DEFAULT '{}'::text[],
  connection_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  asset_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  scheduling_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'generated', 'archived')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS social_content_briefs_property_idx
  ON public.social_content_briefs (property_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Packages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_content_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES public.social_content_briefs(id) ON DELETE SET NULL,
  concept_summary text,
  status text NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived')
  ),
  current_revision_id uuid,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS social_content_packages_property_idx
  ON public.social_content_packages (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS social_content_packages_brief_idx
  ON public.social_content_packages (brief_id);

-- ---------------------------------------------------------------------------
-- Immutable revisions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.social_content_packages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  authored_by_kind text NOT NULL DEFAULT 'user' CHECK (authored_by_kind IN ('llm', 'user')),
  authored_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  context_snapshot_id uuid REFERENCES public.shared_context_snapshots(id) ON DELETE SET NULL,
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (
    approval_status IN ('pending', 'approved', 'denied', 'superseded')
  ),
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approval_note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (package_id, revision_number)
);

CREATE INDEX IF NOT EXISTS social_content_revisions_package_idx
  ON public.social_content_revisions (package_id, revision_number DESC);

ALTER TABLE public.social_content_packages
  DROP CONSTRAINT IF EXISTS social_content_packages_current_revision_fkey;
ALTER TABLE public.social_content_packages
  ADD CONSTRAINT social_content_packages_current_revision_fkey
  FOREIGN KEY (current_revision_id) REFERENCES public.social_content_revisions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Channel variants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_content_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES public.social_content_revisions(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook', 'linkedin', 'tiktok', 'x')),
  caption text NOT NULL DEFAULT '',
  hashtags text[] NOT NULL DEFAULT '{}'::text[],
  call_to_action text,
  link_url text,
  asset_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  media_urls text[] NOT NULL DEFAULT '{}'::text[],
  alt_text text,
  content_format text NOT NULL DEFAULT 'text' CHECK (
    content_format IN ('text', 'image', 'video', 'reel', 'carousel', 'story')
  ),
  platform_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (revision_id, platform)
);

CREATE INDEX IF NOT EXISTS social_content_variants_revision_idx
  ON public.social_content_variants (revision_id);

-- ---------------------------------------------------------------------------
-- Publications
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.social_content_packages(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.social_content_revisions(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.social_content_variants(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.social_connections(id) ON DELETE CASCADE,
  platform text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled', 'queued', 'publishing', 'reconciling', 'published', 'failed', 'cancelled')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  last_error text,
  error_classification text CHECK (
    error_classification IS NULL OR error_classification IN ('retryable', 'permanent', 'ambiguous')
  ),
  remote_post_id text,
  remote_post_url text,
  published_at timestamptz,
  cancelled_at timestamptz,
  shared_job_id uuid REFERENCES public.shared_jobs(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- One live/completed publication per approved revision + destination.
CREATE UNIQUE INDEX IF NOT EXISTS social_publications_active_target_idx
  ON public.social_publications (revision_id, connection_id)
  WHERE status IN ('scheduled', 'queued', 'publishing', 'reconciling', 'published');

CREATE INDEX IF NOT EXISTS social_publications_due_idx
  ON public.social_publications (status, scheduled_for);
CREATE INDEX IF NOT EXISTS social_publications_property_idx
  ON public.social_publications (property_id, scheduled_for DESC);

-- ---------------------------------------------------------------------------
-- Publication attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.social_publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.social_publications(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (
    status IN ('running', 'succeeded', 'failed', 'reconciling')
  ),
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_post_id text,
  provider_post_url text,
  error_message text,
  error_classification text CHECK (
    error_classification IS NULL OR error_classification IN ('retryable', 'permanent', 'ambiguous')
  ),
  started_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  finished_at timestamptz,
  UNIQUE (publication_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS social_publication_attempts_publication_idx
  ON public.social_publication_attempts (publication_id, attempt_number DESC);

-- ---------------------------------------------------------------------------
-- RLS: org members read, service role writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_content_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publication_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to social_content_briefs"
  ON public.social_content_briefs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Org members can view social_content_briefs"
  ON public.social_content_briefs FOR SELECT TO authenticated
  USING (org_id IN (SELECT pr.org_id FROM public.profiles pr WHERE pr.id = auth.uid()));

CREATE POLICY "Service role full access to social_content_packages"
  ON public.social_content_packages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Org members can view social_content_packages"
  ON public.social_content_packages FOR SELECT TO authenticated
  USING (org_id IN (SELECT pr.org_id FROM public.profiles pr WHERE pr.id = auth.uid()));

CREATE POLICY "Service role full access to social_content_revisions"
  ON public.social_content_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Org members can view social_content_revisions"
  ON public.social_content_revisions FOR SELECT TO authenticated
  USING (org_id IN (SELECT pr.org_id FROM public.profiles pr WHERE pr.id = auth.uid()));

CREATE POLICY "Service role full access to social_content_variants"
  ON public.social_content_variants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Org members can view social_content_variants"
  ON public.social_content_variants FOR SELECT TO authenticated
  USING (org_id IN (SELECT pr.org_id FROM public.profiles pr WHERE pr.id = auth.uid()));

CREATE POLICY "Service role full access to social_publications"
  ON public.social_publications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Org members can view social_publications"
  ON public.social_publications FOR SELECT TO authenticated
  USING (org_id IN (SELECT pr.org_id FROM public.profiles pr WHERE pr.id = auth.uid()));

CREATE POLICY "Service role full access to social_publication_attempts"
  ON public.social_publication_attempts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Org members can view social_publication_attempts"
  ON public.social_publication_attempts FOR SELECT TO authenticated
  USING (org_id IN (SELECT pr.org_id FROM public.profiles pr WHERE pr.id = auth.uid()));
