-- Reconcile columns already consumed by trusted foundation services but absent
-- from the reproducible migration chain.

alter table public.properties
  add column if not exists updated_at timestamptz default timezone('utc', now());

alter table public.forgestudio_config
  add column if not exists include_hashtags boolean not null default true,
  add column if not exists include_cta boolean not null default true,
  add column if not exists max_caption_length integer not null default 2200
    check (max_caption_length between 1 and 10000);

alter table public.content_assets
  add column if not exists width integer check (width is null or width > 0),
  add column if not exists height integer check (height is null or height > 0),
  add column if not exists duration_seconds numeric
    check (duration_seconds is null or duration_seconds >= 0);

alter table public.social_connections
  add column if not exists refresh_token text;

drop trigger if exists properties_schema_truth_updated_at on public.properties;
create trigger properties_schema_truth_updated_at
  before update on public.properties
  for each row execute function public.set_schema_truth_updated_at();

comment on column public.social_connections.refresh_token is
  'Encrypted provider refresh token; never exposed through authenticated grants.';

revoke select (refresh_token) on public.social_connections from anon;
revoke select (refresh_token) on public.social_connections from authenticated;
