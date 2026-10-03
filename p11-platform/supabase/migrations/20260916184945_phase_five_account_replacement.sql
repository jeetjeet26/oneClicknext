-- Reviewed account replacement. Local qualification only; historic provider identifiers never move accounts.
create table public.integration_replacements (
 id uuid primary key, property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id) on delete cascade,
 capability text not null check(capability in ('calendar','email')), provider text not null check(provider in ('google','microsoft')),
 account_email text not null, revision text not null, review jsonb not null,
 created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',
 authorization_id uuid unique, completed_at timestamptz
);
create index integration_replacements_property_idx on public.integration_replacements(property_id);
create index integration_replacements_actor_idx on public.integration_replacements(actor_id);
alter table public.integration_replacements enable row level security;
revoke all on public.integration_replacements from public,anon,authenticated;
grant all on public.integration_replacements to service_role;
alter table public.agent_calendars add column retired_at timestamptz, add column replacement_id uuid references public.integration_replacements(id);
alter table public.email_configurations add column retired_at timestamptz, add column replacement_id uuid references public.integration_replacements(id);
create index agent_calendars_replacement_idx on public.agent_calendars(replacement_id) where replacement_id is not null;
create index email_configurations_replacement_idx on public.email_configurations(replacement_id) where replacement_id is not null;
alter table public.agent_calendars drop constraint agent_calendars_profile_id_property_id_key;
alter table public.email_configurations drop constraint email_configurations_property_id_profile_id_key;
create unique index agent_calendars_current_profile_property_key on public.agent_calendars(profile_id,property_id) where retired_at is null;
create unique index email_configurations_current_property_profile_key on public.email_configurations(property_id,profile_id) where retired_at is null;

alter table public.agent_calendars add constraint agent_calendars_retirement_check check ((retired_at is null and replacement_id is null) or (retired_at is not null and replacement_id is not null and sync_enabled is false and access_token is null and refresh_token is null and token_expires_at is null and token_status is not distinct from 'disconnected'));
alter table public.email_configurations add constraint email_configurations_retirement_check check ((retired_at is null and replacement_id is null) or (retired_at is not null and replacement_id is not null and sync_enabled is false and access_token is null and refresh_token is null and token_expires_at is null and token_status is not distinct from 'disconnected'));
create function public.protect_retired_integration() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.retired_at is not null and (new.retired_at,new.replacement_id,new.property_id,new.provider,new.provider_subject,new.account_email,new.google_email,new.tenant_id) is distinct from (old.retired_at,old.replacement_id,old.property_id,old.provider,old.provider_subject,old.account_email,old.google_email,old.tenant_id) then raise exception 'Retired account identity is immutable';end if;
 if new.retired_at is not null and (new.replacement_id is null or new.sync_enabled is distinct from false or new.access_token is not null or new.refresh_token is not null or new.token_expires_at is not null or new.token_status is distinct from 'disconnected') then raise exception 'Retired account cannot be reactivated';end if;
 if old.retired_at is not null and (to_jsonb(new)->'calendar_id') is distinct from (to_jsonb(old)->'calendar_id') then raise exception 'Retired provider calendar identity is immutable';end if;
 return new;
end; $$;
create trigger protect_retired_calendar before update on public.agent_calendars for each row execute function public.protect_retired_integration();
create trigger protect_retired_email before update on public.email_configurations for each row execute function public.protect_retired_integration();

-- Retired history cannot be silently moved to a different provider account.
create function public.protect_retired_integration_binding() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='email_threads' then
  if old.email_configuration_id is distinct from new.email_configuration_id and exists(select 1 from public.email_configurations where id=old.email_configuration_id and retired_at is not null) then raise exception 'Retired email history must keep its original account';end if;
 else
  if old.agent_calendar_id is distinct from new.agent_calendar_id and exists(select 1 from public.agent_calendars where id=old.agent_calendar_id and retired_at is not null) then raise exception 'Retired calendar history must keep its original account';end if;
 end if;
 return new;
end; $$;
create trigger protect_retired_email_binding before update of email_configuration_id on public.email_threads for each row execute function public.protect_retired_integration_binding();
create trigger protect_retired_calendar_binding before update of agent_calendar_id on public.calendar_events for each row execute function public.protect_retired_integration_binding();

create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','calendar.disconnected','integration.authorization.completed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
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
create or replace function public.integration_connection_snapshot(p_property_id uuid,p_capabilities text[]) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object(
 'calendar',case when 'calendar'=any(p_capabilities) then (select coalesce(jsonb_agg(jsonb_build_array(id,credential_version,provider,provider_subject,account_email,tenant_id,calendar_id,sync_enabled,token_status) order by id),'[]') from public.agent_calendars where property_id=p_property_id and retired_at is null) else '[]' end,
 'email',case when 'email'=any(p_capabilities) then (select coalesce(jsonb_agg(jsonb_build_array(id,credential_version,provider,provider_subject,account_email,tenant_id,sync_enabled,token_status,access_token,refresh_token,token_expires_at) order by id),'[]') from public.email_configurations where property_id=p_property_id and retired_at is null) else '[]' end,
 'widget',case when 'email'=any(p_capabilities) then (select jsonb_build_array(id,email_enabled,email_configuration_id) from public.lumaleasing_config where property_id=p_property_id) else '[]' end)::text,'UTF8')),'hex');
$$;

create function public.integration_replacement_review(p_property_id uuid,p_actor_id uuid,p_capability text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare connections jsonb;history_count bigint;active_count bigint:=0;work_count bigint:=0;r jsonb;blockers jsonb:='[]';
begin
 if p_capability is null or p_capability not in ('calendar','email') then raise exception 'Invalid capability';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if p_capability='calendar' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'accountEmail',account_email,'enabled',sync_enabled) order by id),'[]') into connections from public.agent_calendars where property_id=p_property_id and retired_at is null;
  select count(*) into history_count from public.calendar_events e join public.agent_calendars c on c.id=e.agent_calendar_id where c.property_id=p_property_id and c.retired_at is null;
  select (select count(*) from public.tours where property_id=p_property_id and status in ('scheduled','confirmed'))+(select count(*) from public.tour_bookings where property_id=p_property_id and status in ('scheduled','confirmed')) into active_count;
  select count(*) into work_count from public.tour_schedule_work where property_id=p_property_id and kind in ('calendar','calendar_reconcile','confirmation','reminder_24h','reminder_1h') and state in ('queued','running','review');
  work_count:=work_count+(select count(*) from public.luma_delivery_jobs where property_id=p_property_id and state in ('queued','running','review'));
  if active_count>0 then blockers:=blockers||'"active_tours"'::jsonb;end if;
  if work_count>0 then blockers:=blockers||'"unfinished_calendar_delivery"'::jsonb;end if;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'accountEmail',account_email,'enabled',sync_enabled) order by id),'[]') into connections from public.email_configurations where property_id=p_property_id and retired_at is null;
  select count(*),count(*) filter(where t.status is null or t.status not in ('resolved','archived')) into history_count,active_count from public.email_threads t join public.email_configurations c on c.id=t.email_configuration_id where c.property_id=p_property_id and c.retired_at is null;
  if active_count>0 then blockers:=blockers||'"unfinished_email_threads"'::jsonb;end if;
  if not exists(select 1 from public.lumaleasing_config where property_id=p_property_id) then blockers:=blockers||'"configuration_required"'::jsonb;end if;
 end if;
 if jsonb_array_length(connections)<>1 then blockers:=blockers||'"connection_review_required"'::jsonb;end if;
 r:=jsonb_build_object('state','review','capability',p_capability,'connections',connections,'historyCount',history_count,'activeCount',active_count,'workCount',work_count,'blockers',blockers);
 return r||jsonb_build_object('revision',encode(sha256(convert_to((r||jsonb_build_object('snapshot',public.integration_connection_snapshot(p_property_id,array[p_capability])))::text,'UTF8')),'hex'));
end; $$;

-- Shared action evidence retains account references, not mailbox addresses or credentials.
create function public.integration_replacement_evidence(p_review jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
 select (p_review-'connections')||jsonb_build_object('connections',coalesce((select jsonb_agg(value-'accountEmail') from jsonb_array_elements(p_review->'connections')),'[]'));
$$;

create function public.request_recorded_integration_replacement(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_capability text,p_provider text,p_account_email text,p_revision text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare review jsonb;input jsonb;r jsonb;saved jsonb;e public.shared_action_events;d public.integration_replacements;reason text;
begin
 if p_request_id is null or p_actor_id is null or p_property_id is null or p_provider is null or p_provider not in ('google','microsoft') or p_capability is null or p_capability not in ('calendar','email') or p_account_email is null or length(p_account_email)>320 or p_account_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_revision is null or p_revision !~ '^[a-f0-9]{64}$' then raise exception 'Invalid replacement decision';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('capability',p_capability,'provider',p_provider,'targetAccountHash',encode(sha256(convert_to(lower(p_account_email),'UTF8')),'hex'),'revision',p_revision,'historyPolicy','retain_original_account');
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'integration.replacement.requested',input) then return '{"state":"request_conflict"}';end if;
  if e.phase='failed' then return e.result||jsonb_build_object('actionEventId',e.id);end if;
  select * into d from public.integration_replacements where id=p_request_id;
  if not found or d.expires_at<=clock_timestamp() or d.authorization_id is not null then return '{"state":"replacement_unavailable"}';end if;
  return e.result||jsonb_build_object('state','replayed','actionEventId',e.id);
 end if;
 review:=public.integration_replacement_review(p_property_id,p_actor_id,p_capability);
 if review->>'revision' is distinct from p_revision then reason:='stale_review';
 elsif review->'blockers'<>'[]' then reason:='linked_work_requires_review';
 elsif review->'connections'->0->>'provider'=p_provider and lower(review->'connections'->0->>'accountEmail')=lower(p_account_email) then reason:='use_reconnect';end if;
 if reason is null then
  insert into public.integration_replacements(id,property_id,actor_id,capability,provider,account_email,revision,review) values(p_request_id,p_property_id,p_actor_id,p_capability,p_provider,lower(p_account_email),p_revision,review) returning * into d;
 end if;
 r:=jsonb_build_object('state',coalesce(reason,'ready'),'replacementId',d.id,'expiresAt',d.expires_at);
 saved:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'integrations','integration.replacement.requested','server_confirmed',case when reason is null then 'succeeded' else 'failed' end,input,public.integration_replacement_evidence(review),null,r);
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Replacement decision recording failed';end if;
 return r||jsonb_build_object('actionEventId',p_request_id);
end; $$;

-- Recheck this decision before the provider exchange and again at the atomic save.
create function public.integration_replacement_check(p_id uuid,p_context jsonb) returns text
language plpgsql security invoker set search_path='' as $$
declare d public.integration_replacements;r jsonb;
begin
 if p_context->>'replacementId' is null then return null;end if;
 select * into d from public.integration_replacements where id=(p_context->>'replacementId')::uuid for update;
 if not found or p_context->>'authSource'<>'dashboard' or (d.property_id,d.actor_id,d.provider) is distinct from ((p_context->>'propertyId')::uuid,(p_context->>'profileId')::uuid,p_context->>'provider') or p_context->'capabilities'<>jsonb_build_array(d.capability) or d.completed_at is not null or d.expires_at<=clock_timestamp() or (d.authorization_id is not null and d.authorization_id<>p_id) then return 'replacement_unavailable';end if;
 r:=public.integration_replacement_review(d.property_id,d.actor_id,d.capability);
 if r->>'revision' is distinct from d.revision then return 'stale_review';end if;
 if r->'blockers'<>'[]' then return 'linked_work_requires_review';end if;
 return null;
end; $$;

create function public.block_reviewed_integration_authorization(p_id uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.integration_authorizations;d public.integration_replacements;r jsonb;saved jsonb;
begin
 select * into a from public.integration_authorizations where id=p_id;
 r:=jsonb_build_object('state',p_reason);
 if a.context->>'replacementId' is not null then
  select * into d from public.integration_replacements where id=(a.context->>'replacementId')::uuid;
  saved:=public.append_shared_action_event(a.id,d.id,a.property_id,a.actor_id,'integrations','integration.account.replaced','server_confirmed','failed',jsonb_build_object('replacementId',d.id,'provider',d.provider,'capability',d.capability,'historyPolicy','retain_original_account'),public.integration_replacement_evidence(d.review),null,r);
  if saved->>'state' not in ('recorded','replayed') then raise exception 'Replacement outcome recording failed';end if;
 end if;
 update public.integration_authorizations set status='blocked',result=r where id=p_id;
 return r;
end; $$;

create or replace function public.begin_integration_authorization(p_id uuid,p_context jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare prop uuid;actor uuid;caps text[];i public.integration_auth_invites;a public.integration_authorizations;reason text;
begin
 if p_id is null or jsonb_typeof(p_context) is distinct from 'object' or p_context-array['propertyId','profileId','provider','capabilities','authSource','inviteId','tokenHash','redirectUri','requestedScopes','replacementId']<>'{}'
  or p_context->>'provider' is null or p_context->>'authSource' is null or p_context->>'provider' not in ('google','microsoft') or p_context->>'authSource' not in ('dashboard','external_invite') or jsonb_typeof(p_context->'capabilities') is distinct from 'array'
  or jsonb_typeof(p_context->'requestedScopes') is distinct from 'array' or nullif(p_context->>'redirectUri','') is null then raise exception 'Invalid authorization context';end if;
 prop:=(p_context->>'propertyId')::uuid;
 select array_agg(value order by value) into caps from jsonb_array_elements_text(p_context->'capabilities');
 if prop is null or cardinality(caps) is null or not caps<@array['calendar','email'] or cardinality(caps)>2 then raise exception 'Invalid capabilities';end if;
 perform pg_advisory_xact_lock(hashtextextended(prop::text,12));
 if p_context->>'authSource'='external_invite' then
  select * into i from public.integration_auth_invites where id=(p_context->>'inviteId')::uuid and property_id=prop for update;
  if not found or i.token_hash is distinct from p_context->>'tokenHash' or i.provider is distinct from p_context->>'provider' or i.revoked_at is not null or i.consumed_at is not null or i.expires_at<=clock_timestamp()
   or not(i.requested_capabilities@>caps and caps@>i.requested_capabilities) then return '{"state":"invite_unavailable"}';end if;
  actor:=i.created_by_profile_id;
 else
  if p_context->>'inviteId' is not null or p_context->>'tokenHash' is not null then raise exception 'Unexpected invitation';end if;
  actor:=(p_context->>'profileId')::uuid;
 end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=prop and u.id=actor) then return '{"state":"forbidden"}';end if;
 select * into a from public.integration_authorizations where id=p_id;
 if found then
  if a.context is distinct from p_context then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state',case when a.status='pending' and a.expires_at>clock_timestamp() then 'ready' else 'request_used' end,'requestId',a.id);
 end if;
 reason:=public.integration_replacement_check(p_id,p_context);if reason is not null then return jsonb_build_object('state',reason);end if;
 insert into public.integration_authorizations(id,property_id,actor_id,context,snapshot) values(p_id,prop,actor,p_context,public.integration_connection_snapshot(prop,caps));
 update public.integration_replacements set authorization_id=p_id where id=(p_context->>'replacementId')::uuid;
 return jsonb_build_object('state','ready','requestId',p_id);
end; $$;
create or replace function public.claim_integration_authorization(p_id uuid,p_context jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.integration_authorizations;i public.integration_auth_invites;caps text[];reason text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_context->>'propertyId',12));
 select * into a from public.integration_authorizations where id=p_id for update;
 if not found or a.context is distinct from p_context then return '{"state":"request_conflict"}';end if;
 select array_agg(value) into caps from jsonb_array_elements_text(a.context->'capabilities');
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=a.property_id and u.id=a.actor_id) then return '{"state":"forbidden"}';end if;
 if a.status='completed' then
  if a.completed_snapshot is distinct from public.integration_connection_snapshot(a.property_id,caps) then return '{"state":"connection_changed"}';end if;
  return a.result||'{"state":"replayed"}';
 end if;
 if a.status='blocked' then return a.result;end if;
 if a.status='exchanging' then return '{"state":"authorization_unconfirmed"}';end if;
 if a.expires_at<=clock_timestamp() then reason:='expired_state';end if;
 if a.context->>'authSource'='external_invite' then
  select * into i from public.integration_auth_invites where id=(a.context->>'inviteId')::uuid for update;
  if not found or i.property_id<>a.property_id or i.provider<>a.context->>'provider' or i.token_hash<>a.context->>'tokenHash' or i.revoked_at is not null or i.consumed_at is not null or i.expires_at<=clock_timestamp()
   or i.created_by_profile_id is distinct from a.actor_id or not(i.requested_capabilities@>caps and caps@>i.requested_capabilities) then reason:='invite_unavailable';end if;
 end if;
 if a.snapshot is distinct from public.integration_connection_snapshot(a.property_id,caps) then reason:='connection_changed';end if;
 if reason is null then reason:=public.integration_replacement_check(p_id,p_context);end if;
 if reason is not null then
  return public.block_reviewed_integration_authorization(a.id,reason);
 end if;
 update public.integration_authorizations set status='exchanging' where id=a.id;
 return '{"state":"claimed"}';
end; $$;
create or replace function public.finish_integration_authorization(p_id uuid,p_context jsonb,p_grant jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.integration_authorizations;i public.integration_auth_invites;c public.agent_calendars;m public.email_configurations;
 caps text[];grant_scopes text[];reason text;fingerprint text;expiry timestamptz;provider text;account text;subject text;zone text;prop_settings jsonb;r jsonb;recorded jsonb;
 d public.integration_replacements;old_calendar public.agent_calendars;old_email public.email_configurations;cb jsonb;mb jsonb;calendar_count integer;email_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_context->>'propertyId',12));
 select * into a from public.integration_authorizations where id=p_id for update;
 if not found or a.context is distinct from p_context then return '{"state":"request_conflict"}';end if;
 select array_agg(value) into caps from jsonb_array_elements_text(a.context->'capabilities');
 fingerprint:=encode(sha256(convert_to(p_grant::text,'UTF8')),'hex');
 if a.status='completed' then
  if a.result_hash is distinct from fingerprint then return '{"state":"request_conflict"}';end if;
  if a.completed_snapshot is distinct from public.integration_connection_snapshot(a.property_id,caps) then return '{"state":"connection_changed"}';end if;
  return a.result||'{"state":"replayed"}';
 end if;
 if a.status='blocked' then return a.result;end if;
 if a.status<>'exchanging' then return '{"state":"request_conflict"}';end if;
 -- Keep membership and property settings stable through the commit.
 perform 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=a.actor_id and p.id=a.property_id for share of u;
 if not found then return '{"state":"forbidden"}';end if;
 select settings into prop_settings from public.properties where id=a.property_id for update;
 if a.expires_at<=clock_timestamp() then reason:='expired_state';end if;
 if a.context->>'authSource'='external_invite' then
  select * into i from public.integration_auth_invites where id=(a.context->>'inviteId')::uuid for update;
  if not found or i.property_id<>a.property_id or i.provider<>a.context->>'provider' or i.token_hash<>a.context->>'tokenHash' or i.revoked_at is not null or i.consumed_at is not null or i.expires_at<=clock_timestamp()
   or i.created_by_profile_id is distinct from a.actor_id or not(i.requested_capabilities@>caps and caps@>i.requested_capabilities) then reason:='invite_unavailable';end if;
 end if;
 perform 1 from public.agent_calendars where property_id=a.property_id and retired_at is null order by id for update;
 perform 1 from public.email_configurations where property_id=a.property_id and retired_at is null order by id for update;
 perform 1 from public.lumaleasing_config where property_id=a.property_id for update;
 if a.snapshot is distinct from public.integration_connection_snapshot(a.property_id,caps) then reason:='connection_changed';end if;
 if reason is null then reason:=public.integration_replacement_check(p_id,p_context);end if;
 if reason is not null then return public.block_reviewed_integration_authorization(a.id,reason);end if;
 if jsonb_typeof(p_grant) is distinct from 'object' or p_grant-array['accessToken','refreshToken','expiresAt','accountEmail','subject','timezone','scopes','scopeEvidence']<>'{}'
  or jsonb_typeof(p_grant->'accessToken') is distinct from 'string' or length(p_grant->>'accessToken') not between 1 and 32768
  or jsonb_typeof(p_grant->'refreshToken') is distinct from 'string' or length(p_grant->>'refreshToken') not between 1 and 32768
  or jsonb_typeof(p_grant->'subject') is distinct from 'string' or jsonb_typeof(p_grant->'accountEmail') is distinct from 'string' or p_grant->>'scopeEvidence' is null or nullif(p_grant->>'subject','') is null or length(p_grant->>'subject')>512 or nullif(p_grant->>'accountEmail','') is null or length(p_grant->>'accountEmail')>320
  or jsonb_typeof(p_grant->'scopes') is distinct from 'array' or p_grant->>'scopeEvidence' not in ('provider_response','microsoft_request_contract') then raise exception 'Invalid grant';end if;
 expiry:=(p_grant->>'expiresAt')::timestamptz;
 if expiry is null or not isfinite(expiry) or expiry<=clock_timestamp() or expiry>clock_timestamp()+interval '366 days' then raise exception 'Invalid expiry';end if;
 provider:=a.context->>'provider';account:=p_grant->>'accountEmail';subject:=p_grant->>'subject';zone:=p_grant->>'timezone';
 if zone is not null and not exists(select 1 from pg_timezone_names where name=zone) then raise exception 'Invalid timezone';end if;
 select array_agg(value) into grant_scopes from jsonb_array_elements_text(p_grant->'scopes');
 if cardinality(grant_scopes) is null or cardinality(grant_scopes)>100 then raise exception 'Invalid scopes';end if;
 select count(*) into calendar_count from public.agent_calendars where property_id=a.property_id and retired_at is null;
 select count(*) into email_count from public.email_configurations where property_id=a.property_id and retired_at is null;
 if 'calendar'=any(caps) then
  if calendar_count>1 then reason:='connection_review_required';end if;
  select * into c from public.agent_calendars where property_id=a.property_id and retired_at is null order by id limit 1;
  if a.context->>'replacementId' is null and found and (c.provider<>provider or (c.provider_subject is not null and c.provider_subject<>subject) or lower(c.account_email)<>lower(account)) then reason:='account_replacement_required';end if;
  if a.context->>'replacementId' is null and c.id is not null and c.provider_subject is null and exists(select 1 from public.calendar_events where agent_calendar_id=c.id) then reason:='connection_review_required';end if;
 end if;
 if 'email'=any(caps) then
  if email_count>1 then reason:='connection_review_required';end if;
  select * into m from public.email_configurations where property_id=a.property_id and retired_at is null order by id limit 1;
  if a.context->>'replacementId' is null and found and (m.provider<>provider or (m.provider_subject is not null and m.provider_subject<>subject) or lower(m.account_email)<>lower(account)) then reason:='account_replacement_required';end if;
  if a.context->>'replacementId' is null and m.id is not null and m.provider_subject is null and exists(select 1 from public.email_threads where email_configuration_id=m.id) then reason:='connection_review_required';end if;
  if not exists(select 1 from public.lumaleasing_config where property_id=a.property_id) then reason:='configuration_required';end if;
 end if;
 if reason is null then reason:=public.integration_replacement_check(p_id,p_context);end if;
 if reason is not null then return public.block_reviewed_integration_authorization(a.id,reason);end if;
 if a.context->>'replacementId' is not null then
  select * into d from public.integration_replacements where id=(a.context->>'replacementId')::uuid;
  if lower(account) is distinct from d.account_email then
   return public.block_reviewed_integration_authorization(a.id,'replacement_account_mismatch');
  end if;
 end if;
 cb:=case when c.id is not null then jsonb_build_object('id',c.id,'provider',c.provider,'enabled',c.sync_enabled,'version',c.credential_version) else 'null' end;
 mb:=case when m.id is not null then jsonb_build_object('id',m.id,'provider',m.provider,'enabled',m.sync_enabled) else 'null' end;
 if d.id is not null then
  old_calendar:=c;old_email:=m;
  if c.id is not null then
   update public.agent_calendars set retired_at=clock_timestamp(),replacement_id=d.id,access_token=null,refresh_token=null,token_expires_at=null,sync_enabled=false,token_status='disconnected',health_check_error='Account replaced; history retained',watch_channel_id=null,watch_resource_id=null,watch_expiration=null,watch_last_message_number=null,updated_at=clock_timestamp() where id=c.id;
   c:=null;
  end if;
  if m.id is not null then
   update public.email_configurations set retired_at=clock_timestamp(),replacement_id=d.id,access_token=null,refresh_token=null,token_expires_at=null,sync_enabled=false,auto_reply_enabled=false,token_status='disconnected',health_check_error='Account replaced; history retained',watch_expiration=null,updated_at=clock_timestamp() where id=m.id;
   m:=null;
  end if;
 end if;
 if 'calendar'=any(caps) then
  if c.id is null then
   insert into public.agent_calendars(property_id,profile_id,provider,google_email,account_email,provider_subject,access_token,refresh_token,token_expires_at,timezone,scopes,auth_source,authorized_by_profile_id,external_invite_id,provider_metadata)
   values(a.property_id,a.actor_id,provider,account,account,subject,p_grant->>'accessToken',p_grant->>'refreshToken',expiry,zone,grant_scopes,a.context->>'authSource',a.actor_id,i.id,jsonb_build_object('scopeEvidence',p_grant->>'scopeEvidence')) returning * into c;
  else
   update public.agent_calendars set google_email=account,account_email=account,provider_subject=subject,access_token=p_grant->>'accessToken',refresh_token=p_grant->>'refreshToken',token_expires_at=expiry,
    timezone=zone,scopes=grant_scopes,auth_source=a.context->>'authSource',authorized_by_profile_id=a.actor_id,external_invite_id=i.id,provider_metadata=jsonb_build_object('scopeEvidence',p_grant->>'scopeEvidence'),
    sync_enabled=true,token_status='healthy',health_check_error=null,last_health_check_at=clock_timestamp(),watch_channel_id=null,watch_resource_id=null,watch_expiration=null,watch_last_message_number=null,updated_at=clock_timestamp() where id=c.id returning * into c;
  end if;
 end if;
 if old_calendar.id is not null then
  update public.agent_calendars set working_hours=old_calendar.working_hours,tour_duration_minutes=old_calendar.tour_duration_minutes,buffer_minutes=old_calendar.buffer_minutes,timezone=old_calendar.timezone where id=c.id returning * into c;
 end if;
 if 'email'=any(caps) then
  if m.id is null then
   insert into public.email_configurations(property_id,profile_id,provider,google_email,account_email,provider_subject,access_token,refresh_token,token_expires_at,scopes,auth_source,authorized_by_profile_id,external_invite_id,provider_metadata)
   values(a.property_id,a.actor_id,provider,account,account,subject,p_grant->>'accessToken',p_grant->>'refreshToken',expiry,grant_scopes,a.context->>'authSource',a.actor_id,i.id,jsonb_build_object('scopeEvidence',p_grant->>'scopeEvidence')) returning * into m;
  else
   update public.email_configurations set google_email=account,account_email=account,provider_subject=subject,access_token=p_grant->>'accessToken',refresh_token=p_grant->>'refreshToken',token_expires_at=expiry,
    scopes=grant_scopes,auth_source=a.context->>'authSource',authorized_by_profile_id=a.actor_id,external_invite_id=i.id,provider_metadata=jsonb_build_object('scopeEvidence',p_grant->>'scopeEvidence'),
    sync_enabled=true,token_status='healthy',health_check_error=null,last_health_check_at=clock_timestamp(),watch_expiration=null,updated_at=clock_timestamp() where id=m.id returning * into m;
  end if;
  update public.lumaleasing_config set email_enabled=true,email_configuration_id=m.id,updated_at=clock_timestamp() where property_id=a.property_id;
 end if;
 if i.id is not null then update public.integration_auth_invites set consumed_at=clock_timestamp(),consumed_calendar_id=c.id,consumed_email_configuration_id=m.id,updated_at=clock_timestamp() where id=i.id;end if;
 -- Property timezone overrides provider timezone; an invalid explicit setting never silently falls back.
 if prop_settings ? 'timezone' then zone:=prop_settings->>'timezone';end if;
 r:=jsonb_build_object('state','saved','requestId',a.id,'calendarId',c.id,'emailConfigId',m.id,'timezoneSetupRequired',('calendar'=any(caps) and (zone is null or not exists(select 1 from pg_timezone_names where name=zone))));
 recorded:=public.append_shared_action_event(a.id,a.id,a.property_id,a.actor_id,'integrations',case when d.id is null then 'integration.authorization.completed' else 'integration.account.replaced' end,'server_confirmed','succeeded',
  jsonb_build_object('requestId',a.id,'provider',provider,'capabilities',caps,'authorizationSource',a.context->>'authSource','inviteId',i.id,'replacementId',d.id,'historyPolicy',case when d.id is not null then 'retain_original_account' end,'authorizer',case when i.id is null then 'operator' else 'external_account' end),
  jsonb_build_object('state','before_authorization','calendar',cb,'email',mb),jsonb_build_object('state','authorized','retiredCalendarId',old_calendar.id,'retiredEmailConfigId',old_email.id,'calendarId',c.id,'emailConfigId',m.id,'scopeEvidence',p_grant->>'scopeEvidence','scopes',grant_scopes),r);
 if recorded->>'state' not in ('recorded','replayed') then raise exception 'Authorization recording failed';end if;
 update public.integration_replacements set completed_at=clock_timestamp() where id=d.id;
 update public.integration_authorizations set status='completed',result=r,result_hash=fingerprint,completed_snapshot=public.integration_connection_snapshot(a.property_id,caps) where id=a.id;
 return r;
end; $$;
create or replace function public.disconnect_recorded_calendar(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_provider text default null) returns jsonb
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
 perform 1 from public.agent_calendars where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider) order by id for update;
 select jsonb_build_object('state','before_disconnection','calendars',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into before_state
 from public.agent_calendars where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider);
 update public.agent_calendars set access_token=null,refresh_token=null,token_expires_at=null,sync_enabled=false,token_status='disconnected',health_check_error='Disconnected by operator',
  watch_channel_id=null,watch_resource_id=null,watch_expiration=null,watch_last_message_number=null,updated_at=clock_timestamp()
 where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider) and (access_token is not null or refresh_token is not null or sync_enabled is distinct from false or token_status is distinct from 'disconnected');
 get diagnostics changed=row_count;
 update public.calendar_token_refreshes a set refresh_status='superseded',error_message='operator_disconnected',finished_at=clock_timestamp(),lease_until=null
 from public.agent_calendars c where c.id=a.agent_calendar_id and c.property_id=p_property_id and (p_provider is null or c.provider=p_provider) and a.refresh_status in ('running','review');
 select jsonb_build_object('state','disconnected','calendars',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into after_state
 from public.agent_calendars where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider);
 update public.integration_authorizations set status='blocked',result='{"state":"connection_changed"}' where property_id=p_property_id and status in ('pending','exchanging') and context->'capabilities' ? 'calendar' and (p_provider is null or context->>'provider'=p_provider);
 r:=jsonb_build_object('state','applied','disconnected',changed);
 saved:=public.append_shared_action_event(p_request_id,md5('calendar-disconnect/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'integrations','calendar.disconnected','server_confirmed','succeeded',input,before_state,after_state,r);
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Calendar disconnection could not be recorded';end if;
 return r||jsonb_build_object('actionEventId',p_request_id);
end; $$;
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
 perform 1 from public.email_configurations where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider) order by id for update;
 select jsonb_build_object('state','before_disconnection','connections',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into before_state from public.email_configurations where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider);
 update public.email_configurations set access_token=null,refresh_token=null,token_expires_at=null,sync_enabled=false,auto_reply_enabled=false,token_status='disconnected',health_check_error='Disconnected by operator',history_id=null,watch_expiration=null,updated_at=clock_timestamp()
 where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider) and (access_token is not null or refresh_token is not null or sync_enabled is distinct from false or token_status is distinct from 'disconnected');
 get diagnostics changed=row_count;
 update public.email_token_refreshes a set refresh_status='superseded',error_message='operator_disconnected',finished_at=clock_timestamp(),lease_until=null from public.email_configurations c where c.id=a.email_configuration_id and c.property_id=p_property_id and (p_provider is null or c.provider=p_provider) and a.refresh_status in ('running','review');
 update public.lumaleasing_config set email_enabled=false,email_configuration_id=null,updated_at=clock_timestamp() where property_id=p_property_id and email_configuration_id in(select id from public.email_configurations where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider));
 update public.integration_authorizations set status='blocked',result='{"state":"connection_changed"}' where property_id=p_property_id and status in ('pending','exchanging') and context->'capabilities' ? 'email' and (p_provider is null or context->>'provider'=p_provider);
 select jsonb_build_object('state','disconnected','connections',coalesce(jsonb_agg(jsonb_build_object('id',id,'provider',provider,'enabled',sync_enabled,'status',token_status,'version',credential_version) order by id),'[]')) into after_state from public.email_configurations where property_id=p_property_id and retired_at is null and (p_provider is null or provider=p_provider);
 r:=jsonb_build_object('state','applied','disconnected',changed);
 recorded:=public.append_shared_action_event(p_request_id,md5('email-disconnect/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'integrations','email.disconnected','server_confirmed','succeeded',input,before_state,after_state,r);
 if recorded->>'state' not in ('recorded','replayed') then raise exception 'Email disconnection could not be recorded';end if;
 return r||jsonb_build_object('actionEventId',p_request_id);
end; $$;

create function public.email_reply_matches_account(p_property_id uuid,p_email_id uuid,p_thread_id text,p_message_id text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.email_configurations c where c.id=p_email_id and c.property_id=p_property_id and c.retired_at is null and c.sync_enabled)
 and (p_thread_id is null or exists(select 1 from public.email_threads t where t.email_configuration_id=p_email_id and t.property_id=p_property_id and t.gmail_thread_id=p_thread_id))
 and (p_message_id is null or exists(select 1 from public.email_messages m join public.email_threads t on t.id=m.email_thread_id where t.email_configuration_id=p_email_id and t.property_id=p_property_id and m.gmail_message_id=p_message_id and (p_thread_id is null or t.gmail_thread_id=p_thread_id)));
$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('protect_retired_integration_binding','integration_replacement_evidence','block_reviewed_integration_authorization','email_reply_matches_account','protect_retired_integration','integration_replacement_review','request_recorded_integration_replacement','integration_replacement_check') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end; $$;
notify pgrst,'reload schema';
