-- Local qualification: versioned credentials, one bounded refresh owner, atomic token/audit saves.
alter table public.email_configurations add column credential_version bigint not null default 1;
alter table public.email_token_refreshes add column request_id uuid;
alter table public.email_token_refreshes add column credential_version bigint;
alter table public.email_token_refreshes add column completed_version bigint;
alter table public.email_token_refreshes add column lease_until timestamptz;
alter table public.email_token_refreshes add column finished_at timestamptz;
alter table public.email_token_refreshes add column result_hash text;
create unique index email_refresh_request_idx on public.email_token_refreshes(request_id) where request_id is not null;
create index email_refresh_running_idx on public.email_token_refreshes(email_configuration_id,credential_version) where refresh_status='running';
-- All production consumers use authenticated server routes; credentials are never browser-readable.
revoke all on public.email_configurations from public,anon,authenticated;
revoke all on public.email_token_refreshes from public,anon,authenticated;

create function public.version_email_credentials() returns trigger language plpgsql set search_path='' as $$begin
 if (new.provider,new.account_email,new.google_email,new.provider_subject,new.tenant_id,new.access_token,new.refresh_token,new.token_expires_at,new.sync_enabled)
  is distinct from (old.provider,old.account_email,old.google_email,old.provider_subject,old.tenant_id,old.access_token,old.refresh_token,old.token_expires_at,old.sync_enabled)
 then new.credential_version:=old.credential_version+1;else new.credential_version:=old.credential_version;end if;
 return new;
end; $$;
create trigger version_email_credentials before update on public.email_configurations for each row execute function public.version_email_credentials();

create function public.email_credential_identity(c public.email_configurations) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('provider',coalesce(c.provider,'google'),'accountEmail',coalesce(c.account_email,c.google_email),
  'subject',c.provider_subject,'tenant',c.tenant_id);
$$;
create function public.email_credential_result(c public.email_configurations,p_state text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('state',p_state,'accessToken',c.access_token,'refreshToken',c.refresh_token,'expiresAt',c.token_expires_at,'version',c.credential_version);
$$;
create function public.claim_email_token_refresh(p_property_id uuid,p_email_id uuid,p_version bigint,p_identity jsonb,p_request_id uuid,p_force boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.email_configurations;a public.email_token_refreshes;
begin
 if p_request_id is null or p_version is null or p_version<1 or jsonb_typeof(p_identity) is distinct from 'object' then raise exception 'Invalid refresh request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.email_configurations where id=p_email_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if public.email_credential_identity(c)<>p_identity then return '{"state":"connection_changed"}';end if;
 if not coalesce(c.sync_enabled,false) or nullif(c.access_token,'') is null or nullif(c.refresh_token,'') is null or c.token_status in ('disconnected','revoked','refresh_unconfirmed') then return '{"state":"reconnect_required"}';end if;
 select * into a from public.email_token_refreshes where request_id=p_request_id;
 if found then
  if a.email_configuration_id<>c.id or a.credential_version<>p_version then return '{"state":"request_conflict"}';end if;
  if a.refresh_status='success' and a.completed_version=c.credential_version and c.token_status='healthy' then return public.email_credential_result(c,'ready');end if;
  -- A repeated claim never authorizes a second provider request.
  if a.refresh_status='running' and a.lease_until<=clock_timestamp() then
   update public.email_token_refreshes set refresh_status='review',error_message='refresh_unconfirmed',finished_at=clock_timestamp() where id=a.id;
   if c.credential_version=a.credential_version then update public.email_configurations set token_status='refresh_unconfirmed',health_check_error='Email refresh was interrupted. Reconnect to restore access.',last_health_check_at=clock_timestamp() where id=c.id;end if;
  end if;
  return jsonb_build_object('state',case when a.refresh_status='running' and a.lease_until>clock_timestamp() then 'busy' else 'refresh_unconfirmed' end);
 end if;
 if c.credential_version<>p_version then
  if c.token_status='healthy' and c.token_expires_at>clock_timestamp()+interval '30 seconds' then return public.email_credential_result(c,'ready');end if;
  return '{"state":"connection_changed"}';
 end if;
 select * into a from public.email_token_refreshes where email_configuration_id=c.id and credential_version=c.credential_version and refresh_status='running' order by created_at desc limit 1 for update;
 if found then
  if a.lease_until>clock_timestamp() then return '{"state":"busy"}';end if;
  update public.email_token_refreshes set refresh_status='review',error_message='refresh_unconfirmed',finished_at=clock_timestamp() where id=a.id;
  update public.email_configurations set token_status='refresh_unconfirmed',health_check_error='Email refresh was interrupted. Reconnect to restore access.',last_health_check_at=clock_timestamp() where id=c.id;
  return '{"state":"refresh_unconfirmed"}';
 end if;
 if not p_force and c.token_status='healthy' and c.token_expires_at>clock_timestamp()+interval '5 minutes' then return public.email_credential_result(c,'ready');end if;
 if exists(select 1 from public.email_token_refreshes where email_configuration_id=c.id and credential_version=c.credential_version and refresh_status='failed' and finished_at>clock_timestamp()-interval '30 seconds') then return '{"state":"retry_later"}';end if;
 insert into public.email_token_refreshes(email_configuration_id,request_id,credential_version,refresh_status,old_expires_at,lease_until)
 values(c.id,p_request_id,c.credential_version,'running',c.token_expires_at,clock_timestamp()+interval '60 seconds');
 return public.email_credential_result(c,'claimed');
end; $$;

create function public.finish_email_token_refresh(p_property_id uuid,p_email_id uuid,p_request_id uuid,p_outcome text,p_tokens jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.email_configurations;a public.email_token_refreshes;fingerprint text;expiry timestamptz;new_refresh text;
begin
 if p_outcome is null or p_outcome not in ('success','revoked','temporary_failure','unconfirmed') then raise exception 'Invalid refresh result';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('outcome',p_outcome,'tokens',p_tokens)::text,'UTF8')),'hex');
 if p_outcome='success' then
  if jsonb_typeof(p_tokens) is distinct from 'object' or p_tokens-array['accessToken','refreshToken','expiresAt']<>'{}'
   or jsonb_typeof(p_tokens->'accessToken') is distinct from 'string' or length(p_tokens->>'accessToken') not between 1 and 16384 or p_tokens->>'accessToken' ~ '[[:space:]]'
   or jsonb_typeof(p_tokens->'expiresAt') is distinct from 'string' then raise exception 'Invalid refreshed credentials';end if;
  expiry:=(p_tokens->>'expiresAt')::timestamptz;
  if not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '366 days' then raise exception 'Invalid refreshed expiry';end if;
  if p_tokens ? 'refreshToken' and p_tokens->'refreshToken'<>'null' and (jsonb_typeof(p_tokens->'refreshToken') is distinct from 'string' or length(p_tokens->>'refreshToken') not between 1 and 16384 or p_tokens->>'refreshToken' ~ '[[:space:]]') then raise exception 'Invalid rotated token';end if;
 elsif p_tokens is not null then raise exception 'Unexpected failed credentials';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.email_configurations where id=p_email_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into a from public.email_token_refreshes where request_id=p_request_id and email_configuration_id=c.id for update;
 if not found then return '{"state":"not_found"}';end if;
 if a.result_hash is not null then
  if a.result_hash<>fingerprint then return '{"state":"request_conflict"}';end if;
  if a.refresh_status='success' and a.completed_version=c.credential_version and c.sync_enabled and c.token_status='healthy' then return public.email_credential_result(c,'saved');end if;
  return jsonb_build_object('state',case when a.refresh_status='success' then 'connection_changed' else a.refresh_status end);
 end if;
 if a.refresh_status not in ('running','review') then return '{"state":"connection_changed"}';end if;
 if c.credential_version<>a.credential_version or not coalesce(c.sync_enabled,false) then
  update public.email_token_refreshes set refresh_status='superseded',error_message='connection_changed',finished_at=clock_timestamp(),result_hash=fingerprint where id=a.id;
  return '{"state":"connection_changed"}';
 end if;
 if p_outcome='success' then
  new_refresh:=coalesce(p_tokens->>'refreshToken',c.refresh_token);
  update public.email_configurations set access_token=p_tokens->>'accessToken',refresh_token=new_refresh,token_expires_at=expiry,token_status='healthy',
   last_health_check_at=clock_timestamp(),health_check_error=null,updated_at=clock_timestamp() where id=c.id returning * into c;
  update public.email_token_refreshes set refresh_status='success',new_expires_at=expiry,completed_version=c.credential_version,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
  return public.email_credential_result(c,'saved');
 end if;
 update public.email_token_refreshes set refresh_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'review' else 'failed' end,
  error_message=p_outcome,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
 update public.email_configurations set token_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'refresh_unconfirmed' else token_status end,
  health_check_error=case p_outcome when 'revoked' then 'Email authorization expired or was revoked. Reconnect to restore access.' when 'unconfirmed' then 'Email refresh could not be confirmed. Reconnect to restore access.' else 'Email provider is unavailable. Try again later.' end,
  last_health_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('state',case p_outcome when 'unconfirmed' then 'review' when 'temporary_failure' then 'failed' else p_outcome end);
end; $$;
revoke all on function public.version_email_credentials(),public.email_credential_identity(public.email_configurations),public.email_credential_result(public.email_configurations,text),public.claim_email_token_refresh(uuid,uuid,bigint,jsonb,uuid,boolean),public.finish_email_token_refresh(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.version_email_credentials(),public.email_credential_identity(public.email_configurations),public.email_credential_result(public.email_configurations,text),public.claim_email_token_refresh(uuid,uuid,bigint,jsonb,uuid,boolean),public.finish_email_token_refresh(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';

create or replace function public.disconnect_recorded_email(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_provider text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.shared_action_events;r jsonb;input jsonb;before_state jsonb;after_state jsonb;recorded jsonb;changed integer;
begin
 if p_request_id is null or p_actor_id is null or (p_provider is not null and p_provider not in ('google','microsoft')) then raise exception 'Invalid email disconnection';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('requestId',p_request_id,'provider',p_provider);
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'email.disconnected',input) then return '{"state":"request_conflict"}';end if;
  return e.result||jsonb_build_object('state','replayed','actionEventId',e.id);
 end if;
 perform 1 from public.email_configurations where property_id=p_property_id and (p_provider is null or provider=p_provider) order by id for update;
 select jsonb_build_object('state','before_disconnection','connections',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into before_state from public.email_configurations where property_id=p_property_id and (p_provider is null or provider=p_provider);
 update public.email_configurations set access_token=null,refresh_token=null,token_expires_at=null,sync_enabled=false,auto_reply_enabled=false,token_status='disconnected',health_check_error='Disconnected by operator',history_id=null,watch_expiration=null,updated_at=clock_timestamp()
 where property_id=p_property_id and (p_provider is null or provider=p_provider) and (access_token is not null or refresh_token is not null or sync_enabled is distinct from false or token_status is distinct from 'disconnected');
 get diagnostics changed=row_count;
 update public.email_token_refreshes a set refresh_status='superseded',error_message='operator_disconnected',finished_at=clock_timestamp(),lease_until=null from public.email_configurations c where c.id=a.email_configuration_id and c.property_id=p_property_id and (p_provider is null or c.provider=p_provider) and a.refresh_status in ('running','review');
 update public.lumaleasing_config set email_enabled=false,email_configuration_id=null,updated_at=clock_timestamp() where property_id=p_property_id and email_configuration_id in(select id from public.email_configurations where property_id=p_property_id and (p_provider is null or provider=p_provider));
 update public.integration_authorizations set status='blocked',result='{"state":"connection_changed"}' where property_id=p_property_id and status in ('pending','exchanging') and context->'capabilities' ? 'email' and (p_provider is null or context->>'provider'=p_provider);
 select jsonb_build_object('state','disconnected','connections',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into after_state from public.email_configurations where property_id=p_property_id and (p_provider is null or provider=p_provider);
 r:=jsonb_build_object('state','applied','disconnected',changed);
 recorded:=public.append_shared_action_event(p_request_id,md5('email-disconnect/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'integrations','email.disconnected','server_confirmed','succeeded',input,before_state,after_state,r);
 if recorded->>'state' not in ('recorded','replayed') then raise exception 'Email disconnection could not be recorded';end if;
 return r||jsonb_build_object('actionEventId',p_request_id);
end; $$;
revoke all on function public.disconnect_recorded_email(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.disconnect_recorded_email(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';

create or replace function public.integration_connection_snapshot(p_property_id uuid,p_capabilities text[]) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
 'calendar',case when 'calendar'=any(p_capabilities) then (select coalesce(jsonb_agg(jsonb_build_array(id,credential_version,provider,provider_subject,account_email,tenant_id,calendar_id,sync_enabled,token_status) order by id),'[]') from public.agent_calendars where property_id=p_property_id) else '[]' end,
 'email',case when 'email'=any(p_capabilities) then (select coalesce(jsonb_agg(jsonb_build_array(id,credential_version,provider,provider_subject,account_email,tenant_id,sync_enabled,token_status,access_token,refresh_token,token_expires_at) order by id),'[]') from public.email_configurations where property_id=p_property_id) else '[]' end,
 'widget',case when 'email'=any(p_capabilities) then (select jsonb_build_array(id,email_enabled,email_configuration_id) from public.lumaleasing_config where property_id=p_property_id) else '[]' end)::text,'UTF8')),'hex');
$$;

notify pgrst,'reload schema';
