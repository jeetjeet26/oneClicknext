-- Remove direct authenticated mutation paths. SiteForge routes authorize the
-- tenant first and then use the service role for these writes.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'authenticated']::name[]
      and (
        coalesce(qual, '') ilike '%property-assets%'
        or coalesce(with_check, '') ilike '%property-assets%'
      )
  loop
    execute format(
      'drop policy %I on storage.objects',
      policy_record.policyname
    );
  end loop;

  for policy_record in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'siteforge_asset_sources',
        'siteforge_report_subscriptions'
      )
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'authenticated']::name[]
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end
$$;

-- A table-level SELECT grant also grants every column, so remove it before
-- restoring column-level reads that deliberately omit credential_ref.
do $$
declare
  target_table text;
  readable_columns text;
begin
  foreach target_table in array array[
    'siteforge_asset_sources',
    'siteforge_connector_configs'
  ]
  loop
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
    into readable_columns
    from information_schema.columns
    where table_schema = 'public'
      and table_name = target_table
      and column_name <> 'credential_ref';

    execute format(
      'revoke select on table public.%I from anon, authenticated',
      target_table
    );
    execute format(
      'revoke select (%I) on table public.%I from anon, authenticated',
      'credential_ref',
      target_table
    );
    execute format(
      'grant select (%s) on table public.%I to anon, authenticated',
      readable_columns,
      target_table
    );
  end loop;
end
$$;

-- Hosted schemas may already have these columns from operational changes. The
-- earlier reconciliation migration uses ADD COLUMN IF NOT EXISTS, so explicitly
-- converge pre-existing nullable columns with clean-reset behavior.
update public.content_assets
set usage_count = 0
where usage_count is null;

update public.content_assets
set updated_at = coalesce(created_at, timezone('utc', now()))
where updated_at is null;

alter table public.content_assets
  alter column usage_count set default 0,
  alter column usage_count set not null,
  alter column updated_at set default timezone('utc', now()),
  alter column updated_at set not null;

-- Composite identities support foreign keys that bind every nested row to the
-- same organization/property/website as its parent.
create unique index if not exists properties_tenant_identity_idx
  on public.properties (id, org_id);
create unique index if not exists siteforge_brief_versions_tenant_identity_idx
  on public.siteforge_brief_versions (id, org_id, property_id, website_id);
create unique index if not exists siteforge_direction_sets_tenant_identity_idx
  on public.siteforge_creative_direction_sets (id, org_id, property_id, website_id);
create unique index if not exists siteforge_directions_parent_identity_idx
  on public.siteforge_creative_directions (
    id,
    direction_set_id,
    org_id,
    property_id,
    website_id
  );
create unique index if not exists siteforge_asset_sources_tenant_identity_idx
  on public.siteforge_asset_sources (id, org_id, property_id);
create unique index if not exists siteforge_review_sessions_tenant_identity_idx
  on public.siteforge_review_sessions (id, org_id, property_id, website_id);
create unique index if not exists siteforge_revision_rounds_parent_identity_idx
  on public.siteforge_revision_rounds (
    id,
    review_session_id,
    org_id,
    property_id,
    website_id
  );
create unique index if not exists siteforge_review_comments_parent_identity_idx
  on public.siteforge_review_comments (
    id,
    review_session_id,
    org_id,
    property_id,
    website_id
  );
create unique index if not exists siteforge_review_tokens_parent_identity_idx
  on public.siteforge_review_tokens (
    id,
    review_session_id,
    org_id,
    property_id,
    website_id
  );
create unique index if not exists siteforge_launch_releases_tenant_identity_idx
  on public.siteforge_launch_releases (id, org_id, property_id, website_id);

alter table public.siteforge_creative_direction_sets
  add constraint siteforge_direction_set_brief_tenant_fkey
  foreign key (brief_version_id, org_id, property_id, website_id)
  references public.siteforge_brief_versions (id, org_id, property_id, website_id)
  on delete restrict;

alter table public.siteforge_creative_directions
  add constraint siteforge_direction_parent_tenant_fkey
  foreign key (direction_set_id, org_id, property_id, website_id)
  references public.siteforge_creative_direction_sets (
    id,
    org_id,
    property_id,
    website_id
  )
  on delete cascade;

alter table public.siteforge_creative_direction_sets
  add constraint siteforge_selected_direction_parent_fkey
  foreign key (selected_direction_id, id, org_id, property_id, website_id)
  references public.siteforge_creative_directions (
    id,
    direction_set_id,
    org_id,
    property_id,
    website_id
  )
  on delete restrict;

alter table public.siteforge_asset_sources
  add constraint siteforge_asset_sources_property_tenant_fkey
  foreign key (property_id, org_id)
  references public.properties (id, org_id)
  on delete cascade,
  add constraint siteforge_asset_sources_website_tenant_fkey
  foreign key (website_id, org_id, property_id)
  references public.property_websites (id, org_id, property_id)
  on delete cascade;

alter table public.siteforge_asset_ingest_runs
  add constraint siteforge_asset_ingest_source_tenant_fkey
  foreign key (source_id, org_id, property_id)
  references public.siteforge_asset_sources (id, org_id, property_id)
  on delete cascade,
  add constraint siteforge_asset_ingest_website_tenant_fkey
  foreign key (website_id, org_id, property_id)
  references public.property_websites (id, org_id, property_id)
  on delete cascade;

alter table public.siteforge_revision_rounds
  add constraint siteforge_revision_round_session_tenant_fkey
  foreign key (review_session_id, org_id, property_id, website_id)
  references public.siteforge_review_sessions (id, org_id, property_id, website_id)
  on delete cascade;

alter table public.siteforge_review_comments
  add constraint siteforge_review_comment_session_tenant_fkey
  foreign key (review_session_id, org_id, property_id, website_id)
  references public.siteforge_review_sessions (id, org_id, property_id, website_id)
  on delete cascade,
  add constraint siteforge_review_comment_round_tenant_fkey
  foreign key (
    revision_round_id,
    review_session_id,
    org_id,
    property_id,
    website_id
  )
  references public.siteforge_revision_rounds (
    id,
    review_session_id,
    org_id,
    property_id,
    website_id
  )
  on delete set null (revision_round_id),
  add constraint siteforge_review_comment_parent_tenant_fkey
  foreign key (
    parent_comment_id,
    review_session_id,
    org_id,
    property_id,
    website_id
  )
  references public.siteforge_review_comments (
    id,
    review_session_id,
    org_id,
    property_id,
    website_id
  )
  on delete cascade;

alter table public.siteforge_review_tokens
  add constraint siteforge_review_token_session_tenant_fkey
  foreign key (review_session_id, org_id, property_id, website_id)
  references public.siteforge_review_sessions (id, org_id, property_id, website_id)
  on delete cascade;

alter table public.siteforge_client_decisions
  add constraint siteforge_client_decision_session_tenant_fkey
  foreign key (review_session_id, org_id, property_id, website_id)
  references public.siteforge_review_sessions (id, org_id, property_id, website_id)
  on delete cascade,
  add constraint siteforge_client_decision_token_tenant_fkey
  foreign key (
    review_token_id,
    review_session_id,
    org_id,
    property_id,
    website_id
  )
  references public.siteforge_review_tokens (
    id,
    review_session_id,
    org_id,
    property_id,
    website_id
  )
  on delete set null (review_token_id);

alter table public.siteforge_connector_configs
  add constraint siteforge_connector_configs_property_tenant_fkey
  foreign key (property_id, org_id)
  references public.properties (id, org_id)
  on delete cascade,
  add constraint siteforge_connector_configs_website_tenant_fkey
  foreign key (website_id, org_id, property_id)
  references public.property_websites (id, org_id, property_id)
  on delete cascade;

alter table public.siteforge_dns_snapshots
  add constraint siteforge_dns_snapshot_website_tenant_fkey
  foreign key (website_id, org_id, property_id)
  references public.property_websites (id, org_id, property_id)
  on delete cascade,
  add constraint siteforge_dns_snapshot_release_tenant_fkey
  foreign key (release_id, org_id, property_id, website_id)
  references public.siteforge_launch_releases (id, org_id, property_id, website_id)
  on delete set null (release_id);

alter table public.siteforge_report_subscriptions
  add constraint siteforge_report_subscription_website_tenant_fkey
  foreign key (website_id, org_id, property_id)
  references public.property_websites (id, org_id, property_id)
  on delete cascade;
