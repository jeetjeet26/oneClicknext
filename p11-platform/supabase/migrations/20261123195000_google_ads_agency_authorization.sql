-- One Google Ads app and delegated manager grant per P11 organization.
create table private.google_ads_agency_credentials (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  app_secret_id uuid not null,
  refresh_secret_id uuid,
  authorized_at timestamptz,
  revision integer not null default 1
);

create table private.google_ads_oauth_requests (
  state_hash text primary key,
  org_id uuid not null references private.google_ads_agency_credentials(org_id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  revision integer not null,
  verifier text,
  expires_at timestamptz not null default clock_timestamp() + interval '10 minutes'
);

alter table private.google_ads_agency_credentials enable row level security;
alter table private.google_ads_oauth_requests enable row level security;
revoke all on private.google_ads_agency_credentials, private.google_ads_oauth_requests from public, anon, authenticated, service_role;

create function public.read_google_ads_agency_credentials(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('revision', c.revision, 'app', a.decrypted_secret::jsonb,
    'refreshToken', g.decrypted_secret, 'authorizedAt', c.authorized_at)
  from private.google_ads_agency_credentials c
  left join vault.decrypted_secrets a on a.id = c.app_secret_id
  left join vault.decrypted_secrets g on g.id = c.refresh_secret_id
  where c.org_id = p_org_id
$$;

create function public.read_google_ads_import_credentials(p_property_id uuid, p_account_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare property_org_id uuid;
begin
  select p.org_id into property_org_id from public.properties p
  where p.id = p_property_id and exists (
    select 1 from public.ad_account_connections c
    where c.property_id = p.id and (c.org_id is null or c.org_id = p.org_id)
      and c.platform = 'google_ads' and c.account_id = p_account_id and c.is_active
  );
  if not found then raise exception 'Google Ads account is no longer linked'; end if;
  return public.read_google_ads_agency_credentials(property_org_id);
end;
$$;

create function public.configure_google_ads_agency(p_org_id uuid, p_app jsonb, p_revision integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_config private.google_ads_agency_credentials;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('google-ads:' || p_org_id::text, 0));
  select * into current_config from private.google_ads_agency_credentials where org_id = p_org_id for update;
  if found then
    if p_revision is distinct from current_config.revision or current_config.refresh_secret_id is not null then return false; end if;
    perform vault.update_secret(current_config.app_secret_id, p_app::text);
    update private.google_ads_agency_credentials set revision = revision + 1 where org_id = p_org_id;
  else
    if p_revision is distinct from 0 then return false; end if;
    insert into private.google_ads_agency_credentials (org_id, app_secret_id)
    values (p_org_id, vault.create_secret(p_app::text));
  end if;
  return true;
end;
$$;

create function public.begin_google_ads_oauth(p_org_id uuid, p_actor_id uuid, p_state_hash text, p_verifier text, p_revision integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from private.google_ads_agency_credentials c where c.org_id = p_org_id and c.revision = p_revision)
    or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.org_id = p_org_id and p.role = 'admin')
    then return false; end if;
  delete from private.google_ads_oauth_requests where org_id = p_org_id and expires_at < clock_timestamp();
  insert into private.google_ads_oauth_requests (state_hash, org_id, actor_id, revision, verifier)
  values (p_state_hash, p_org_id, p_actor_id, p_revision, p_verifier);
  return true;
end;
$$;

create function public.claim_google_ads_oauth(p_org_id uuid, p_actor_id uuid, p_state_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare request_row private.google_ads_oauth_requests;
begin
  select * into request_row from private.google_ads_oauth_requests
  where state_hash = p_state_hash and org_id = p_org_id and actor_id = p_actor_id
    and expires_at > clock_timestamp() and verifier is not null for update;
  if not found then return null; end if;
  update private.google_ads_oauth_requests set verifier = null where state_hash = p_state_hash;
  return jsonb_build_object('revision', request_row.revision, 'verifier', request_row.verifier);
end;
$$;

create function public.finish_google_ads_oauth(p_org_id uuid, p_actor_id uuid, p_revision integer, p_state_hash text,
  p_refresh_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare current_config private.google_ads_agency_credentials;
begin
  select * into current_config from private.google_ads_agency_credentials where org_id = p_org_id for update;
  if not found or current_config.revision is distinct from p_revision
    or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.org_id = p_org_id and p.role = 'admin')
    or not exists (select 1 from private.google_ads_oauth_requests r where r.state_hash = p_state_hash
      and r.verifier is null and r.org_id = p_org_id and r.actor_id = p_actor_id and r.revision = p_revision
      and r.expires_at > clock_timestamp()) then return false; end if;
  if current_config.refresh_secret_id is null then
    current_config.refresh_secret_id := vault.create_secret(p_refresh_token);
  else
    perform vault.update_secret(current_config.refresh_secret_id, p_refresh_token);
  end if;
  update private.google_ads_agency_credentials set refresh_secret_id = current_config.refresh_secret_id,
    authorized_at = clock_timestamp(), revision = revision + 1 where org_id = p_org_id;
  delete from private.google_ads_oauth_requests where state_hash = p_state_hash;
  return true;
end;
$$;

-- The provider check is performed by the server. Lock the normalized account so two
-- requests cannot route the same advertiser to different communities concurrently.
create function public.link_google_ads_agency_account(p_org_id uuid, p_actor_id uuid, p_property_id uuid,
  p_revision integer, p_account_id text, p_account_name text, p_manager_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare connection public.ad_account_connections;
begin
  if p_account_id is null or p_account_id !~ '^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
    or p_manager_id is null or p_manager_id !~ '^[0-9]{3}-[0-9]{3}-[0-9]{4}$'
    or not exists (select 1 from public.profiles p where p.id = p_actor_id and p.org_id = p_org_id and p.role = 'admin')
    or not exists (select 1 from public.properties p where p.id = p_property_id and p.org_id = p_org_id) then
    raise exception 'Google Ads link is invalid' using errcode = '22023';
  end if;
  perform 1 from private.google_ads_agency_credentials c
  where c.org_id = p_org_id and c.revision = p_revision and c.refresh_secret_id is not null for update;
  if not found then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('google-ads-advertiser:' || p_account_id, 0));
  if exists (
    select 1 from public.ad_account_connections c where c.platform = 'google_ads'
      and replace(c.account_id, '-', '') = replace(p_account_id, '-', '')
  ) then raise exception 'Google Ads advertiser is already linked' using errcode = '23505'; end if;

  insert into public.ad_account_connections
    (org_id, property_id, platform, account_id, account_name, manager_account_id, is_active, connected_by)
  values (p_org_id, p_property_id, 'google_ads', p_account_id, p_account_name, p_manager_id, true, p_actor_id)
  returning * into connection;
  return jsonb_build_object(
    'id', connection.id, 'property_id', connection.property_id, 'platform', connection.platform,
    'account_id', connection.account_id, 'account_name', connection.account_name,
    'manager_account_id', connection.manager_account_id, 'is_active', connection.is_active,
    'connected_by', connection.connected_by, 'connected_at', connection.connected_at,
    'created_at', connection.created_at, 'updated_at', connection.updated_at,
    'last_sync_at', connection.last_sync_at, 'last_sync_status', connection.last_sync_status,
    'last_synced_at', connection.last_synced_at, 'last_imported_at', connection.last_imported_at,
    'error_count', connection.error_count, 'currency', connection.currency, 'account_timezone', connection.account_timezone
  );
end;
$$;

revoke all on function public.read_google_ads_agency_credentials(uuid), public.read_google_ads_import_credentials(uuid, text),
  public.configure_google_ads_agency(uuid, jsonb, integer), public.begin_google_ads_oauth(uuid, uuid, text, text, integer),
  public.claim_google_ads_oauth(uuid, uuid, text), public.finish_google_ads_oauth(uuid, uuid, integer, text, text),
  public.link_google_ads_agency_account(uuid, uuid, uuid, integer, text, text, text)
  from public, anon, authenticated;
grant execute on function public.read_google_ads_agency_credentials(uuid), public.read_google_ads_import_credentials(uuid, text),
  public.configure_google_ads_agency(uuid, jsonb, integer), public.begin_google_ads_oauth(uuid, uuid, text, text, integer),
  public.claim_google_ads_oauth(uuid, uuid, text), public.finish_google_ads_oauth(uuid, uuid, integer, text, text),
  public.link_google_ads_agency_account(uuid, uuid, uuid, integer, text, text, text) to service_role;
