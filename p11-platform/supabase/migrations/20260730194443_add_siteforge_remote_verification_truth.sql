alter table public.property_websites
  add column if not exists deployed_artifact_version_id uuid references public.siteforge_blueprint_versions(id) on delete set null,
  add column if not exists deployed_content_hash text;

alter table public.siteforge_blueprint_versions
  add column if not exists remote_verification_report jsonb,
  add column if not exists remote_verified_url text,
  add column if not exists remote_verified_at timestamptz;

create index if not exists siteforge_blueprint_versions_remote_verified_idx
  on public.siteforge_blueprint_versions (website_id, remote_verified_at desc)
  where remote_verified_at is not null;

comment on column public.property_websites.deployed_artifact_version_id is
  'Immutable artifact proven to be rendered on the remote WordPress target.';
comment on column public.siteforge_blueprint_versions.remote_verification_report is
  'Rendered-output certification evidence for this exact artifact and URL.';
