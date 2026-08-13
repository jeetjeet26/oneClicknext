-- Bind every SiteForge website to a property in the same organization. The
-- referenced unique index was added by the preceding director hardening
-- migration.
alter table public.property_websites
  add constraint property_websites_property_tenant_fkey
  foreign key (property_id, org_id)
  references public.properties (id, org_id)
  on delete cascade
  not valid;

alter table public.property_websites
  validate constraint property_websites_property_tenant_fkey;

-- Public review quotas are server-only state. Keeping the counters outside the
-- exposed public schema prevents direct Data API access even if grants drift.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create unique index if not exists siteforge_review_tokens_rate_limit_identity_idx
  on public.siteforge_review_tokens (id, review_session_id);

create table private.siteforge_public_review_rate_limits (
  review_session_id uuid not null,
  review_token_id uuid not null,
  client_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null,
  constraint siteforge_public_review_rate_limits_pkey
    primary key (review_session_id, review_token_id, client_hash),
  constraint siteforge_public_review_rate_limits_token_session_fkey
    foreign key (review_token_id, review_session_id)
    references public.siteforge_review_tokens (id, review_session_id)
    on delete cascade,
  constraint siteforge_public_review_rate_limits_client_hash_check
    check (client_hash ~ '^[0-9a-f]{64}$'),
  constraint siteforge_public_review_rate_limits_request_count_check
    check (request_count between 1 and 121)
);

create index siteforge_public_review_rate_limits_token_idx
  on private.siteforge_public_review_rate_limits (
    review_token_id,
    review_session_id
  );

create index siteforge_public_review_rate_limits_window_idx
  on private.siteforge_public_review_rate_limits (window_started_at);

revoke all on table private.siteforge_public_review_rate_limits
  from public, anon, authenticated;
grant select, insert, update, delete
  on table private.siteforge_public_review_rate_limits
  to service_role;

-- The service-role-only function atomically increments or rolls the fixed
-- five-minute window. Counts are capped one above the quota to avoid unbounded
-- growth while preserving a durable denied state.
create or replace function public.consume_siteforge_public_review_rate_limit(
  p_review_session_id uuid,
  p_review_token_id uuid,
  p_client_hash text
)
returns table (
  allowed boolean,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'invalid public review client hash';
  end if;

  return query
  insert into private.siteforge_public_review_rate_limits (
    review_session_id,
    review_token_id,
    client_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_review_session_id,
    p_review_token_id,
    p_client_hash,
    v_now,
    1,
    v_now
  )
  on conflict (review_session_id, review_token_id, client_hash)
  do update set
    window_started_at = case
      when private.siteforge_public_review_rate_limits.window_started_at
        + interval '5 minutes' <= v_now
        then v_now
      else private.siteforge_public_review_rate_limits.window_started_at
    end,
    request_count = case
      when private.siteforge_public_review_rate_limits.window_started_at
        + interval '5 minutes' <= v_now
        then 1
      else least(
        private.siteforge_public_review_rate_limits.request_count + 1,
        121
      )
    end,
    updated_at = v_now
  returning
    private.siteforge_public_review_rate_limits.request_count <= 120,
    greatest(
      120 - private.siteforge_public_review_rate_limits.request_count,
      0
    ),
    private.siteforge_public_review_rate_limits.window_started_at
      + interval '5 minutes';
end;
$$;

revoke all on function public.consume_siteforge_public_review_rate_limit(
  uuid,
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.consume_siteforge_public_review_rate_limit(
  uuid,
  uuid,
  text
) to service_role;
