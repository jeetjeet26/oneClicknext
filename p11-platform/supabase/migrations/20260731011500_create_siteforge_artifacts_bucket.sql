insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'siteforge-artifacts',
  'siteforge-artifacts',
  false,
  10485760,
  array['application/zip']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.siteforge_theme_overlays is
  'Content-addressed, signed SiteForge overlay packages stored in the private siteforge-artifacts bucket.';
