alter table public.property_websites
  drop constraint if exists property_websites_editor_lifecycle_status_check;

alter table public.property_websites
  add constraint property_websites_editor_lifecycle_status_check
  check (
    editor_lifecycle_status in (
      'editing',
      'preview_rendered',
      'preview_ready',
      'approved_for_staging',
      'deploying_staging',
      'staging_ready',
      'certifying_production',
      'production_live'
    )
  );
