update storage.buckets
set allowed_mime_types = array[
  'application/zip',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm'
]::text[]
where id = 'siteforge-artifacts';
