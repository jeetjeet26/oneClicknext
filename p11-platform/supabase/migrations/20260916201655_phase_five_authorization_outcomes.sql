-- Local qualification: authorization lifecycle and action evidence share a transaction.
alter table public.integration_authorizations
 add column org_id uuid references public.organizations(id) on delete cascade,
 add column claim_token uuid,
 add column failure_source text,
 add column finished_at timestamptz;
-- Recover legacy origin only from an existing confirmed event, never current membership.
update public.integration_authorizations a set org_id=e.org_id from public.shared_action_events e where e.id=a.id and e.property_id=a.property_id and e.actor_id=a.actor_id and e.evidence='server_confirmed';
-- Old in-flight requests have no proven origin. Hold them at cutover before enabling
-- lifecycle triggers; never invent historical action evidence or let them resume an exchange.
update public.integration_authorizations set status='blocked',result='{"state":"request_conflict"}',failure_source='legacy_cutover',finished_at=clock_timestamp() where org_id is null and status in ('pending','exchanging');
create index integration_authorizations_org_idx on public.integration_authorizations(org_id);
create index integration_authorizations_expiry_idx on public.integration_authorizations(expires_at,id) where status in ('pending','exchanging');

create function public.pin_integration_authorization_scope() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  select p.org_id into new.org_id from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=new.property_id and u.id=new.actor_id for share of p,u;
  if new.org_id is null then raise exception 'Authorization origin unavailable';end if;
 elsif (new.id,new.org_id,new.property_id,new.actor_id,new.context,new.snapshot) is distinct from (old.id,old.org_id,old.property_id,old.actor_id,old.context,old.snapshot) then raise exception 'Authorization origin is immutable';end if;
 if tg_op='UPDATE' and old.status in ('completed','blocked') and (new.status,new.result,new.result_hash,new.completed_snapshot,new.failure_source) is distinct from (old.status,old.result,old.result_hash,old.completed_snapshot,old.failure_source) then raise exception 'Authorization outcome is immutable';end if;
 if new.status in ('completed','blocked') then new.finished_at:=coalesce(new.finished_at,clock_timestamp());end if;
 return new;
end; $$;
create trigger pin_authorization_scope before insert or update on public.integration_authorizations for each row execute function public.pin_integration_authorization_scope();

-- Trigger-only writer. The tenant and initiating actor come from the immutable saved request,
-- so loss of membership can be recorded without giving that actor any new authority.
create function public.record_integration_authorization_transition() returns trigger
language plpgsql security invoker set search_path='' as $$
declare event_key text;event_id uuid;episode_id uuid;action_name text;event_phase text;input jsonb;prior jsonb;after_state jsonb;result jsonb;e public.shared_action_events;episode public.shared_action_episodes;reason text;
begin
 if tg_op='INSERT' then
  event_key:=md5('integration-authorization-start/'||new.id::text);
  -- Canonical UUID version/variant bits also satisfy activity pagination validation.
  event_id:=(substr(event_key,1,12)||'3'||substr(event_key,14,3)||'8'||substr(event_key,18))::uuid;episode_id:=new.id;action_name:='integration.authorization.started';event_phase:='succeeded';prior:=null;
  result:=jsonb_build_object('state','request_saved','requestId',new.id);
 elsif old.status is distinct from new.status and new.status='blocked' then
  event_id:=new.id;episode_id:=new.id;reason:=new.result->>'state';event_phase:='failed';
  if reason is null or reason not in ('authorization_denied','provider_error','provider_exchange_failed','authorization_unconfirmed','permissions_unconfirmed','permissions_incomplete','invalid_token_response','account_unconfirmed','authorization_save_unconfirmed','invalid_callback','expired_state','connection_changed','invite_unavailable','forbidden','stale_review','linked_work_requires_review','replacement_unavailable','replacement_account_mismatch','account_replacement_required','connection_review_required','configuration_required') then raise exception 'Unregistered authorization outcome';end if;
  action_name:=case when new.context->>'replacementId' is not null then 'integration.account.replaced' when reason='authorization_denied' then 'integration.authorization.cancelled' else 'integration.authorization.failed' end;
  prior:=jsonb_build_object('status',old.status);result:=jsonb_build_object('state',reason,'requestId',new.id);
 else return new;end if;
 if new.org_id is null then raise exception 'Legacy authorization origin needs review';end if;
 input:=jsonb_build_object('requestId',new.id,'provider',new.context->>'provider','capabilities',new.context->'capabilities','authorizationSource',new.context->>'authSource','inviteId',new.context->'inviteId','replacementId',new.context->'replacementId','authorizer',case when new.context->>'authSource'='external_invite' then 'external_account' else 'operator' end,'decisionSource',case when tg_op='INSERT' then 'request_saved' else coalesce(new.failure_source,'request_validation') end);
 after_state:=jsonb_build_object('status',new.status,'authorizationChangedConnection',false);
 -- A request was saved; this does not assert that a provider page was opened or consent given.
 if tg_op='INSERT' then after_state:=jsonb_build_object('status','pending');end if;
 select * into e from public.shared_action_events where id=event_id;
 if found then raise exception 'Authorization event identity conflict';end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(episode_id,new.org_id,new.property_id,new.actor_id,'workflow') on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (new.org_id,new.property_id,new.actor_id,'workflow'::text) then raise exception 'Authorization episode conflict';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result)
 values(event_id,episode_id,new.org_id,new.property_id,new.actor_id,'integrations',action_name,'server_confirmed',event_phase,input,prior,after_state,result);
 return new;
end; $$;
create trigger record_authorization_transition after insert or update of status on public.integration_authorizations for each row execute function public.record_integration_authorization_transition();

-- Existing connection/invitation controls also reach the lifecycle trigger when they invalidate requests.
create or replace function public.block_reviewed_integration_authorization(p_id uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.integration_authorizations;
begin
 select * into a from public.integration_authorizations where id=p_id;
 if not found then return '{"state":"request_conflict"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.property_id::text,12));
 select * into a from public.integration_authorizations where id=p_id for update;
 if a.status in ('completed','blocked') then return a.result;end if;
 update public.integration_authorizations set status='blocked',result=jsonb_build_object('state',p_reason) where id=p_id;
 return jsonb_build_object('state',p_reason);
end; $$;

-- Callback errors need the exact saved context. Once exchange starts, only its owner can
-- report a failure; a duplicate callback cannot close another worker's active exchange.
create function public.close_integration_authorization(p_id uuid,p_context jsonb,p_reason text,p_claim_token uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.integration_authorizations;caps text[];reason text:=p_reason;
begin
 if p_reason is null or p_reason not in ('authorization_denied','provider_error','provider_exchange_failed','authorization_unconfirmed','permissions_unconfirmed','permissions_incomplete','invalid_token_response','account_unconfirmed','authorization_save_unconfirmed','invalid_callback','expired_state') then raise exception 'Invalid callback outcome';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_context->>'propertyId',12));
 select * into a from public.integration_authorizations where id=p_id for update;
 if not found or a.context is distinct from p_context or a.org_id is null then return '{"state":"request_conflict"}';end if;
 if a.status='completed' then
  select array_agg(value) into caps from jsonb_array_elements_text(a.context->'capabilities');
  if a.completed_snapshot is distinct from public.integration_connection_snapshot(a.property_id,caps) then return '{"state":"connection_changed"}';end if;
  return a.result||'{"state":"replayed"}';
 end if;
 if a.status='blocked' then return a.result||jsonb_build_object('requestId',a.id,'actionEventId',a.id);end if;
 if p_reason='expired_state' then
  if a.expires_at>clock_timestamp() then return '{"state":"request_conflict"}';end if;
 elsif a.status='pending' then
  if p_reason not in ('authorization_denied','provider_error','invalid_callback') or p_claim_token is not null then return '{"state":"request_conflict"}';end if;
 elsif p_claim_token is null or p_claim_token is distinct from a.claim_token or p_reason in ('authorization_denied','provider_error','invalid_callback') then return '{"state":"authorization_unconfirmed"}';end if;
 if a.expires_at<=clock_timestamp() then reason:='expired_state';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=a.property_id and u.id=a.actor_id and p.org_id=a.org_id) then reason:='forbidden';end if;
 update public.integration_authorizations set status='blocked',failure_source=case when p_reason in ('authorization_denied','provider_error','invalid_callback','expired_state') then 'signed_callback' else 'exchange_owner' end,result=jsonb_build_object('state',reason) where id=a.id;
 return jsonb_build_object('state',reason,'requestId',a.id,'actionEventId',a.id);
end; $$;

create function public.expire_integration_authorizations(p_limit integer default 100) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate record;changed integer;processed integer:=0;skipped integer:=0;
begin
 -- One bounded expiry worker, ordered properties then row. Do not wait behind active requests.
 if not pg_try_advisory_xact_lock(hashtextextended('integration-authorization-expiry',13)) then return '{"state":"busy","processed":0,"skipped":0,"remaining":true,"legacyUnqualified":0}';end if;
 for candidate in select id,property_id from public.integration_authorizations where status in ('pending','exchanging') and org_id is not null and expires_at<=clock_timestamp() order by expires_at,id limit greatest(1,least(coalesce(p_limit,100),100)) loop
  if not pg_try_advisory_xact_lock(hashtextextended(candidate.property_id::text,12)) then skipped:=skipped+1;continue;end if;
  update public.integration_authorizations set status='blocked',failure_source='expiry_sweep',result='{"state":"expired_state"}' where id=candidate.id and status in ('pending','exchanging') and expires_at<=clock_timestamp();
  get diagnostics changed=row_count;processed:=processed+changed;
 end loop;
 return jsonb_build_object('state','completed','processed',processed,'skipped',skipped,'remaining',exists(select 1 from public.integration_authorizations where status in ('pending','exchanging') and org_id is not null and expires_at<=clock_timestamp()),'legacyUnqualified',(select count(*) from public.integration_authorizations where status in ('pending','exchanging') and org_id is null));
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
  if a.context is distinct from p_context or a.org_id is null or not exists(select 1 from public.properties where id=a.property_id and org_id=a.org_id) then return '{"state":"request_conflict"}';end if;
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
 if not found or a.context is distinct from p_context or a.org_id is null then return '{"state":"request_conflict"}';end if;
 select array_agg(value) into caps from jsonb_array_elements_text(a.context->'capabilities');
 perform 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=a.property_id and u.id=a.actor_id and p.org_id=a.org_id for share of p,u;
 if not found then
  if a.status in ('completed','blocked') then return '{"state":"forbidden"}';end if;
  return public.block_reviewed_integration_authorization(a.id,'forbidden');
 end if;
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
 update public.integration_authorizations set status='exchanging',claim_token=gen_random_uuid() where id=a.id returning * into a;
 return jsonb_build_object('state','claimed','claimToken',a.claim_token);
end; $$;
create or replace function public.finish_integration_authorization(p_id uuid,p_context jsonb,p_grant jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.integration_authorizations;i public.integration_auth_invites;c public.agent_calendars;m public.email_configurations;
 caps text[];grant_scopes text[];reason text;fingerprint text;expiry timestamptz;provider text;account text;subject text;zone text;prop_settings jsonb;r jsonb;recorded jsonb;
 d public.integration_replacements;old_calendar public.agent_calendars;old_email public.email_configurations;cb jsonb;mb jsonb;calendar_count integer;email_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_context->>'propertyId',12));
 select * into a from public.integration_authorizations where id=p_id for update;
 if not found or a.context is distinct from p_context or a.org_id is null then return '{"state":"request_conflict"}';end if;
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
 perform 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=a.actor_id and p.id=a.property_id and p.org_id=a.org_id for share of p,u;
 if not found then return public.block_reviewed_integration_authorization(a.id,'forbidden');end if;
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
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
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
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('pin_integration_authorization_scope','record_integration_authorization_transition','close_integration_authorization','expire_integration_authorizations') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end; $$;
notify pgrst,'reload schema';
