create unique index if not exists shared_context_snapshots_guided_revision_uidx
  on public.shared_context_snapshots (source_domain, source_ref)
  where source_domain = 'siteforge.guided'
    and source_ref is not null;

create index if not exists shared_context_snapshots_guided_website_created_idx
  on public.shared_context_snapshots (
    (split_part(source_ref, ':', 2)),
    created_at desc
  )
  where source_domain = 'siteforge.guided'
    and source_ref like 'website:%:revision:%';
