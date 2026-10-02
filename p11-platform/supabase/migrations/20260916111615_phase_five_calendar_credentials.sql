-- Local qualification: versioned credentials, one bounded refresh owner, atomic token/audit saves.
alter table public.agent_calendars add column credential_version bigint not null default 1;
alter table public.calendar_token_refreshes add column request_id uuid;
alter table public.calendar_token_refreshes add column credential_version bigint;
alter table public.calendar_token_refreshes add column completed_version bigint;
alter table public.calendar_token_refreshes add column lease_until timestamptz;
alter table public.calendar_token_refreshes add column finished_at timestamptz;
alter table public.calendar_token_refreshes add column result_hash text;
create unique index calendar_refresh_request_idx on public.calendar_token_refreshes(request_id) where request_id is not null;
create index calendar_refresh_running_idx on public.calendar_token_refreshes(agent_calendar_id,credential_version) where refresh_status='running';
-- All production consumers use authenticated server routes; credentials are never browser-readable.
revoke all on public.agent_calendars from public,anon,authenticated;
revoke insert,update,delete,truncate,references,trigger on public.calendar_token_refreshes from public,anon,authenticated;

create function public.version_calendar_credentials() returns trigger language plpgsql set search_path='' as $$begin
 if (new.provider,new.account_email,new.google_email,new.provider_subject,new.tenant_id,new.calendar_id,new.access_token,new.refresh_token,new.token_expires_at,new.sync_enabled)
  is distinct from (old.provider,old.account_email,old.google_email,old.provider_subject,old.tenant_id,old.calendar_id,old.access_token,old.refresh_token,old.token_expires_at,old.sync_enabled)
 then new.credential_version:=old.credential_version+1;else new.credential_version:=old.credential_version;end if;
 return new;
end; $$;
create trigger version_calendar_credentials before update on public.agent_calendars for each row execute function public.version_calendar_credentials();

create function public.calendar_credential_identity(c public.agent_calendars) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('provider',coalesce(c.provider,'google'),'accountEmail',coalesce(c.account_email,c.google_email),
  'calendarId',coalesce(c.calendar_id,'primary'),'subject',c.provider_subject,'tenant',c.tenant_id);
$$;
create function public.calendar_credential_result(c public.agent_calendars,p_state text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('state',p_state,'accessToken',c.access_token,'refreshToken',c.refresh_token,'expiresAt',c.token_expires_at,'version',c.credential_version);
$$;
create function public.claim_calendar_token_refresh(p_property_id uuid,p_calendar_id uuid,p_version bigint,p_identity jsonb,p_request_id uuid,p_force boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.agent_calendars;a public.calendar_token_refreshes;
begin
 if p_request_id is null or p_version is null or p_version<1 or jsonb_typeof(p_identity) is distinct from 'object' then raise exception 'Invalid refresh request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.agent_calendars where id=p_calendar_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if public.calendar_credential_identity(c)<>p_identity then return '{"state":"connection_changed"}';end if;
 if not coalesce(c.sync_enabled,false) or nullif(c.access_token,'') is null or nullif(c.refresh_token,'') is null or c.token_status in ('disconnected','revoked','refresh_unconfirmed') then return '{"state":"reconnect_required"}';end if;
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

create function public.finish_calendar_token_refresh(p_property_id uuid,p_calendar_id uuid,p_request_id uuid,p_outcome text,p_tokens jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.agent_calendars;a public.calendar_token_refreshes;fingerprint text;expiry timestamptz;new_refresh text;
begin
 if p_outcome is null or p_outcome not in ('success','revoked','temporary_failure','unconfirmed') then raise exception 'Invalid refresh result';end if;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('outcome',p_outcome,'tokens',p_tokens)::text,'UTF8')),'hex');
 if p_outcome='success' then
  if jsonb_typeof(p_tokens) is distinct from 'object' or p_tokens-array['accessToken','refreshToken','expiresAt']<>'{}'
   or jsonb_typeof(p_tokens->'accessToken') is distinct from 'string' or length(p_tokens->>'accessToken') not between 1 and 16384
   or jsonb_typeof(p_tokens->'expiresAt') is distinct from 'string' then raise exception 'Invalid refreshed credentials';end if;
  expiry:=(p_tokens->>'expiresAt')::timestamptz;
  if not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '366 days' then raise exception 'Invalid refreshed expiry';end if;
  if p_tokens ? 'refreshToken' and p_tokens->'refreshToken'<>'null' and (jsonb_typeof(p_tokens->'refreshToken') is distinct from 'string' or length(p_tokens->>'refreshToken') not between 1 and 16384) then raise exception 'Invalid rotated token';end if;
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
  new_refresh:=coalesce(p_tokens->>'refreshToken',c.refresh_token);
  update public.agent_calendars set access_token=p_tokens->>'accessToken',refresh_token=new_refresh,token_expires_at=expiry,token_status='healthy',
   last_health_check_at=clock_timestamp(),health_check_error=null,updated_at=clock_timestamp() where id=c.id returning * into c;
  update public.calendar_token_refreshes set refresh_status='success',new_expires_at=expiry,completed_version=c.credential_version,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
  return public.calendar_credential_result(c,'saved');
 end if;
 update public.calendar_token_refreshes set refresh_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'review' else 'failed' end,
  error_message=p_outcome,finished_at=clock_timestamp(),result_hash=fingerprint,lease_until=null where id=a.id;
 update public.agent_calendars set token_status=case p_outcome when 'revoked' then 'revoked' when 'unconfirmed' then 'refresh_unconfirmed' else token_status end,
  health_check_error=case p_outcome when 'revoked' then 'Calendar authorization expired or was revoked. Reconnect to restore access.' when 'unconfirmed' then 'Calendar refresh could not be confirmed. Reconnect to restore access.' else 'Calendar provider is unavailable. Try again later.' end,
  last_health_check_at=clock_timestamp(),updated_at=clock_timestamp() where id=c.id;
 return jsonb_build_object('state',case p_outcome when 'unconfirmed' then 'review' when 'temporary_failure' then 'failed' else p_outcome end);
end; $$;
revoke all on function public.version_calendar_credentials(),public.calendar_credential_identity(public.agent_calendars),public.calendar_credential_result(public.agent_calendars,text),public.claim_calendar_token_refresh(uuid,uuid,bigint,jsonb,uuid,boolean),public.finish_calendar_token_refresh(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.version_calendar_credentials(),public.calendar_credential_identity(public.agent_calendars),public.calendar_credential_result(public.agent_calendars,text),public.claim_calendar_token_refresh(uuid,uuid,bigint,jsonb,uuid,boolean),public.finish_calendar_token_refresh(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';

create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','calendar.disconnected','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action='calendar.disconnected' then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action in ('luma.configuration.created','luma.configuration.saved') then
  if p_product<>'lumaleasing' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid configuration evidence';end if;
 else
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid workflow evidence';end if;
 end if;
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 job:=nullif(p_links->>'jobId','')::uuid;attempt:=nullif(p_links->>'attemptId','')::uuid;context_id:=nullif(p_links->>'contextId','')::uuid;
 select * into e from public.shared_action_events where id=p_id;
 if found then
  if (e.episode_id,e.property_id,e.actor_id,e.product,e.action,e.evidence,e.phase,e.request,e.before_state,e.after_state,e.result,e.shared_job_ref,e.shared_attempt_ref,e.context_snapshot_ref)
   is distinct from (p_episode_id,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','eventId',e.id);
 end if;
 if job is not null and not exists(select 1 from public.shared_jobs where id=job and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 if attempt is not null and not exists(select 1 from public.shared_action_attempts where id=attempt and org_id=organization and property_id=p_property_id and (job is null or job_id=job)) then return '{"state":"link_conflict"}';end if;
 if context_id is not null and not exists(select 1 from public.shared_context_snapshots where id=context_id and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;



create function public.disconnect_recorded_calendar(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_provider text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare before_state jsonb;after_state jsonb;input jsonb;r jsonb;saved jsonb;e public.shared_action_events;changed integer;
begin
 if p_request_id is null or p_actor_id is null or (p_provider is not null and p_provider not in ('google','microsoft')) then raise exception 'Invalid calendar disconnection';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('requestId',p_request_id,'provider',p_provider);
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'calendar.disconnected',input) then return '{"state":"request_conflict"}';end if;
  return e.result||jsonb_build_object('state','replayed','actionEventId',e.id);
 end if;
 perform 1 from public.agent_calendars where property_id=p_property_id and (p_provider is null or provider=p_provider) order by id for update;
 select jsonb_build_object('state','before_disconnection','calendars',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into before_state
 from public.agent_calendars where property_id=p_property_id and (p_provider is null or provider=p_provider);
 update public.agent_calendars set access_token=null,refresh_token=null,token_expires_at=null,sync_enabled=false,token_status='disconnected',health_check_error='Disconnected by operator',
  watch_channel_id=null,watch_resource_id=null,watch_expiration=null,watch_last_message_number=null,updated_at=clock_timestamp()
 where property_id=p_property_id and (p_provider is null or provider=p_provider) and (access_token is not null or refresh_token is not null or sync_enabled is distinct from false or token_status is distinct from 'disconnected');
 get diagnostics changed=row_count;
 update public.calendar_token_refreshes a set refresh_status='superseded',error_message='operator_disconnected',finished_at=clock_timestamp(),lease_until=null
 from public.agent_calendars c where c.id=a.agent_calendar_id and c.property_id=p_property_id and (p_provider is null or c.provider=p_provider) and a.refresh_status in ('running','review');
 select jsonb_build_object('state','disconnected','calendars',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into after_state
 from public.agent_calendars where property_id=p_property_id and (p_provider is null or provider=p_provider);
 r:=jsonb_build_object('state','applied','disconnected',changed);
 saved:=public.append_shared_action_event(p_request_id,md5('calendar-disconnect/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'integrations','calendar.disconnected','server_confirmed','succeeded',input,before_state,after_state,r);
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Calendar disconnection could not be recorded';end if;
 return r||jsonb_build_object('actionEventId',p_request_id);
end; $$;
revoke all on function public.disconnect_recorded_calendar(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.disconnect_recorded_calendar(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
