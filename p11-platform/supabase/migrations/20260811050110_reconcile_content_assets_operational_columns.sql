-- Reconcile operational columns already present in the hosted schema and
-- consumed by asset ingestion, curation, and BrandForge routes so clean local
-- resets reproduce the same content_assets contract.

alter table public.content_assets
  add column if not exists source_asset_id uuid
    references public.content_assets(id) on delete set null,
  add column if not exists usage_count integer not null default 0
    check (usage_count >= 0),
  add column if not exists last_used_at timestamptz,
  add column if not exists uploaded_by uuid
    references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz
    not null default timezone('utc', now());

update public.content_assets
set updated_at = coalesce(updated_at, created_at, timezone('utc', now()))
where updated_at is null;

create index if not exists content_assets_source_asset_idx
  on public.content_assets (source_asset_id)
  where source_asset_id is not null;

create index if not exists content_assets_last_used_idx
  on public.content_assets (property_id, last_used_at desc)
  where last_used_at is not null;

drop trigger if exists content_assets_set_updated_at on public.content_assets;
create trigger content_assets_set_updated_at
  before update on public.content_assets
  for each row execute function public.update_updated_at_column();
