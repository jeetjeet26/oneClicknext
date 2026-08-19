-- SiteForge now has one owner-operated guided journey. The unused autonomous
-- intake control plane and external client-review ceremony are intentionally
-- retired rather than left as competing product surfaces.

drop table if exists private.siteforge_public_review_rate_limits cascade;

drop table if exists public.siteforge_client_decisions cascade;
drop table if exists public.siteforge_review_comments cascade;
drop table if exists public.siteforge_revision_rounds cascade;
drop table if exists public.siteforge_review_tokens cascade;
drop table if exists public.siteforge_review_sessions cascade;

drop table if exists public.siteforge_intake_checkpoint_bindings cascade;
drop table if exists public.siteforge_intake_conflicts cascade;
drop table if exists public.siteforge_intake_sources cascade;
drop table if exists public.siteforge_intake_revisions cascade;
drop table if exists public.siteforge_intake_sessions cascade;

alter table public.property_websites
  drop column if exists intake_session_id;

alter table public.property_brand_assets
  drop column if exists intake_session_id;

alter table public.property_onboarding_snapshots
  drop column if exists intake_session_id;

alter table public.siteforge_plans
  drop column if exists intake_session_id;

-- The AAL2 solo step-up confirmation flow is fully retired: the owner
-- one-button launch binds authority to the exact release identity hash
-- instead. Nothing can populate or verify these rows anymore.
alter table public.siteforge_launch_releases
  drop constraint if exists siteforge_launch_release_confirmation_tenant_fkey;

alter table public.siteforge_launch_releases
  drop column if exists latest_launch_confirmation_id,
  drop column if exists latest_launch_confirmation_hash;

drop table if exists public.siteforge_launch_confirmations cascade;
