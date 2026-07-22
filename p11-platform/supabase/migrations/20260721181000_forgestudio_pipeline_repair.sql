-- ForgeStudio social pipeline: repair verified live drift and harden queue/credential semantics.
--
-- 1. content_drafts editorial states used by code (`draft_partial`, `failed`) were missing.
-- 2. social_connections carried two conflicting platform checks (older one excluded tiktok).
-- 3. published_posts was missing `engagement_metrics`, the `skipped`/`reconciling` states, and
--    database-enforced uniqueness of one active publication per (draft, connection).
-- 4. shared_jobs had no claimable-queue semantics (lease owner/expiry, heartbeat, due time).
-- 5. Token-bearing columns were readable by every authenticated org member.

-- ---------------------------------------------------------------------------
-- 1. content_drafts editorial states
-- ---------------------------------------------------------------------------
ALTER TABLE public.content_drafts DROP CONSTRAINT IF EXISTS content_drafts_status_check;
ALTER TABLE public.content_drafts
  ADD CONSTRAINT content_drafts_status_check CHECK (
    status = ANY (ARRAY[
      'generating'::text,
      'draft'::text,
      'draft_partial'::text,
      'pending_review'::text,
      'approved'::text,
      'scheduled'::text,
      'publishing'::text,
      'published'::text,
      'failed'::text,
      'rejected'::text,
      'archived'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. social_connections platform constraint (single source of truth, adds x)
-- ---------------------------------------------------------------------------
ALTER TABLE public.social_connections DROP CONSTRAINT IF EXISTS check_valid_platform;
ALTER TABLE public.social_connections DROP CONSTRAINT IF EXISTS social_connections_platform_check;
ALTER TABLE public.social_connections
  ADD CONSTRAINT social_connections_platform_check CHECK (
    platform = ANY (ARRAY[
      'instagram'::text,
      'facebook'::text,
      'linkedin'::text,
      'twitter'::text,
      'x'::text,
      'tiktok'::text,
      'google_business'::text
    ])
  );

-- ---------------------------------------------------------------------------
-- 3. published_posts audit alignment + duplicate prevention
-- ---------------------------------------------------------------------------
ALTER TABLE public.published_posts
  ADD COLUMN IF NOT EXISTS engagement_metrics jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.published_posts DROP CONSTRAINT IF EXISTS published_posts_status_check;
ALTER TABLE public.published_posts
  ADD CONSTRAINT published_posts_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'publishing'::text,
      'reconciling'::text,
      'published'::text,
      'failed'::text,
      'skipped'::text
    ])
  );

-- One active publish (in-flight or completed) per draft/connection pair.
CREATE UNIQUE INDEX IF NOT EXISTS published_posts_active_pair_idx
  ON public.published_posts (content_draft_id, social_connection_id)
  WHERE status IN ('publishing', 'reconciling', 'published');

-- ---------------------------------------------------------------------------
-- 4. shared_jobs claimable queue semantics
-- ---------------------------------------------------------------------------
ALTER TABLE public.shared_jobs
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS shared_jobs_claimable_idx
  ON public.shared_jobs (domain, available_at)
  WHERE lifecycle_status IN ('queued', 'retrying', 'running');

-- Atomic claim with FOR UPDATE SKIP LOCKED. Also reclaims running jobs whose
-- lease has expired (crashed worker) as long as attempts remain.
CREATE OR REPLACE FUNCTION public.claim_shared_jobs(
  p_domain text,
  p_worker text,
  p_limit integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.shared_jobs
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.shared_jobs sj
  SET
    lifecycle_status = 'running',
    status_reason = 'claimed',
    lease_owner = p_worker,
    lease_expires_at = timezone('utc'::text, now()) + make_interval(secs => p_lease_seconds),
    heartbeat_at = timezone('utc'::text, now()),
    started_at = COALESCE(sj.started_at, timezone('utc'::text, now())),
    attempt_count = sj.attempt_count + 1,
    updated_at = timezone('utc'::text, now())
  WHERE sj.id IN (
    SELECT candidate.id
    FROM public.shared_jobs candidate
    WHERE candidate.domain = p_domain
      AND candidate.attempt_count < candidate.max_attempts
      AND (
        (
          candidate.lifecycle_status IN ('queued', 'retrying')
          AND candidate.available_at <= timezone('utc'::text, now())
        )
        OR (
          candidate.lifecycle_status = 'running'
          AND candidate.lease_expires_at IS NOT NULL
          AND candidate.lease_expires_at < timezone('utc'::text, now())
        )
      )
    ORDER BY candidate.available_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING sj.*;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_shared_jobs(text, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_shared_jobs(text, text, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_shared_jobs(text, text, integer, integer) FROM authenticated;

-- Heartbeat helper for long-running publishes.
CREATE OR REPLACE FUNCTION public.heartbeat_shared_job(
  p_job_id uuid,
  p_worker text,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.shared_jobs
  SET
    heartbeat_at = timezone('utc'::text, now()),
    lease_expires_at = timezone('utc'::text, now()) + make_interval(secs => p_lease_seconds),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_job_id
    AND lease_owner = p_worker
    AND lifecycle_status = 'running';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.heartbeat_shared_job(uuid, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.heartbeat_shared_job(uuid, text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.heartbeat_shared_job(uuid, text, integer) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 5. Credential consolidation + token exposure
-- ---------------------------------------------------------------------------
-- social_app_credentials duplicated social_auth_configs with a *plaintext*
-- app_secret column. It is empty in every environment; consolidate on
-- social_auth_configs (encrypted secret) and drop the plaintext table.
DROP TABLE IF EXISTS public.social_app_credentials;

-- Token-bearing columns must not be readable by normal authenticated users.
-- Writes already go through service-role API routes, so drop the broad
-- member-manage policies and restrict SELECT to non-secret columns.
DROP POLICY IF EXISTS "Users can manage social_connections for their properties" ON public.social_connections;
DROP POLICY IF EXISTS "Users can manage social auth configs for their properties" ON public.social_auth_configs;

REVOKE SELECT ON TABLE public.social_connections FROM anon;
REVOKE SELECT ON TABLE public.social_connections FROM authenticated;
GRANT SELECT (
  id,
  property_id,
  platform,
  account_id,
  account_name,
  account_username,
  account_avatar_url,
  token_expires_at,
  scopes,
  is_active,
  last_used_at,
  last_error,
  error_count,
  page_id,
  connected_by,
  created_at,
  updated_at
) ON public.social_connections TO authenticated;

REVOKE SELECT ON TABLE public.social_auth_configs FROM anon;
REVOKE SELECT ON TABLE public.social_auth_configs FROM authenticated;
GRANT SELECT (
  id,
  property_id,
  platform,
  app_id,
  redirect_uri,
  is_configured,
  last_verified_at,
  created_at,
  updated_at
) ON public.social_auth_configs TO authenticated;
