-- Durable, private visual context for SiteForge semantic editor turns.
create table public.siteforge_edit_attachments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.siteforge_edit_sessions(id) on delete cascade,
  user_message_id uuid references public.siteforge_edit_messages(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  website_id uuid not null references public.property_websites(id) on delete cascade,
  artifact_id uuid not null references public.siteforge_blueprint_versions(id) on delete restrict,
  artifact_content_hash text not null check (artifact_content_hash ~ '^[a-f0-9]{64}$'),
  page_slug text not null check (length(page_slug) between 1 and 160),
  viewport text not null check (viewport in ('mobile', 'tablet', 'desktop')),
  storage_bucket text not null default 'siteforge-artifacts'
    check (storage_bucket = 'siteforge-artifacts'),
  storage_path text not null,
  byte_sha256 text not null check (byte_sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 8388608),
  original_filename text not null check (length(original_filename) between 1 and 255),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  unique (storage_bucket, storage_path)
);

create index siteforge_edit_attachments_session_created_idx
  on public.siteforge_edit_attachments (session_id, created_at, id);
create index siteforge_edit_attachments_message_idx
  on public.siteforge_edit_attachments (user_message_id)
  where user_message_id is not null;
create index siteforge_edit_attachments_tenant_artifact_idx
  on public.siteforge_edit_attachments (
    org_id,
    property_id,
    website_id,
    artifact_id,
    page_slug,
    viewport
  );

alter table public.siteforge_edit_attachments enable row level security;

create policy "Users view their org SiteForge edit attachments"
  on public.siteforge_edit_attachments
  for select
  to authenticated
  using (exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.org_id = siteforge_edit_attachments.org_id
  ));

create policy "Service role manages SiteForge edit attachments"
  on public.siteforge_edit_attachments
  for all
  to service_role
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.siteforge_edit_attachments to authenticated;
grant all on public.siteforge_edit_attachments to service_role;

-- The storage object remains private. Browser access is only through
-- short-lived signed URLs returned after tenant authorization.
update storage.buckets
set public = false,
    file_size_limit = greatest(coalesce(file_size_limit, 0), 10485760),
    allowed_mime_types = (
      select array_agg(distinct mime_type order by mime_type)
      from unnest(
        coalesce(allowed_mime_types, '{}'::text[])
        || array['image/jpeg', 'image/png', 'image/webp']::text[]
      ) as mime_type
    )
where id = 'siteforge-artifacts';

-- This database invariant closes the check-then-insert race between tabs,
-- sessions, users, and application instances.
create unique index shared_jobs_one_active_siteforge_semantic_edit_per_website_idx
  on public.shared_jobs (subject_id)
  where domain = 'siteforge.semantic_edit'
    and lifecycle_status in ('queued', 'running', 'retrying');

comment on table public.siteforge_edit_attachments is
  'Tenant-, artifact-, page-, and viewport-bound private screenshots supplied as multimodal context to SiteForge semantic edit turns.';
