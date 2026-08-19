alter table public.social_content_briefs
  add column if not exists format_plan jsonb not null default '[]'::jsonb;

alter table public.social_content_variants
  add column if not exists variant_key text,
  add column if not exists sequence_index integer not null default 0,
  add column if not exists storyboard jsonb not null default '[]'::jsonb,
  add column if not exists overlay_text text[] not null default '{}'::text[],
  add column if not exists safe_area jsonb not null default '{}'::jsonb,
  add column if not exists subtitle_text text,
  add column if not exists thumbnail_asset_id uuid
    references public.content_assets(id) on delete set null;

update public.social_content_variants
set variant_key = platform || ':' || content_format || ':1'
where variant_key is null;

alter table public.social_content_variants
  alter column variant_key set not null;

alter table public.social_content_variants
  drop constraint if exists social_content_variants_revision_id_platform_key;

alter table public.social_content_variants
  add constraint social_content_variants_revision_variant_key_key
    unique (revision_id, variant_key);

create index if not exists social_content_variants_revision_platform_idx
  on public.social_content_variants(revision_id, platform, sequence_index);
