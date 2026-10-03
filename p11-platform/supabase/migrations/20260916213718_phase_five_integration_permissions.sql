-- Saved scope evidence is required for credential use, including unexpired tokens.
-- Missing scope on renewal inherits only an already verified grant (RFC 6749 §§5.1,6).
create function public.normalize_integration_scope(p_scope text) returns text
language plpgsql immutable set search_path='' as $$
declare decoded text:='';i integer:=1;code integer;
begin
 if p_scope is null or length(p_scope) not between 1 and 1024 then return null;end if;
 while i<=length(p_scope) loop
  if substr(p_scope,i,1)='%' then
   if substr(p_scope,i+1,2)!~'^[0-9a-fA-F]{2}$' then return null;end if;
   code:=get_byte(decode(substr(p_scope,i+1,2),'hex'),0);
   -- Registered Graph permissions and resource URI names are ASCII.
   if code<33 or code>126 then return null;end if;
   decoded:=decoded||chr(code);i:=i+3;
  else decoded:=decoded||substr(p_scope,i,1);i:=i+1;end if;
 end loop;
 if decoded ~ '[[:space:]]' then return null;end if;
 return regexp_replace(lower(decoded),'^https://graph\.microsoft\.com/','');
end; $$;
create function public.integration_permission_state(p_provider text,p_capability text,p_scopes text[],p_evidence text) returns text
language plpgsql immutable set search_path='' as $$
declare permissions text[];
begin
 if p_provider is null or p_provider not in ('google','microsoft') or p_capability is null or p_capability not in ('calendar','email')
  or p_evidence is null or not (p_evidence in ('provider_response','refresh_inherited') or (p_provider='microsoft' and p_evidence='microsoft_request_contract'))
  or coalesce(cardinality(p_scopes),0) not between 1 and 100
  or exists(select 1 from unnest(p_scopes) s where s is null or length(s) not between 1 and 1024 or s ~ '[[:space:]]') then return 'permissions_unconfirmed';end if;
 if p_provider='google' then
  if (p_capability='calendar' and 'https://www.googleapis.com/auth/calendar'=any(p_scopes))
   or (p_capability='email' and p_scopes && array['https://www.googleapis.com/auth/gmail.modify','https://mail.google.com/']) then return 'confirmed';end if;
 else
  select array_agg(public.normalize_integration_scope(s)) into permissions from unnest(p_scopes) s;
  if array_position(permissions,null) is not null then return 'permissions_unconfirmed';end if;
  if 'user.read'=any(permissions) and ((p_capability='calendar' and 'calendars.readwrite'=any(permissions))
   or (p_capability='email' and 'mail.send'=any(permissions) and permissions && array['mail.read','mail.readwrite'])) then return 'confirmed';end if;
 end if;
 return 'permissions_incomplete';
end; $$;

create or replace function public.version_calendar_credentials() returns trigger language plpgsql set search_path='' as $$begin
 if (new.provider,new.account_email,new.google_email,new.provider_subject,new.tenant_id,new.calendar_id,new.access_token,new.refresh_token,new.token_expires_at,new.sync_enabled,new.scopes,new.provider_metadata->>'scopeEvidence')
  is distinct from (old.provider,old.account_email,old.google_email,old.provider_subject,old.tenant_id,old.calendar_id,old.access_token,old.refresh_token,old.token_expires_at,old.sync_enabled,old.scopes,old.provider_metadata->>'scopeEvidence')
 then new.credential_version:=old.credential_version+1;else new.credential_version:=old.credential_version;end if;
 return new;
end; $$;

create or replace function public.calendar_credential_result(c public.agent_calendars,p_state text) returns jsonb language sql immutable set search_path='' as $$
 select case when public.integration_permission_state(coalesce(c.provider,'google'),'calendar',c.scopes,c.provider_metadata->>'scopeEvidence')<>'confirmed' then jsonb_build_object('state',public.integration_permission_state(coalesce(c.provider,'google'),'calendar',c.scopes,c.provider_metadata->>'scopeEvidence')) else jsonb_build_object('state',p_state,'accessToken',c.access_token,'refreshToken',c.refresh_token,'expiresAt',c.token_expires_at,'version',c.credential_version,'permissionState','confirmed') end;
$$;

create or replace function public.claim_calendar_token_refresh(p_property_id uuid,p_calendar_id uuid,p_version bigint,p_identity jsonb,p_request_id uuid,p_force boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.agent_calendars;a public.calendar_token_refreshes;
begin
 if p_request_id is null or p_version is null or p_version<1 or jsonb_typeof(p_identity) is distinct from 'object' then raise exception 'Invalid refresh request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.agent_calendars where id=p_calendar_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if public.calendar_credential_identity(c)<>p_identity then return '{"state":"connection_changed"}';end if;
 if not coalesce(c.sync_enabled,false) or nullif(c.access_token,'') is null or nullif(c.refresh_token,'') is null or c.token_status in ('disconnected','revoked','refresh_unconfirmed') then return '{"state":"reconnect_required"}';end if;
 if public.integration_permission_state(coalesce(c.provider,'google'),'calendar',c.scopes,c.provider_metadata->>'scopeEvidence')<>'confirmed' then return jsonb_build_object('state',public.integration_permission_state(coalesce(c.provider,'google'),'calendar',c.scopes,c.provider_metadata->>'scopeEvidence'));end if;
 select * into a from public.calendar_token_refreshes where request_id=p_request_id;
 if found then
  if a.agent_calendar_id<>c.id or a.credential_version<>p_version then return '{"state":"request_conflict"}';end if;
  if a.refresh_status='success' and a.completed_version=c.credential_version then return public.calendar_credential_result(c,'ready');end if;
  -- A repeated claim never authorizes a second provider request.
  if a.refresh_status='running' and a.lease_until<=clock_timestamp() then
   update public.calendar_token_refreshes set refresh_status='review',error_message='refresh_unconfirmed',finished_at=clock_timestamp() where id=a.id;
   if c.credential_version=a.credential_version then update public.agent_calendars set token_status='refresh_unconfirmed',health_check_error='Calendar refresh was interrupted. Reconnect to restore access.',last_health_check_at=clock_timestamp() where id=c.id;end if;
  end if;
  return jsonb_build_object('state',case when a.refresh_status='running' and a.lease_until>clock_timestamp() then 'busy' else 'refresh_unconfirmed' end);
 end if;
 if c.credential_version<>p_version then
  if c.token_status='healthy' and c.token_expires_at>clock_timestamp()+interval '30 seconds' then return public.calendar_credential_result(c,'ready');end if;
  return '{"state":"connection_changed"}';
 end if;
 select * into a from public.calendar_token_refreshes where agent_calendar_id=c.id and credential_version=c.credential_version and refresh_status='running' order by created_at desc limit 1 for update;
 if found then
  if a.lease_until>clock_timestamp() then return '{"state":"busy"}';end if;
  update public.calendar_token_refreshes set refresh_status='review',error_message='refresh_unconfirmed',finished_at=clock_timestamp() where id=a.id;
  update public.agent_calendars set token_status='refresh_unconfirmed',health_check_error='Calendar refresh was interrupted. Reconnect to restore access.',last_health_check_at=clock_timestamp() where id=c.id;
  return '{"state":"refresh_unconfirmed"}';
 end if;
 if not p_force and c.token_status='healthy' and c.token_expires_at>clock_timestamp()+interval '5 minutes' then return public.calendar_credential_result(c,'ready');end if;
 if exists(select 1 from public.calendar_token_refreshes where agent_calendar_id=c.id and credential_version=c.credential_version and refresh_status='failed' and finished_at>clock_timestamp()-interval '30 seconds') then return '{"state":"retry_later"}';end if;
 insert into public.calendar_token_refreshes(agent_calendar_id,request_id,credential_version,refresh_status,old_expires_at,lease_until)
 values(c.id,p_request_id,c.credential_version,'running',c.token_expires_at,clock_timestamp()+interval '60 seconds');
 return public.calendar_credential_result(c,'claimed');
end; $$;

create or replace function public.finish_calendar_token_refresh(p_property_id uuid,p_calendar_id uuid,p_request_id uuid,p_outcome text,p_tokens jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.agent_calendars;a public.calendar_token_refreshes;fingerprint text;expiry timestamptz;new_refresh text;renewed_scopes text[];scope_evidence text;permission text;
begin
 if p_outcome is null or p_outcome not in ('success','revoked','temporary_failure','unconfirmed') then raise exception 'Invalid refresh result';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('outcome',p_outcome,'tokens',p_tokens)::text,'UTF8')),'hex');
 if p_outcome='success' then
  if jsonb_typeof(p_tokens) is distinct from 'object' or p_tokens-array['accessToken','refreshToken','expiresAt','scope']<>'{}'
   or jsonb_typeof(p_tokens->'accessToken') is distinct from 'string' or length(p_tokens->>'accessToken') not between 1 and 16384 or p_tokens->>'accessToken' ~ '[[:space:]]'
   or jsonb_typeof(p_tokens->'expiresAt') is distinct from 'string' then raise exception 'Invalid refreshed credentials';end if;
  expiry:=(p_tokens->>'expiresAt')::timestamptz;
  if not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '366 days' then raise exception 'Invalid refreshed expiry';end if;
  if p_tokens ? 'refreshToken' and p_tokens->'refreshToken'<>'null' and (jsonb_typeof(p_tokens->'refreshToken') is distinct from 'string' or length(p_tokens->>'refreshToken') not between 1 and 16384 or p_tokens->>'refreshToken' ~ '[[:space:]]') then raise exception 'Invalid rotated token';end if;
 elsif p_tokens is not null then raise exception 'Unexpected failed credentials';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.agent_calendars where id=p_calendar_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into a from public.calendar_token_refreshes where request_id=p_request_id and agent_calendar_id=c.id for update;
 if not found then return '{"state":"not_found"}';end if;
 if a.result_hash is not null then
  if a.result_hash<>fingerprint then return '{"state":"request_conflict"}';end if;
  if a.refresh_status='success' and a.completed_version=c.credential_version and c.sync_enabled then return public.calendar_credential_result(c,'saved');end if;
  return jsonb_build_object('state',case when a.refresh_status='success' then 'connection_changed' else a.refresh_status end);
 end if;
 if a.refresh_status not in ('running','review') then return '{"state":"connection_changed"}';end if;
 if c.credential_version<>a.credential_version or not coalesce(c.sync_enabled,false) then
  update public.calendar_token_refreshes set refresh_status='superseded',error_message='connection_changed',finished_at=clock_timestamp(),result_hash=fingerprint where id=a.id;
  return '{"state":"connection_changed"}';
 end if;
 if p_outcome='success' then
  if p_tokens ? 'scope' then
   scope_evidence:='provider_response';
   if jsonb_typeof(p_tokens->'scope')='string' and length(p_tokens->>'scope') between 1 and 16384 and nullif(btrim(p_tokens->>'scope'),'') is not null then
    renewed_scopes:=regexp_split_to_array(btrim(p_tokens->>'scope'),'[[:space:]]+');
   else renewed_scopes:=array[]::text[];end if;
  elsif public.integration_permission_state(coalesce(c.provider,'google'),'calendar',c.scopes,c.provider_metadata->>'scopeEvidence')='confirmed' then
   renewed_scopes:=c.scopes;scope_evidence:='refresh_inherited';
  else renewed_scopes:=array[]::text[];scope_evidence:='unconfirmed';end if;
  permission:=public.integration_permission_state(coalesce(c.provider,'google'),'calendar',renewed_scopes,scope_evidence);
  new_refresh:=coalesce(p_tokens->>'refreshToken',c.refresh_token);
  update public.agent_calendars set access_token=p_tokens->>'accessToken',refresh_token=new_refresh,token_expires_at=expiry,scopes=renewed_scopes,provider_metadata=coalesce(provider_metadata,'{}')||jsonb_build_object('scopeEvidence',scope_evidence),token_status=case when permission='confirmed' then 'healthy' else permission end,
   last_health_check_at=clock_timestamp(),health_check_error=case when permission='confirmed' then null else 'Reconnect this account and grant the required permissions.' end,updated_at=clock_timestamp() where id=c.id returning * into c;
  update public.calendar_token_refreshes set refresh_status=case when permission='confirmed' then 'success' else permission end,new_expires_at=expiry,completed_version=c.credential_version,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
  if permission<>'confirmed' then return jsonb_build_object('state',permission);end if;
  return public.calendar_credential_result(c,'saved');
 end if;
 update public.calendar_token_refreshes set refresh_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'review' else 'failed' end,
  error_message=p_outcome,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
 update public.agent_calendars set token_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'refresh_unconfirmed' else token_status end,
  health_check_error=case p_outcome when 'revoked' then 'Calendar authorization expired or was revoked. Reconnect to restore access.' when 'unconfirmed' then 'Calendar refresh could not be confirmed. Reconnect to restore access.' else 'Calendar provider is unavailable. Try again later.' end,
  last_health_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('state',case p_outcome when 'unconfirmed' then 'review' when 'temporary_failure' then 'failed' else p_outcome end);
end; $$;

create or replace function public.version_email_credentials() returns trigger language plpgsql set search_path='' as $$begin
 if (new.provider,new.account_email,new.google_email,new.provider_subject,new.tenant_id,new.access_token,new.refresh_token,new.token_expires_at,new.sync_enabled,new.scopes,new.provider_metadata->>'scopeEvidence')
  is distinct from (old.provider,old.account_email,old.google_email,old.provider_subject,old.tenant_id,old.access_token,old.refresh_token,old.token_expires_at,old.sync_enabled,old.scopes,old.provider_metadata->>'scopeEvidence')
 then new.credential_version:=old.credential_version+1;else new.credential_version:=old.credential_version;end if;
 return new;
end; $$;

create or replace function public.email_credential_result(c public.email_configurations,p_state text) returns jsonb language sql immutable set search_path='' as $$
 select case when public.integration_permission_state(coalesce(c.provider,'google'),'email',c.scopes,c.provider_metadata->>'scopeEvidence')<>'confirmed' then jsonb_build_object('state',public.integration_permission_state(coalesce(c.provider,'google'),'email',c.scopes,c.provider_metadata->>'scopeEvidence')) else jsonb_build_object('state',p_state,'accessToken',c.access_token,'refreshToken',c.refresh_token,'expiresAt',c.token_expires_at,'version',c.credential_version,'permissionState','confirmed') end;
$$;

create or replace function public.claim_email_token_refresh(p_property_id uuid,p_email_id uuid,p_version bigint,p_identity jsonb,p_request_id uuid,p_force boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.email_configurations;a public.email_token_refreshes;
begin
 if p_request_id is null or p_version is null or p_version<1 or jsonb_typeof(p_identity) is distinct from 'object' then raise exception 'Invalid refresh request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.email_configurations where id=p_email_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if public.email_credential_identity(c)<>p_identity then return '{"state":"connection_changed"}';end if;
 if not coalesce(c.sync_enabled,false) or nullif(c.access_token,'') is null or nullif(c.refresh_token,'') is null or c.token_status in ('disconnected','revoked','refresh_unconfirmed') then return '{"state":"reconnect_required"}';end if;
 if public.integration_permission_state(coalesce(c.provider,'google'),'email',c.scopes,c.provider_metadata->>'scopeEvidence')<>'confirmed' then return jsonb_build_object('state',public.integration_permission_state(coalesce(c.provider,'google'),'email',c.scopes,c.provider_metadata->>'scopeEvidence'));end if;
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

create or replace function public.finish_email_token_refresh(p_property_id uuid,p_email_id uuid,p_request_id uuid,p_outcome text,p_tokens jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.email_configurations;a public.email_token_refreshes;fingerprint text;expiry timestamptz;new_refresh text;renewed_scopes text[];scope_evidence text;permission text;
begin
 if p_outcome is null or p_outcome not in ('success','revoked','temporary_failure','unconfirmed') then raise exception 'Invalid refresh result';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('outcome',p_outcome,'tokens',p_tokens)::text,'UTF8')),'hex');
 if p_outcome='success' then
  if jsonb_typeof(p_tokens) is distinct from 'object' or p_tokens-array['accessToken','refreshToken','expiresAt','scope']<>'{}'
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
  if p_tokens ? 'scope' then
   scope_evidence:='provider_response';
   if jsonb_typeof(p_tokens->'scope')='string' and length(p_tokens->>'scope') between 1 and 16384 and nullif(btrim(p_tokens->>'scope'),'') is not null then
    renewed_scopes:=regexp_split_to_array(btrim(p_tokens->>'scope'),'[[:space:]]+');
   else renewed_scopes:=array[]::text[];end if;
  elsif public.integration_permission_state(coalesce(c.provider,'google'),'email',c.scopes,c.provider_metadata->>'scopeEvidence')='confirmed' then
   renewed_scopes:=c.scopes;scope_evidence:='refresh_inherited';
  else renewed_scopes:=array[]::text[];scope_evidence:='unconfirmed';end if;
  permission:=public.integration_permission_state(coalesce(c.provider,'google'),'email',renewed_scopes,scope_evidence);
  new_refresh:=coalesce(p_tokens->>'refreshToken',c.refresh_token);
  update public.email_configurations set access_token=p_tokens->>'accessToken',refresh_token=new_refresh,token_expires_at=expiry,scopes=renewed_scopes,provider_metadata=coalesce(provider_metadata,'{}')||jsonb_build_object('scopeEvidence',scope_evidence),token_status=case when permission='confirmed' then 'healthy' else permission end,
   last_health_check_at=clock_timestamp(),health_check_error=case when permission='confirmed' then null else 'Reconnect this account and grant the required permissions.' end,updated_at=clock_timestamp() where id=c.id returning * into c;
  update public.email_token_refreshes set refresh_status=case when permission='confirmed' then 'success' else permission end,new_expires_at=expiry,completed_version=c.credential_version,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
  if permission<>'confirmed' then return jsonb_build_object('state',permission);end if;
  return public.email_credential_result(c,'saved');
 end if;
 update public.email_token_refreshes set refresh_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'review' else 'failed' end,
  error_message=p_outcome,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
 update public.email_configurations set token_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'refresh_unconfirmed' else token_status end,
  health_check_error=case p_outcome when 'revoked' then 'Email authorization expired or was revoked. Reconnect to restore access.' when 'unconfirmed' then 'Email refresh could not be confirmed. Reconnect to restore access.' else 'Email provider is unavailable. Try again later.' end,
  last_health_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('state',case p_outcome when 'unconfirmed' then 'review' when 'temporary_failure' then 'failed' else p_outcome end);
end; $$;

revoke all on function public.normalize_integration_scope(text),public.integration_permission_state(text,text,text[],text) from public,anon,authenticated;
grant execute on function public.normalize_integration_scope(text),public.integration_permission_state(text,text,text[],text) to service_role;
notify pgrst,'reload schema';
