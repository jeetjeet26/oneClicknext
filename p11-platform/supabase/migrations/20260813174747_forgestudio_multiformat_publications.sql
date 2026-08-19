drop index if exists public.social_publications_active_target_idx;

create unique index social_publications_active_variant_target_idx
  on public.social_publications (revision_id, variant_id, connection_id)
  where status in ('scheduled', 'queued', 'publishing', 'reconciling', 'published');
