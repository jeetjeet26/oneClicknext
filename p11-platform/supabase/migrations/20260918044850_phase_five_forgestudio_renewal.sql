create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.%' then
  if p_product<>'leadpulse' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid scoring evidence';end if;
 elsif p_action like 'brand.%' then
  if p_product<>'brandforge' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid brand evidence';end if;
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
 origin:=case when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
alter table public.social_connections add column refresh_token_expires_at timestamptz;
create table public.forgestudio_renewals(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),connection_id uuid not null references public.social_connections(id),connection_version integer not null,
 platform text not null,state text not null default 'exchanging' check(state in('exchanging','completed','held')),
 input jsonb not null,input_hash text not null,snapshot jsonb not null,credentials jsonb not null,claim_token uuid not null default gen_random_uuid(),result jsonb,result_hash text,reason text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 unique(connection_id,connection_version)
);
create index forgestudio_renewals_property on public.forgestudio_renewals(property_id,created_at desc,id);
create index forgestudio_renewals_org on public.forgestudio_renewals(org_id);
create index forgestudio_renewals_actor on public.forgestudio_renewals(actor_id);
alter table public.forgestudio_renewals enable row level security;
create policy forgestudio_renewals_service on public.forgestudio_renewals for all to service_role using(true) with check(true);
revoke all on public.forgestudio_renewals from public,anon,authenticated;grant all on public.forgestudio_renewals to service_role;
create function public.guard_forgestudio_renewal() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Credential renewal history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.connection_id,new.connection_version,new.platform,new.input,new.input_hash,new.snapshot,new.credentials,new.claim_token,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.connection_id,old.connection_version,old.platform,old.input,old.input_hash,old.snapshot,old.credentials,old.claim_token,old.created_at) then raise exception 'Renewal request identity is immutable';end if;
 if old.result is not null and(new.result,new.result_hash) is distinct from(old.result,old.result_hash) then raise exception 'Renewal result is immutable';end if;
 if old.state in('completed','held') and(new.state,new.reason,new.finished_at) is distinct from(old.state,old.reason,old.finished_at) then raise exception 'Closed renewal cannot be reopened';end if;return new;
end;$$;
create trigger forgestudio_renewal_guard before update or delete on public.forgestudio_renewals for each row execute function public.guard_forgestudio_renewal();

create function public.begin_forgestudio_renewal(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb,p_credential_fingerprint text,p_credentials jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;request public.forgestudio_renewals;connection public.social_connections;grant_request public.forgestudio_authorizations;organization uuid;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'credentials.renewal_requested',p_payload);if response->>'state' not in('new','replayed') then return response;end if;
 select * into request from public.forgestudio_renewals where id=p_id;
 if found then return jsonb_build_object('state',request.state,'renewalId',request.id,'connectionId',request.connection_id,'reason',request.reason);end if;
 if (p_payload-'connectionId'-'expectedVersion'-'reason')<>'{}'::jsonb or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Review the exact account and renewal reason';end if;
 select * into connection from public.social_connections where id=(p_payload->>'connectionId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if connection.security_version is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_connection"}';end if;
 select * into request from public.forgestudio_renewals where connection_id=connection.id and connection_version=connection.security_version;
 if found then return jsonb_build_object('state',request.state,'renewalId',request.id,'connectionId',request.connection_id,'reason',request.reason);end if;
 if connection.is_active is not true or connection.disconnected_at is not null or connection.permission_evidence->>'source' is distinct from 'provider_response' or connection.permission_evidence->>'expiryKnown' is distinct from 'true' then return '{"state":"reauthorization_required"}';end if;
 select * into grant_request from public.forgestudio_authorizations where id::text=connection.permission_evidence->>'authorizationId' and property_id=p_property_id and platform=connection.platform and state='completed';
 if not found or grant_request.input->>'credentialFingerprint' is distinct from p_credential_fingerprint then return '{"state":"app_authorization_changed"}';end if;
 if connection.platform not in('instagram','facebook','linkedin','tiktok','x') or(connection.platform in('instagram','facebook') and(coalesce(connection.access_token,'') not like 'encv1:%' or connection.token_expires_at is null or not isfinite(connection.token_expires_at) or connection.token_expires_at<=clock_timestamp())) or(connection.platform in('linkedin','tiktok','x') and(coalesce(connection.refresh_token,'') not like 'encv1:%' or connection.refresh_token_expires_at<=clock_timestamp())) then return '{"state":"reauthorization_required"}';end if;
 if jsonb_typeof(p_credentials) is distinct from 'object' or (p_credentials-'appId'-'appSecretEncrypted'-'redirectUri')<>'{}'::jsonb or coalesce(p_credentials->>'appSecretEncrypted','') not like 'encv1:%' or length(p_credentials::text)>12000 or p_credentials->>'appId' is distinct from grant_request.credentials->>'appId' or p_credentials->>'redirectUri' is distinct from grant_request.input->>'redirectUri' then raise exception 'Saved app credentials are required for renewal';end if;
 if exists(select 1 from public.social_auth_configs where property_id=p_property_id and platform=case when connection.platform in('instagram','facebook') then 'meta' else connection.platform end and is_configured is not true) then return '{"state":"app_authorization_changed"}';end if;
 if exists(select 1 from public.social_publications p join public.shared_jobs j on j.id=p.shared_job_id where p.connection_id=connection.id and p.status='publishing' and j.lease_expires_at>clock_timestamp()) then return '{"state":"publication_in_progress"}';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.forgestudio_renewals(id,property_id,org_id,actor_id,connection_id,connection_version,platform,input,input_hash,snapshot,credentials)
 values(p_id,p_property_id,organization,p_actor_id,connection.id,connection.security_version,connection.platform,p_payload,public.crm_configuration_hash(p_payload),jsonb_build_object('identity',public.forgestudio_social_identity(p_property_id,connection.platform)-'connections','connection',public.forgestudio_connection_summary(connection),'credentialFingerprint',p_credential_fingerprint),p_credentials||jsonb_build_object('accessTokenEncrypted',connection.access_token,'refreshTokenEncrypted',connection.refresh_token,'pageAccessTokenEncrypted',connection.page_access_token,'accountId',connection.account_id,'pageId',connection.page_id,'refreshExpiresAt',connection.refresh_token_expires_at)) returning * into request;
 perform public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'credentials.renewal_requested',p_payload,public.forgestudio_connection_summary(connection),jsonb_build_object('renewalId',p_id,'state','exchanging'),jsonb_build_object('renewalId',p_id,'connectionId',connection.id,'connectionVersion',connection.security_version,'publicationStarted',false));
 return jsonb_build_object('state','exchange_once','renewalId',p_id,'claimToken',request.claim_token,'platform',request.platform,'credentials',request.credentials);
end;$$;

create function public.finish_forgestudio_renewal(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare request public.forgestudio_renewals;connection public.social_connections;account jsonb;next_state text:='held';why text:='Renewal could not be confirmed. Start fresh authorization.';required text[];granted text[];event_id uuid;event_result jsonb;access_expiry timestamptz;refresh_expiry timestamptz;valid_expiry boolean:=true;begin
 select * into request from public.forgestudio_renewals where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(request.property_id::text,12));select * into request from public.forgestudio_renewals where id=p_id for update;
 if p_claim_token is null or request.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if request.result is not null then if request.result_hash=public.crm_configuration_hash(p_result) then return jsonb_build_object('state','replayed','renewalState',request.state,'reason',request.reason);end if;return '{"state":"result_conflict"}';end if;
 if request.state<>'exchanging' or jsonb_typeof(p_result) is distinct from 'object' or (p_result-'status'-'observedAt'-'accounts'-'reason'-'tokenReceipt')<>'{}'::jsonb or length(p_result::text)>524288 or coalesce(p_result->>'status','') not in('observed','failed','uncertain') or coalesce(p_result->>'observedAt','')='' then raise exception 'Invalid saved renewal result';end if;
 if not isfinite((p_result->>'observedAt')::timestamptz) or(p_result->>'observedAt')::timestamptz<request.created_at-interval '1 minute' or(p_result->>'observedAt')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'Invalid renewal observation time';end if;
 select * into connection from public.social_connections where id=request.connection_id for update;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=request.property_id and p.org_id=request.org_id and u.id=request.actor_id and u.role in('admin','manager')) or connection.security_version<>request.connection_version or request.snapshot->'identity' is distinct from(public.forgestudio_social_identity(request.property_id,request.platform)-'connections') or connection.is_active is not true or connection.disconnected_at is not null then why:='The account or app changed during renewal. Its later state was preserved.';
 elsif p_result->>'status'='observed' and jsonb_typeof(p_result->'accounts')='array' and jsonb_array_length(p_result->'accounts')=1 then
  account:=p_result->'accounts'->0;
  required:=case request.platform when 'facebook' then array['pages_show_list','pages_read_engagement','pages_manage_posts'] when 'instagram' then array['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement'] when 'linkedin' then array['openid','profile','w_member_social'] when 'tiktok' then array['user.info.basic','video.publish'] when 'x' then array['tweet.read','tweet.write','users.read'] end;
  if jsonb_typeof(account->'scopes')='array' and jsonb_array_length(account->'scopes') between 1 and 100 and not exists(select 1 from jsonb_array_elements(account->'scopes') v where jsonb_typeof(v)<>'string' or length(v#>>'{}') not between 1 and 200) then granted:=array(select jsonb_array_elements_text(account->'scopes'));end if;
  begin
   access_expiry:=nullif(account->>'expiresAt','')::timestamptz;refresh_expiry:=nullif(account->>'refreshExpiresAt','')::timestamptz;
   valid_expiry:=access_expiry is not null and isfinite(access_expiry) and access_expiry>clock_timestamp()+interval '10 minutes' and access_expiry<=clock_timestamp()+interval '366 days' and(refresh_expiry is null or(isfinite(refresh_expiry) and refresh_expiry>clock_timestamp() and refresh_expiry<=clock_timestamp()+interval '366 days'));
  exception when invalid_datetime_format or datetime_field_overflow then valid_expiry:=false;end;
  if jsonb_typeof(account)='object' and(account-'platform'-'accountId'-'accountName'-'accountUsername'-'accessTokenEncrypted'-'refreshTokenEncrypted'-'pageAccessTokenEncrypted'-'pageId'-'expiresAt'-'refreshExpiresAt'-'scopes'-'permissionEvidence')='{}'::jsonb and valid_expiry and account->>'accountId' is not distinct from connection.account_id and account->>'platform' is not distinct from request.platform and required<@granted and coalesce(account->>'accessTokenEncrypted','') like 'encv1:%' and length(account->>'accessTokenEncrypted')<20000 and account->'permissionEvidence'->>'source'='provider_response' and account->'permissionEvidence'->>'expiryKnown'='true' and ((account->'permissionEvidence')-'source'-'expiryKnown')='{}'::jsonb and (request.platform not in('instagram','facebook') or (account->>'pageId' is not distinct from connection.page_id and coalesce(account->>'pageAccessTokenEncrypted','') like 'encv1:%' and length(account->>'pageAccessTokenEncrypted')<20000)) and (request.platform in('instagram','facebook') or coalesce(account->>'refreshTokenEncrypted','') like 'encv1:%' and length(account->>'refreshTokenEncrypted')<20000) then
   update public.social_connections set access_token=account->>'accessTokenEncrypted',refresh_token=account->>'refreshTokenEncrypted',page_access_token=account->>'pageAccessTokenEncrypted',token_expires_at=access_expiry,refresh_token_expires_at=refresh_expiry,scopes=granted,permission_evidence=jsonb_build_object('source','provider_response','authorizationId',connection.permission_evidence->>'authorizationId','renewalId',request.id,'expiryKnown',true,'observedAt',p_result->>'observedAt'),last_error=null,error_count=0,updated_at=clock_timestamp() where id=connection.id;
   next_state:='completed';why:=null;
  else why:='Renewed account identity, permissions or expiry need fresh authorization.';end if;
 end if;
 update public.forgestudio_renewals set state=next_state,result=p_result,result_hash=public.crm_configuration_hash(p_result),reason=why,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=request.id;
 -- The private provider receipt is retained even if the original operator has since lost access.
 if exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=request.property_id and p.org_id=request.org_id and u.id=request.actor_id) then
  event_id:=md5('studio-renewal-result:'||request.id::text)::uuid;
  event_result:=public.append_shared_action_event(event_id,event_id,request.property_id,request.actor_id,'forgestudio','studio.credentials.renewal_completed','server_confirmed',case when next_state='completed' then 'succeeded' else 'failed' end,jsonb_build_object('renewalId',request.id,'origin','provider_result'),jsonb_build_object('connectionId',request.connection_id,'version',request.connection_version),jsonb_build_object('connectionId',request.connection_id,'state',next_state),jsonb_build_object('renewalId',request.id,'connectionId',request.connection_id,'state',next_state,'reason',why,'origin','provider_result','requestedBy',request.actor_id,'publicationStarted',false));
  if event_result->>'state' not in('recorded','replayed') then raise exception 'Renewal action evidence could not be saved';end if;
 end if;
 return jsonb_build_object('state','saved','renewalState',next_state,'reason',why);
end;$$;

create or replace function public.guard_forgestudio_connection() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Disconnect the account while retaining publication history';end if;
 if(new.id,new.property_id,new.platform,new.account_id) is distinct from(old.id,old.property_id,old.platform,old.account_id) then raise exception 'Social destination identity cannot change';end if;
 if(new.is_active,new.access_token,new.refresh_token,new.page_access_token,new.page_id,new.token_expires_at,new.scopes,new.disconnected_at,new.permission_evidence,new.refresh_token_expires_at) is distinct from(old.is_active,old.access_token,old.refresh_token,old.page_access_token,old.page_id,old.token_expires_at,old.scopes,old.disconnected_at,old.permission_evidence,old.refresh_token_expires_at) then new.security_version:=old.security_version+1;else new.security_version:=old.security_version;end if;
 return new;
end;$$;
create or replace function public.forgestudio_connection_summary(p_row public.social_connections) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'platform',p_row.platform,'accountId',p_row.account_id,'accountName',p_row.account_name,'accountUsername',p_row.account_username,'active',p_row.is_active,'version',p_row.security_version,'expiresAt',p_row.token_expires_at,'refreshExpiresAt',p_row.refresh_token_expires_at,'disconnectedAt',p_row.disconnected_at,'scopes',p_row.scopes,'permissionEvidence',case when p_row.permission_evidence is null then null else jsonb_build_object('source',p_row.permission_evidence->>'source','observedAt',p_row.permission_evidence->>'observedAt','expiryKnown',p_row.permission_evidence->'expiryKnown') end);
$$;
create or replace function public.apply_forgestudio_authorization(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;request public.forgestudio_authorizations;account jsonb;account_id_value text;connection public.social_connections;selected jsonb:=p_payload->'accountIds';required text[];granted text[];applied uuid[]:='{}';before_ids uuid[]:='{}';begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'authorization.applied',p_payload);if response->>'state'<>'new' then return response;end if;
 if jsonb_typeof(selected) is distinct from 'array' or jsonb_array_length(selected) not between 1 and 100 or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Choose accounts and record the review reason';end if;
 if exists(select 1 from jsonb_array_elements(selected) where jsonb_typeof(value)<>'string') or (select count(*)<>count(distinct value) from jsonb_array_elements_text(selected)) then raise exception 'An account may only be selected once';end if;
 select * into request from public.forgestudio_authorizations where id=(p_payload->>'authorizationId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if request.decision_version is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_authorization"}';end if;
 if request.state<>'review_required' then return '{"state":"authorization_closed"}';end if;
 if request.snapshot is distinct from public.forgestudio_social_identity(p_property_id,request.platform) then return '{"state":"authorization_context_changed"}';end if;
 required:=case request.platform when 'facebook' then array['pages_show_list','pages_read_engagement','pages_manage_posts'] when 'instagram' then array['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement'] when 'linkedin' then array['openid','profile','w_member_social'] when 'tiktok' then array['user.info.basic','video.publish'] when 'x' then array['tweet.read','tweet.write','users.read'] end;
 -- Validate every selected grant before touching any account.
 for account_id_value in select value from jsonb_array_elements_text(selected) loop
  select value into account from jsonb_array_elements(request.result->'accounts') where value->>'accountId'=account_id_value;
  if account is null or account_id_value is null or length(account_id_value) not between 1 and 256 or account_id_value!~'^[a-zA-Z0-9_.:@-]+$' or account->>'platform' is distinct from request.platform or jsonb_typeof(account->'scopes') is distinct from 'array' or coalesce(account->>'accessTokenEncrypted','') not like 'encv1:%' or length(account->>'accessTokenEncrypted')>20000 or (account-'platform'-'accountId'-'accountName'-'accountUsername'-'accessTokenEncrypted'-'refreshTokenEncrypted'-'pageAccessTokenEncrypted'-'pageId'-'expiresAt'-'refreshExpiresAt'-'scopes'-'permissionEvidence')<>'{}'::jsonb or account->'permissionEvidence'->>'source' is distinct from 'provider_response' or account->'permissionEvidence'->>'expiryKnown' is distinct from 'true' then return '{"state":"grant_review_required"}';end if;
  granted:=array(select jsonb_array_elements_text(account->'scopes'));
  if not required<@granted or nullif(account->>'expiresAt','') is null or (account->>'expiresAt')::timestamptz<=clock_timestamp()+interval '10 minutes' then return '{"state":"grant_review_required"}';end if;
  if request.platform in('instagram','facebook') and (coalesce(account->>'pageAccessTokenEncrypted','') not like 'encv1:%' or length(coalesce(account->>'pageId',''))=0) then return '{"state":"grant_review_required"}';end if;
 end loop;
 for account_id_value in select value from jsonb_array_elements_text(selected) loop
  select value into account from jsonb_array_elements(request.result->'accounts') where value->>'accountId'=account_id_value;
  select * into connection from public.social_connections where property_id=p_property_id and platform=request.platform and account_id=account_id_value for update;
  if found then before_ids:=array_append(before_ids,connection.id);end if;
  insert into public.social_connections(property_id,platform,account_id,account_name,account_username,account_avatar_url,access_token,refresh_token,page_access_token,page_id,token_expires_at,refresh_token_expires_at,scopes,is_active,connected_by,raw_profile,permission_evidence)
  values(p_property_id,request.platform,account_id_value,left(account->>'accountName',256),left(account->>'accountUsername',256),null,account->>'accessTokenEncrypted',account->>'refreshTokenEncrypted',account->>'pageAccessTokenEncrypted',account->>'pageId',nullif(account->>'expiresAt','')::timestamptz,nullif(account->>'refreshExpiresAt','')::timestamptz,array(select jsonb_array_elements_text(account->'scopes')),true,p_actor_id,'{}',jsonb_build_object('source','provider_response','authorizationId',request.id,'expiryKnown',true,'observedAt',request.result->>'observedAt'))
  on conflict(property_id,platform,account_id) where account_id is not null do update set account_name=excluded.account_name,account_username=excluded.account_username,account_avatar_url=excluded.account_avatar_url,access_token=excluded.access_token,refresh_token=excluded.refresh_token,page_access_token=excluded.page_access_token,page_id=excluded.page_id,token_expires_at=excluded.token_expires_at,refresh_token_expires_at=excluded.refresh_token_expires_at,scopes=excluded.scopes,is_active=true,connected_by=excluded.connected_by,raw_profile='{}',permission_evidence=excluded.permission_evidence,disconnected_at=null,last_error=null,error_count=0,updated_at=clock_timestamp() returning * into connection;
  applied:=array_append(applied,connection.id);
 end loop;
 update public.forgestudio_authorizations set state='completed',applied_connection_ids=applied,decision_version=decision_version+1,updated_at=clock_timestamp() where id=request.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'authorization.applied',p_payload,jsonb_build_object('authorizationId',request.id,'existingConnectionIds',before_ids),jsonb_build_object('authorizationId',request.id,'connectionIds',applied),jsonb_build_object('authorizationId',request.id,'version',request.decision_version+1,'connectionIds',applied,'selectedCount',cardinality(applied),'publicationStarted',false));
end;$$;
create or replace function public.forgestudio_social_grant_ready(p_row public.social_connections) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(not exists(select 1 from public.forgestudio_renewals where connection_id=p_row.id and connection_version=p_row.security_version and state in('exchanging','held')) and p_row.is_active and p_row.disconnected_at is null and p_row.permission_evidence->>'source'='provider_response' and p_row.permission_evidence->>'expiryKnown'='true' and p_row.token_expires_at>clock_timestamp()+interval '10 minutes' and p_row.access_token like 'encv1:%' and
 case p_row.platform when 'facebook' then array['pages_show_list','pages_read_engagement','pages_manage_posts']<@p_row.scopes and p_row.page_access_token like 'encv1:%' and p_row.page_id is not null
 when 'instagram' then array['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement']<@p_row.scopes and p_row.page_access_token like 'encv1:%' and p_row.page_id is not null
 when 'linkedin' then array['openid','profile','w_member_social']<@p_row.scopes
 when 'tiktok' then array['user.info.basic','video.publish']<@p_row.scopes
 when 'x' then array['tweet.read','tweet.write','users.read']<@p_row.scopes else false end,false);
$$;
revoke all on function public.guard_forgestudio_renewal(),public.begin_forgestudio_renewal(uuid,uuid,uuid,jsonb,text,jsonb),public.finish_forgestudio_renewal(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_forgestudio_renewal(),public.begin_forgestudio_renewal(uuid,uuid,uuid,jsonb,text,jsonb),public.finish_forgestudio_renewal(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
