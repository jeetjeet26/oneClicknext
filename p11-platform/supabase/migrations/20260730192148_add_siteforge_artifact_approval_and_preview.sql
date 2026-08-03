alter table public.siteforge_blueprint_versions
  add column if not exists approval_action_attempt_id uuid references public.shared_action_attempts(id) on delete set null,
  add column if not exists confirmed_approval_id uuid references public.shared_approvals(id) on delete set null,
  add column if not exists deployment_decision text,
  add column if not exists decision_reason text,
  add column if not exists deployment_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists deployment_approved_at timestamptz;

alter table public.siteforge_blueprint_versions
  drop constraint if exists siteforge_blueprint_versions_deployment_decision_check;

alter table public.siteforge_blueprint_versions
  add constraint siteforge_blueprint_versions_deployment_decision_check
  check (
    deployment_decision is null
    or deployment_decision in ('approved', 'denied')
  );

create index if not exists siteforge_blueprint_versions_approval_action_idx
  on public.siteforge_blueprint_versions (approval_action_attempt_id)
  where approval_action_attempt_id is not null;

alter table public.property_websites
  add column if not exists canonical_preview_url text,
  add column if not exists canonical_preview_artifact_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists canonical_preview_content_hash text,
  add column if not exists canonical_previewed_at timestamptz;

comment on column public.siteforge_blueprint_versions.deployment_approved_at is
  'Timestamp of explicit approval for deploying this exact immutable artifact hash.';
comment on column public.property_websites.canonical_preview_artifact_id is
  'Artifact rendered by the canonical WordPress staging preview.';
