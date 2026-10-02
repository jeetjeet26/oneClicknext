create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 origin:=case when p_action='studio.media.completed' then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- Keep destinations and their publication history when retiring local access.
alter table public.social_connections add column security_version integer not null default 1 check(security_version>0),add column disconnected_at timestamptz,add column permission_evidence jsonb;
alter table public.social_auth_configs add column configuration_version integer not null default 1 check(configuration_version>0);
revoke all on public.social_connections,public.social_auth_configs from public,anon,authenticated;
create function public.guard_forgestudio_connection() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Disconnect the account while retaining publication history';end if;
 if(new.id,new.property_id,new.platform,new.account_id) is distinct from(old.id,old.property_id,old.platform,old.account_id) then raise exception 'Social destination identity cannot change';end if;
 if(new.is_active,new.access_token,new.refresh_token,new.page_access_token,new.page_id,new.token_expires_at,new.scopes,new.disconnected_at,new.permission_evidence) is distinct from(old.is_active,old.access_token,old.refresh_token,old.page_access_token,old.page_id,old.token_expires_at,old.scopes,old.disconnected_at,old.permission_evidence) then new.security_version:=old.security_version+1;else new.security_version:=old.security_version;end if;
 return new;
end;$$;
create trigger forgestudio_connection_guard before update or delete on public.social_connections for each row execute function public.guard_forgestudio_connection();
create function public.guard_forgestudio_auth_config() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Disable the saved app configuration instead of deleting its history';end if;
 if(new.id,new.property_id,new.platform) is distinct from(old.id,old.property_id,old.platform) then raise exception 'App configuration identity cannot change';end if;
 new.configuration_version:=old.configuration_version+1;new.updated_at:=clock_timestamp();return new;
end;$$;
create trigger forgestudio_auth_config_guard before update or delete on public.social_auth_configs for each row execute function public.guard_forgestudio_auth_config();
create function public.forgestudio_connection_summary(p_row public.social_connections) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'platform',p_row.platform,'accountId',p_row.account_id,'accountName',p_row.account_name,'accountUsername',p_row.account_username,'active',p_row.is_active,'version',p_row.security_version,'expiresAt',p_row.token_expires_at,'disconnectedAt',p_row.disconnected_at,'scopes',p_row.scopes,'permissionEvidence',case when p_row.permission_evidence is null then null else jsonb_build_object('source',p_row.permission_evidence->>'source','observedAt',p_row.permission_evidence->>'observedAt','expiryKnown',p_row.permission_evidence->'expiryKnown') end);
$$;
create function public.forgestudio_social_identity(p_property_id uuid,p_platform text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('propertyOrg',(select org_id from public.properties where id=p_property_id),'config',coalesce((select jsonb_build_object('id',id,'version',configuration_version,'configured',is_configured) from public.social_auth_configs where property_id=p_property_id and platform=case when p_platform in('facebook','instagram') then 'meta' else p_platform end),'null'::jsonb),'connections',coalesce((select jsonb_agg(jsonb_build_object('id',id,'version',security_version) order by id) from public.social_connections where property_id=p_property_id and platform=p_platform),'[]'::jsonb));
$$;
create table public.forgestudio_authorizations(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),platform text not null check(platform in('instagram','facebook','linkedin','tiktok','x')),
 state text not null default 'pending' check(state in('pending','exchanging','review_required','completed','cancelled','failed','held')),
 input jsonb not null,input_hash text not null,snapshot jsonb not null,credentials jsonb not null,
 claim_token uuid,code_hash text,claimed_at timestamptz,result jsonb,result_hash text,reason text,
 decision_version integer not null default 1,applied_connection_ids uuid[],created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '15 minutes',updated_at timestamptz not null default clock_timestamp()
);
create index forgestudio_authorizations_property on public.forgestudio_authorizations(property_id,created_at desc,id);
create index forgestudio_authorizations_org on public.forgestudio_authorizations(org_id);
create index forgestudio_authorizations_actor on public.forgestudio_authorizations(actor_id);
alter table public.forgestudio_authorizations enable row level security;
create policy forgestudio_authorizations_service on public.forgestudio_authorizations for all to service_role using(true) with check(true);
revoke all on public.forgestudio_authorizations from public,anon,authenticated;
grant all on public.forgestudio_authorizations to service_role;
create function public.guard_forgestudio_authorization() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Authorization history is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.platform,new.input,new.input_hash,new.snapshot,new.credentials,new.created_at,new.expires_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.platform,old.input,old.input_hash,old.snapshot,old.credentials,old.created_at,old.expires_at) then raise exception 'Authorization request identity is immutable';end if;
 if old.result is not null and (new.result,new.result_hash) is distinct from(old.result,old.result_hash) then raise exception 'Authorization result is immutable';end if;
 if old.state in('completed','cancelled','failed','held') and new.state<>old.state then raise exception 'Closed authorization cannot be reopened';end if;
 return new;
end;$$;
create trigger forgestudio_authorization_guard before update or delete on public.forgestudio_authorizations for each row execute function public.guard_forgestudio_authorization();

create function public.save_forgestudio_social_config(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb,p_encrypted_secret text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;prior public.social_auth_configs;saved public.social_auth_configs;operation text:=p_payload->>'action';platform_name text:=p_payload->>'platform';begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 if coalesce(operation,'') not in('save','disable') or coalesce(platform_name,'') not in('meta','linkedin','tiktok','x') or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload-'action'-'platform'-'expectedVersion'-'appId'-'secretFingerprint')<>'{}'::jsonb or (p_payload->>'expectedVersion')::numeric<0 or (p_payload->>'expectedVersion')::numeric<>trunc((p_payload->>'expectedVersion')::numeric) then raise exception 'Invalid app configuration decision';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'app_configuration.'||operation,p_payload);if response->>'state'<>'new' then return response;end if;
 select * into prior from public.social_auth_configs where property_id=p_property_id and platform=platform_name for update;
 if coalesce(prior.configuration_version,0) is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_configuration"}';end if;
 if operation='save' and (length(trim(coalesce(p_payload->>'appId',''))) not between 1 and 256 or coalesce(p_payload->>'secretFingerprint','')!~'^[a-f0-9]{64}$' or p_encrypted_secret is null or p_encrypted_secret not like 'encv1:%' or length(p_encrypted_secret)>8192) then raise exception 'Encrypted app credentials required';end if;
 insert into public.social_auth_configs(property_id,platform,app_id,app_secret_encrypted,is_configured,redirect_uri)
 values(p_property_id,platform_name,case when operation='save' then p_payload->>'appId' else coalesce(prior.app_id,'disabled') end,case when operation='save' then p_encrypted_secret else '' end,operation='save',null)
 on conflict(property_id,platform) do update set app_id=excluded.app_id,app_secret_encrypted=excluded.app_secret_encrypted,is_configured=excluded.is_configured,redirect_uri=null,last_verified_at=null returning * into saved;
 update public.forgestudio_authorizations set state='held',reason='app_configuration_changed',decision_version=decision_version+1,updated_at=clock_timestamp() where property_id=p_property_id and platform in(select value from unnest(case when platform_name='meta' then array['instagram','facebook'] else array[platform_name] end) value) and state in('pending','exchanging','review_required');
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'app_configuration.'||operation,p_payload,jsonb_build_object('appId',prior.app_id,'configured',prior.is_configured,'version',coalesce(prior.configuration_version,0)),jsonb_build_object('appId',saved.app_id,'configured',saved.is_configured,'version',saved.configuration_version),jsonb_build_object('appId',saved.app_id,'configured',saved.is_configured,'version',saved.configuration_version,'platform',saved.platform,'remoteRevocation',false));
end;$$;

create function public.disconnect_forgestudio_connection(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;prior public.social_connections;saved public.social_connections;pub public.social_publications;cancelled uuid[]:='{}';pending_writes integer;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'connection.disconnected',p_payload);if response->>'state'<>'new' then return response;end if;
 if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'A disconnection reason is required';end if;
 select * into prior from public.social_connections where id=(p_payload->>'connectionId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if prior.security_version is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_connection"}';end if;
 if not coalesce(prior.is_active,false) and prior.disconnected_at is not null then return '{"state":"already_disconnected"}';end if;
 -- Invalidate local work which has not received a saved provider-write intent.
 for pub in select p.* from public.social_publications p where p.connection_id=prior.id and p.status in('scheduled','queued') and not exists(select 1 from public.forgestudio_publication_receipts r where r.publication_id=p.id and r.kind='write_intent') order by p.id loop
  perform 1 from public.shared_jobs where id=pub.shared_job_id for update;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='social_connection_disconnected',lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=pub.shared_job_id;
  update public.shared_action_attempts set lifecycle_status='cancelled',execution_status='cancelled',error_message='Account disconnected before remote execution',updated_at=clock_timestamp() where id=pub.shared_action_attempt_id;
  update public.social_publications set status='cancelled',cancelled_at=clock_timestamp(),updated_at=clock_timestamp() where id=pub.id;
  cancelled:=array_append(cancelled,pub.id);perform public.refresh_forgestudio_package_status(pub.package_id);
 end loop;
 select count(*) into pending_writes from public.social_publications p where p.connection_id=prior.id and p.status in('publishing','reconciling');
 update public.social_connections set is_active=false,access_token=null,user_access_token=null,page_access_token=null,refresh_token=null,raw_profile='{}',token_expires_at=null,disconnected_at=clock_timestamp(),last_error='Disconnected locally. Provider consent has not been revoked.',updated_at=clock_timestamp() where id=prior.id returning * into saved;
 update public.forgestudio_authorizations set state='held',reason='connection_disconnected',decision_version=decision_version+1,updated_at=clock_timestamp() where property_id=p_property_id and platform=prior.platform and state in('pending','exchanging','review_required');
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'connection.disconnected',p_payload,public.forgestudio_connection_summary(prior),public.forgestudio_connection_summary(saved),jsonb_build_object('connection',public.forgestudio_connection_summary(saved),'connectionId',saved.id,'cancelledCount',cardinality(cancelled),'publications',to_jsonb(cancelled),'inFlightCount',pending_writes,'remoteRevocation',false));
end;$$;

create function public.begin_forgestudio_authorization(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb,p_credentials jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;organization uuid;request public.forgestudio_authorizations;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'authorization.started',p_payload);if response->>'state' not in('new','replayed') then return response;end if;
 select * into request from public.forgestudio_authorizations where id=p_id;
 if found then return jsonb_build_object('state',request.state,'authorizationId',request.id,'createdAt',request.created_at,'expiresAt',request.expires_at,'credentials',request.credentials);end if;
 if coalesce(p_payload->>'platform','') not in('instagram','facebook','linkedin','tiktok','x') or coalesce(p_payload->>'credentialFingerprint','')!~'^[a-f0-9]{64}$' or jsonb_typeof(p_payload->'scopes') is distinct from 'array' or jsonb_array_length(p_payload->'scopes') not between 1 and 20 or coalesce(p_payload->>'redirectUri','')!~'^https?://' or length(p_payload->>'redirectUri')>2000 or jsonb_typeof(p_credentials) is distinct from 'object' or coalesce(p_credentials->>'appSecretEncrypted','') not like 'encv1:%' or length(p_credentials::text)>12000 or length(trim(coalesce(p_credentials->>'appId',''))) not between 1 and 256 or (p_credentials-'appId'-'appSecretEncrypted'-'codeVerifierEncrypted')<>'{}'::jsonb or (p_payload-'platform'-'credentialFingerprint'-'scopes'-'redirectUri')<>'{}'::jsonb then raise exception 'Saved authorization inputs are required';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.forgestudio_authorizations(id,property_id,org_id,actor_id,platform,input,input_hash,snapshot,credentials) values(p_id,p_property_id,organization,p_actor_id,p_payload->>'platform',p_payload,public.crm_configuration_hash(p_payload),public.forgestudio_social_identity(p_property_id,p_payload->>'platform'),p_credentials) returning * into request;
 perform public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'authorization.started',p_payload,null,jsonb_build_object('authorizationId',p_id,'platform',request.platform,'status','pending'),jsonb_build_object('authorizationId',p_id,'createdAt',request.created_at,'expiresAt',request.expires_at));
 return jsonb_build_object('state','pending','authorizationId',p_id,'createdAt',request.created_at,'expiresAt',request.expires_at,'credentials',request.credentials);
end;$$;

create function public.claim_forgestudio_authorization(p_id uuid,p_property_id uuid,p_actor_id uuid,p_platform text,p_code_hash text,p_credential_fingerprint text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare request public.forgestudio_authorizations;begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into request from public.forgestudio_authorizations where id=p_id and property_id=p_property_id and actor_id=p_actor_id and platform=p_platform for update;if not found then return '{"state":"not_found"}';end if;
 if request.state<>'pending' then return jsonb_build_object('state',request.state,'authorizationId',request.id);end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=request.org_id and u.id=p_actor_id and u.role in('admin','manager')) or request.snapshot is distinct from public.forgestudio_social_identity(p_property_id,p_platform) or request.input->>'credentialFingerprint' is distinct from p_credential_fingerprint or request.expires_at<=clock_timestamp() then
  update public.forgestudio_authorizations set state='held',reason='authorization_context_changed_or_expired',updated_at=clock_timestamp(),decision_version=decision_version+1 where id=p_id;return '{"state":"held"}';
 end if;
 if coalesce(p_code_hash,'')!~'^[a-f0-9]{64}$' then raise exception 'Authorization code fingerprint is required';end if;
 update public.forgestudio_authorizations set state='exchanging',claim_token=gen_random_uuid(),code_hash=p_code_hash,claimed_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id returning * into request;
 return jsonb_build_object('state','exchange_once','authorizationId',p_id,'claimToken',request.claim_token,'credentials',request.credentials,'input',request.input);
end;$$;

create function public.finish_forgestudio_authorization(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare request public.forgestudio_authorizations;next_state text;begin
 select * into request from public.forgestudio_authorizations where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(request.property_id::text,12));select * into request from public.forgestudio_authorizations where id=p_id for update;
 if p_claim_token is null or request.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if request.result is not null then if request.result_hash=public.crm_configuration_hash(p_result) then return jsonb_build_object('state','replayed','authorizationState',request.state);end if;return '{"state":"result_conflict"}';end if;
 if request.state not in('exchanging','held','cancelled') or jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>524288 or coalesce(p_result->>'status','') not in('observed','failed','uncertain') or (p_result-'status'-'observedAt'-'accounts'-'reason'-'tokenReceipt')<>'{}'::jsonb or coalesce(p_result->>'observedAt','')='' then raise exception 'Invalid authorization result';end if;
 if (p_result->>'observedAt')::timestamptz<request.claimed_at-interval '1 minute' or (p_result->>'observedAt')::timestamptz>clock_timestamp()+interval '1 minute' then raise exception 'Invalid observation timestamp';end if;
 if p_result->>'status'='observed' and (jsonb_typeof(p_result->'accounts') is distinct from 'array' or jsonb_array_length(p_result->'accounts') not between 1 and 100) then raise exception 'Authorization accounts are required';end if;
 if p_result->>'status'='observed' and (select count(*)<>count(distinct value->>'accountId') from jsonb_array_elements(p_result->'accounts')) then raise exception 'Duplicate or missing account identity';end if;
 next_state:=case when request.state in('held','cancelled') then request.state when request.snapshot is distinct from public.forgestudio_social_identity(request.property_id,request.platform) or not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=request.property_id and p.org_id=request.org_id and u.id=request.actor_id and u.role in('admin','manager')) then 'held' when p_result->>'status'='observed' then 'review_required' when p_result->>'status'='failed' then 'failed' else 'held' end;
 update public.forgestudio_authorizations set result=p_result,result_hash=public.crm_configuration_hash(p_result),state=next_state,reason=case when next_state='held' then 'Saved authorization result needs review or new consent' else null end,decision_version=decision_version+1,updated_at=clock_timestamp() where id=p_id;
 return jsonb_build_object('state','saved','authorizationState',next_state);
end;$$;

create function public.cancel_forgestudio_authorization(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;request public.forgestudio_authorizations;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 if length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'A cancellation reason is required';end if;
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'authorization.cancelled',p_payload);if response->>'state'<>'new' then return response;end if;
 select * into request from public.forgestudio_authorizations where id=(p_payload->>'authorizationId')::uuid and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if request.decision_version is distinct from(p_payload->>'expectedVersion')::integer then return '{"state":"stale_authorization"}';end if;
 if request.state not in('pending','exchanging','review_required') then return '{"state":"authorization_closed"}';end if;
 update public.forgestudio_authorizations set state='cancelled',reason='operator_cancelled',decision_version=decision_version+1,updated_at=clock_timestamp() where id=request.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'authorization.cancelled',p_payload,jsonb_build_object('authorizationId',request.id,'state',request.state),jsonb_build_object('authorizationId',request.id,'state','cancelled'),jsonb_build_object('authorizationId',request.id,'version',request.decision_version+1,'remoteRevocation',false));
end;$$;

create function public.apply_forgestudio_authorization(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
  if account is null or account_id_value is null or length(account_id_value) not between 1 and 256 or account_id_value!~'^[a-zA-Z0-9_.:@-]+$' or account->>'platform' is distinct from request.platform or jsonb_typeof(account->'scopes') is distinct from 'array' or coalesce(account->>'accessTokenEncrypted','') not like 'encv1:%' or length(account->>'accessTokenEncrypted')>20000 or (account-'platform'-'accountId'-'accountName'-'accountUsername'-'accessTokenEncrypted'-'refreshTokenEncrypted'-'pageAccessTokenEncrypted'-'pageId'-'expiresAt'-'scopes'-'permissionEvidence')<>'{}'::jsonb or account->'permissionEvidence'->>'source' is distinct from 'provider_response' or account->'permissionEvidence'->>'expiryKnown' is distinct from 'true' then return '{"state":"grant_review_required"}';end if;
  granted:=array(select jsonb_array_elements_text(account->'scopes'));
  if not required<@granted or nullif(account->>'expiresAt','') is null or (account->>'expiresAt')::timestamptz<=clock_timestamp()+interval '10 minutes' then return '{"state":"grant_review_required"}';end if;
  if request.platform in('instagram','facebook') and (coalesce(account->>'pageAccessTokenEncrypted','') not like 'encv1:%' or length(coalesce(account->>'pageId',''))=0) then return '{"state":"grant_review_required"}';end if;
 end loop;
 for account_id_value in select value from jsonb_array_elements_text(selected) loop
  select value into account from jsonb_array_elements(request.result->'accounts') where value->>'accountId'=account_id_value;
  select * into connection from public.social_connections where property_id=p_property_id and platform=request.platform and account_id=account_id_value for update;
  if found then before_ids:=array_append(before_ids,connection.id);end if;
  insert into public.social_connections(property_id,platform,account_id,account_name,account_username,account_avatar_url,access_token,refresh_token,page_access_token,page_id,token_expires_at,scopes,is_active,connected_by,raw_profile,permission_evidence)
  values(p_property_id,request.platform,account_id_value,left(account->>'accountName',256),left(account->>'accountUsername',256),null,account->>'accessTokenEncrypted',account->>'refreshTokenEncrypted',account->>'pageAccessTokenEncrypted',account->>'pageId',nullif(account->>'expiresAt','')::timestamptz,array(select jsonb_array_elements_text(account->'scopes')),true,p_actor_id,'{}',jsonb_build_object('source','provider_response','authorizationId',request.id,'expiryKnown',true,'observedAt',request.result->>'observedAt'))
  on conflict(property_id,platform,account_id) where account_id is not null do update set account_name=excluded.account_name,account_username=excluded.account_username,account_avatar_url=excluded.account_avatar_url,access_token=excluded.access_token,refresh_token=excluded.refresh_token,page_access_token=excluded.page_access_token,page_id=excluded.page_id,token_expires_at=excluded.token_expires_at,scopes=excluded.scopes,is_active=true,connected_by=excluded.connected_by,raw_profile='{}',permission_evidence=excluded.permission_evidence,disconnected_at=null,last_error=null,error_count=0,updated_at=clock_timestamp() returning * into connection;
  applied:=array_append(applied,connection.id);
 end loop;
 update public.forgestudio_authorizations set state='completed',applied_connection_ids=applied,decision_version=decision_version+1,updated_at=clock_timestamp() where id=request.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'authorization.applied',p_payload,jsonb_build_object('authorizationId',request.id,'existingConnectionIds',before_ids),jsonb_build_object('authorizationId',request.id,'connectionIds',applied),jsonb_build_object('authorizationId',request.id,'version',request.decision_version+1,'connectionIds',applied,'selectedCount',cardinality(applied),'publicationStarted',false));
end;$$;

-- A legacy active flag does not prove permission or access lifetime.
create function public.forgestudio_social_grant_ready(p_row public.social_connections) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(p_row.is_active and p_row.disconnected_at is null and p_row.permission_evidence->>'source'='provider_response' and p_row.permission_evidence->>'expiryKnown'='true' and p_row.token_expires_at>clock_timestamp()+interval '10 minutes' and p_row.access_token like 'encv1:%' and
 case p_row.platform when 'facebook' then array['pages_show_list','pages_read_engagement','pages_manage_posts']<@p_row.scopes and p_row.page_access_token like 'encv1:%' and p_row.page_id is not null
 when 'instagram' then array['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement']<@p_row.scopes and p_row.page_access_token like 'encv1:%' and p_row.page_id is not null
 when 'linkedin' then array['openid','profile','w_member_social']<@p_row.scopes
 when 'tiktok' then array['user.info.basic','video.publish']<@p_row.scopes
 when 'x' then array['tweet.read','tweet.write','users.read']<@p_row.scopes else false end,false);
$$;
revoke all on function public.forgestudio_social_grant_ready(public.social_connections) from public,anon,authenticated;
grant execute on function public.forgestudio_social_grant_ready(public.social_connections) to service_role;

create or replace function public.prepare_forgestudio_publication_write(p_job_id uuid,p_worker text,p_claim_id uuid,p_fingerprint text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare publication public.social_publications;job public.shared_jobs;revision public.social_content_revisions;pkg public.social_content_packages;variant public.social_content_variants;connection public.social_connections;source_check jsonb;fingerprint text;receipt public.forgestudio_publication_receipts;begin
 select * into publication from public.social_publications where shared_job_id=p_job_id;
 if not found then return '{"state":"publication_missing"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(publication.property_id::text,12));
 select * into job from public.shared_jobs where id=p_job_id for update;
 select * into publication from public.social_publications where id=publication.id for update;
 if job.domain<>'forgestudio.publication' or job.subject_id is distinct from publication.id::text or job.property_id is distinct from publication.property_id or job.org_id is distinct from publication.org_id then return '{"state":"job_mismatch"}';end if;
 if exists(select 1 from public.forgestudio_publication_receipts r where r.publication_id=publication.id and r.kind='write_intent') then return '{"state":"write_already_recorded"}';end if;
 if p_claim_id is null or nullif(p_worker,'') is null or job.lifecycle_status<>'running' or job.lease_owner is distinct from p_worker or job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp() then return '{"state":"lease_lost"}';end if;
 if publication.delivery_snapshot is null or publication.status not in('scheduled','queued') or exists(select 1 from public.social_publication_attempts where publication_id=publication.id) then return '{"state":"history_review_required"}';end if;
 select * into revision from public.social_content_revisions where id=publication.revision_id;
 select * into pkg from public.social_content_packages where id=publication.package_id;
 select * into variant from public.social_content_variants where id=publication.variant_id;
 select * into connection from public.social_connections where id=publication.connection_id for share;
 if revision.id is null or variant.id is null or revision.approval_status<>'approved' or pkg.current_revision_id is distinct from revision.id or revision.content_hash is distinct from publication.delivery_snapshot->>'contentHash' or public.crm_configuration_hash(to_jsonb(variant)) is distinct from publication.delivery_snapshot->>'variantHash' or variant.validation->'issues' is distinct from '[]'::jsonb then return '{"state":"approval_changed"}';end if;
 source_check:=public.check_forgestudio_sources(publication.property_id,revision.context_snapshot_id,revision.content);if source_check->>'state'<>'current' then return source_check;end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=publication.property_id and p.org_id=publication.org_id and u.id=revision.approved_by and u.role in('admin','manager')) or not exists(select 1 from public.profiles where id=publication.created_by and org_id=publication.org_id) then return '{"state":"access_changed"}';end if;
 if connection.id is null or connection.is_active is not true or connection.property_id is distinct from publication.property_id or connection.account_id is distinct from publication.delivery_snapshot->>'accountId' or connection.page_id is distinct from publication.delivery_snapshot->>'pageId' or connection.platform is distinct from publication.delivery_snapshot->>'platform' then return '{"state":"destination_changed"}';end if;
 if connection.token_expires_at is not null and connection.token_expires_at<=clock_timestamp()+interval '10 minutes' then return '{"state":"reconnect_required"}';end if;
 if not public.forgestudio_social_grant_ready(connection) then return '{"state":"grant_review_required"}';end if;
 fingerprint:=public.crm_configuration_hash(jsonb_build_object('snapshot',publication.delivery_snapshot,'accessToken',connection.access_token,'pageAccessToken',connection.page_access_token,'refreshToken',connection.refresh_token,'tokenExpiresAt',connection.token_expires_at,'securityVersion',connection.security_version));
 if p_fingerprint is null then return jsonb_build_object('state','prepared','fingerprint',fingerprint,'publication',to_jsonb(publication),'variant',to_jsonb(variant),'connection',to_jsonb(connection));end if;
 if p_fingerprint is distinct from fingerprint then return '{"state":"destination_changed"}';end if;
 insert into public.forgestudio_publication_receipts(property_id,publication_id,job_id,claim_id,worker_id,kind,evidence)
 values(publication.property_id,publication.id,job.id,p_claim_id,p_worker,'write_intent',jsonb_build_object('snapshot',publication.delivery_snapshot,'idempotencyKey','publication:'||publication.id,'origin','system_worker')) returning * into receipt;
 insert into public.social_publication_attempts(publication_id,org_id,property_id,shared_action_attempt_id,attempt_number,idempotency_key,status,request_summary)
 values(publication.id,publication.org_id,publication.property_id,publication.shared_action_attempt_id,job.attempt_count,'publication:'||publication.id,'running',jsonb_build_object('claimId',p_claim_id,'receiptId',receipt.id,'contentHash',revision.content_hash,'accountId',connection.account_id));
 update public.social_publications set status='publishing',attempt_count=job.attempt_count,updated_at=clock_timestamp() where id=publication.id;
 update public.shared_action_attempts set lifecycle_status='running',execution_status='executing',updated_at=clock_timestamp() where id=publication.shared_action_attempt_id;
 return jsonb_build_object('state','proceed_once','receiptId',receipt.id,'publicationId',publication.id,'idempotencyKey','publication:'||publication.id);
end;$$;
revoke all on function public.guard_forgestudio_connection(),public.guard_forgestudio_auth_config(),public.forgestudio_connection_summary(public.social_connections),public.forgestudio_social_identity(uuid,text),public.guard_forgestudio_authorization(),public.save_forgestudio_social_config(uuid,uuid,uuid,jsonb,text),public.disconnect_forgestudio_connection(uuid,uuid,uuid,jsonb),public.begin_forgestudio_authorization(uuid,uuid,uuid,jsonb,jsonb),public.claim_forgestudio_authorization(uuid,uuid,uuid,text,text,text),public.finish_forgestudio_authorization(uuid,uuid,jsonb),public.cancel_forgestudio_authorization(uuid,uuid,uuid,jsonb),public.apply_forgestudio_authorization(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_forgestudio_connection(),public.guard_forgestudio_auth_config(),public.forgestudio_connection_summary(public.social_connections),public.forgestudio_social_identity(uuid,text),public.guard_forgestudio_authorization(),public.save_forgestudio_social_config(uuid,uuid,uuid,jsonb,text),public.disconnect_forgestudio_connection(uuid,uuid,uuid,jsonb),public.begin_forgestudio_authorization(uuid,uuid,uuid,jsonb,jsonb),public.claim_forgestudio_authorization(uuid,uuid,uuid,text,text,text),public.finish_forgestudio_authorization(uuid,uuid,jsonb),public.cancel_forgestudio_authorization(uuid,uuid,uuid,jsonb),public.apply_forgestudio_authorization(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
