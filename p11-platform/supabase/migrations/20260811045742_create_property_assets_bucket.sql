-- Reproduce the property-assets bucket and its existing access contract in
-- clean local resets. Application routes still enforce property/org ownership
-- before using service-role storage operations.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'property-assets',
  'property-assets',
  true,
  52428800,
  array[
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'font/woff2',
    'application/font-woff2'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read property-assets" on storage.objects;
create policy "Public read property-assets"
  on storage.objects
  for select
  using (bucket_id = 'property-assets');

drop policy if exists "Authenticated upload property-assets" on storage.objects;
create policy "Authenticated upload property-assets"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'property-assets');

drop policy if exists "Authenticated update property-assets" on storage.objects;
create policy "Authenticated update property-assets"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'property-assets')
  with check (bucket_id = 'property-assets');

drop policy if exists "Authenticated delete property-assets" on storage.objects;
create policy "Authenticated delete property-assets"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'property-assets');

drop policy if exists "Service role full access property-assets" on storage.objects;
create policy "Service role full access property-assets"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'property-assets')
  with check (bucket_id = 'property-assets');
