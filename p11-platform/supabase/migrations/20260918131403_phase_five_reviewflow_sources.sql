create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
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
 origin:=case when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
alter table public.reviewflow_config add column version integer not null default 1;
alter table public.reviewflow_config enable row level security;
revoke all on public.reviewflow_config from public,anon,authenticated;
grant all on public.reviewflow_config to service_role;
create function public.guard_reviewflow_configuration() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Review configuration history is retained';end if;
 if(new.id,new.property_id,new.created_at) is distinct from(old.id,old.property_id,old.created_at) then raise exception 'Review configuration identity is immutable';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_configuration_guard before update or delete on public.reviewflow_config for each row execute function public.guard_reviewflow_configuration();
create table public.reviewflow_configuration_revisions(id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,actor_id uuid not null references public.profiles(id),version integer not null,before_state jsonb,after_state jsonb not null,reason text not null,created_at timestamptz not null default clock_timestamp(),unique(property_id,version));
create index reviewflow_configuration_revision_actor on public.reviewflow_configuration_revisions(actor_id);
alter table public.reviewflow_configuration_revisions enable row level security;
revoke all on public.reviewflow_configuration_revisions from public,anon,authenticated;
grant all on public.reviewflow_configuration_revisions to service_role;
create policy reviewflow_configuration_revisions_service on public.reviewflow_configuration_revisions for all to service_role using(true) with check(true);
create function public.guard_reviewflow_configuration_revision() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Configuration revision evidence is immutable';
end$$;
create trigger reviewflow_configuration_revision_guard before update or delete on public.reviewflow_configuration_revisions for each row execute function public.guard_reviewflow_configuration_revision();
create function public.decide_reviewflow_configuration(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;existing public.reviewflow_config;saved public.reviewflow_config;before_value jsonb;after_value jsonb;expected integer;begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'configuration.saved',p_input);if result->>'state'<>'new' then return result;end if;
 expected:=(p_input->>'expectedVersion')::integer;
 if(p_input-'expectedVersion'-'defaultTone'-'propertyPersonality'-'reason')<>'{}'::jsonb or expected is null or expected<0 or coalesce(p_input->>'defaultTone','') not in('professional','empathetic','friendly','apologetic') or length(trim(coalesce(p_input->>'propertyPersonality','')))>2000 or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the supported response preferences and reason';end if;
 select * into existing from public.reviewflow_config where property_id=p_property_id for update;
 if coalesce(existing.version,0)<>expected then return '{"state":"stale_configuration"}';end if;
 before_value:=case when existing.id is null then null else jsonb_build_object('defaultTone',existing.default_tone,'propertyPersonality',existing.property_personality,'version',existing.version) end;
 if existing.id is null then insert into public.reviewflow_config(property_id,default_tone,property_personality,is_active,auto_respond_positive) values(p_property_id,p_input->>'defaultTone',nullif(trim(p_input->>'propertyPersonality'),''),false,false) returning * into saved;
 else update public.reviewflow_config set default_tone=p_input->>'defaultTone',property_personality=nullif(trim(p_input->>'propertyPersonality'),'') where id=existing.id returning * into saved;end if;
 after_value:=jsonb_build_object('defaultTone',saved.default_tone,'propertyPersonality',saved.property_personality,'version',saved.version);
 insert into public.reviewflow_configuration_revisions(id,property_id,actor_id,version,before_state,after_state,reason) values(p_id,p_property_id,p_actor_id,saved.version,before_value,after_value,p_input->>'reason');
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'configuration.saved',p_input,jsonb_build_object('version',coalesce(existing.version,0),'configurationHash',public.crm_configuration_hash(coalesce(before_value,'{}'::jsonb))),jsonb_build_object('version',saved.version,'configurationHash',public.crm_configuration_hash(after_value)),jsonb_build_object('configurationId',saved.id,'version',saved.version,'revisionId',p_id,'automaticPublicationEnabled',false));
end$$;

-- Legacy credentials stay server-private. Source ingestion uses managed server credentials;
-- stored token strings do not qualify a Google owner-publication capability.
alter table public.review_platform_connections enable row level security;
revoke all on public.review_platform_connections from public,anon,authenticated;
grant all on public.review_platform_connections to service_role;
alter table public.review_platform_connections add column scheduled_by uuid references public.profiles(id);
create index reviewflow_source_sponsor on public.review_platform_connections(scheduled_by);
alter table public.review_platform_connections add column version integer not null default 1;
alter table public.review_platform_connections add column org_id uuid references public.organizations(id);
update public.review_platform_connections c set org_id=p.org_id from public.properties p where p.id=c.property_id;
create index reviewflow_connection_org on public.review_platform_connections(org_id);
create function public.guard_reviewflow_connection() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Disconnect a review source instead of deleting its history';end if;
 if(new.id,new.property_id,new.platform,new.org_id,new.created_at) is distinct from(old.id,old.property_id,old.platform,old.org_id,old.created_at) then raise exception 'Review source identity is immutable';end if;
 if(new.place_id,new.google_maps_url,new.yelp_business_id,new.yelp_business_url,new.connection_type,new.sync_frequency,new.is_active,new.api_key,new.access_token,new.refresh_token,new.account_id,new.scraping_config,new.token_expires_at,new.scheduled_by) is distinct from(old.place_id,old.google_maps_url,old.yelp_business_id,old.yelp_business_url,old.connection_type,old.sync_frequency,old.is_active,old.api_key,old.access_token,old.refresh_token,old.account_id,old.scraping_config,old.token_expires_at,old.scheduled_by) then new.version:=old.version+1;else new.version:=old.version;end if;
 new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_connection_guard before update or delete on public.review_platform_connections for each row execute function public.guard_reviewflow_connection();
create function public.reviewflow_connection_snapshot(p_row public.review_platform_connections) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'propertyId',p_row.property_id,'platform',p_row.platform,'providerId',case p_row.platform when 'google' then p_row.place_id else p_row.yelp_business_id end,'sourceUrl',case p_row.platform when 'google' then p_row.google_maps_url else p_row.yelp_business_url end,'method',p_row.connection_type,'frequency',p_row.sync_frequency,'active',p_row.is_active,'version',p_row.version);
$$;
create table public.reviewflow_connection_revisions(id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,connection_id uuid not null references public.review_platform_connections(id) on delete cascade,actor_id uuid not null references public.profiles(id),version integer not null,before_state jsonb,after_state jsonb not null,reason text not null,created_at timestamptz not null default clock_timestamp(),unique(connection_id,version));
create index reviewflow_connection_revision_property on public.reviewflow_connection_revisions(property_id,created_at desc,id desc);
create index reviewflow_connection_revision_actor on public.reviewflow_connection_revisions(actor_id);
alter table public.reviewflow_connection_revisions enable row level security;
revoke all on public.reviewflow_connection_revisions from public,anon,authenticated;
grant all on public.reviewflow_connection_revisions to service_role;
create policy reviewflow_connection_revisions_service on public.reviewflow_connection_revisions for all to service_role using(true) with check(true);
create trigger reviewflow_connection_revision_guard before update or delete on public.reviewflow_connection_revisions for each row execute function public.guard_reviewflow_configuration_revision();

create function public.decide_reviewflow_connection(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;existing public.review_platform_connections;saved public.review_platform_connections;organization uuid;before_value jsonb;after_value jsonb;operation text:=p_input->>'operation';kind text;source_platform text;expected integer;target_changed boolean;begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if organization is null then return '{"state":"manager_required"}';end if;
 if coalesce(operation,'') not in('save','disconnect') then raise exception 'Choose a supported source decision';end if;
 kind:=case operation when 'save' then 'connection.saved' else 'connection.disconnected' end;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 expected:=(p_input->>'expectedVersion')::integer;
 if expected is null or expected<0 or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review the current connection version and reason';end if;
 if nullif(p_input->>'connectionId','') is not null then
  select * into existing from public.review_platform_connections where id=(p_input->>'connectionId')::uuid and property_id=p_property_id and org_id=organization for update;if not found then return '{"state":"not_found"}';end if;
 elsif operation='disconnect' then return '{"state":"not_found"}';end if;
 if coalesce(existing.version,0)<>expected then return '{"state":"stale_connection"}';end if;
 before_value:=case when existing.id is null then null else public.reviewflow_connection_snapshot(existing) end;
 if operation='disconnect' then
  if(p_input-'operation'-'connectionId'-'expectedVersion'-'reason')<>'{}'::jsonb then raise exception 'Review the saved source before disconnecting';end if;
  if existing.is_active is distinct from true then return '{"state":"already_disconnected"}';end if;
  update public.review_platform_connections set is_active=false,scheduled_by=null where id=existing.id returning * into saved;
 else
  if(p_input-'operation'-'connectionId'-'expectedVersion'-'platform'-'providerId'-'sourceUrl'-'method'-'frequency'-'replaceTarget'-'reason')<>'{}'::jsonb or coalesce(p_input->>'platform','') not in('google','yelp') or (coalesce(p_input->>'providerId','')!~'^[A-Za-z0-9_-]+$' or length(p_input->>'providerId')>300) or coalesce(p_input->>'frequency','') not in('manual','hourly','daily') or coalesce(p_input->>'method','') not in('api','scraper') or(p_input->>'platform'='yelp' and p_input->>'method'<>'api') or length(coalesce(p_input->>'sourceUrl',''))>2048 then raise exception 'Review the supported source, method and check frequency';end if;
  source_platform:=p_input->>'platform';
  if coalesce(p_input->>'sourceUrl','')<>'' and (case source_platform when 'google' then p_input->>'sourceUrl'!~'^https://(www\.)?google\.com/maps[/ ?]|^https://maps\.google\.com/' else p_input->>'sourceUrl'!~'^https://(www\.)?yelp\.com/biz/[A-Za-z0-9_-]+' end) then raise exception 'Use the matching provider public page';end if;
  if existing.id is not null and existing.platform<>source_platform then return '{"state":"source_identity_changed"}';end if;
  if existing.id is null and exists(select 1 from public.review_platform_connections where property_id=p_property_id and review_platform_connections.platform=source_platform) then return '{"state":"source_exists"}';end if;
  target_changed:=existing.id is not null and(before_value->>'providerId',coalesce(before_value->>'sourceUrl','')) is distinct from(p_input->>'providerId',coalesce(p_input->>'sourceUrl',''));
  if target_changed and p_input->'replaceTarget' is distinct from 'true'::jsonb then return '{"state":"replacement_review_required"}';end if;
  if existing.id is null then
   insert into public.review_platform_connections(id,property_id,org_id,platform,place_id,google_maps_url,yelp_business_id,yelp_business_url,connection_type,sync_frequency,is_active,error_count,total_reviews_synced,scheduled_by)
   values(p_id,p_property_id,organization,source_platform,case when source_platform='google' then p_input->>'providerId' end,case when source_platform='google' then nullif(p_input->>'sourceUrl','') end,case when source_platform='yelp' then p_input->>'providerId' end,case when source_platform='yelp' then nullif(p_input->>'sourceUrl','') end,p_input->>'method',p_input->>'frequency',true,0,0,case when p_input->>'frequency'<>'manual' then p_actor_id end) returning * into saved;
  else
   update public.review_platform_connections set place_id=case when source_platform='google' then p_input->>'providerId' else place_id end,google_maps_url=case when source_platform='google' then nullif(p_input->>'sourceUrl','') else google_maps_url end,yelp_business_id=case when source_platform='yelp' then p_input->>'providerId' else yelp_business_id end,yelp_business_url=case when source_platform='yelp' then nullif(p_input->>'sourceUrl','') else yelp_business_url end,connection_type=p_input->>'method',sync_frequency=p_input->>'frequency',scheduled_by=case when p_input->>'frequency'<>'manual' then p_actor_id end,is_active=true where id=existing.id returning * into saved;
  end if;
 end if;
 after_value:=public.reviewflow_connection_snapshot(saved);
 -- A no-op preference save still records a decision without duplicating a revision version.
 if existing.id is not null and saved.version=existing.version then
  return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,jsonb_build_object('connectionId',saved.id,'version',existing.version),jsonb_build_object('connectionId',saved.id,'version',saved.version),jsonb_build_object('connectionId',saved.id,'version',saved.version,'changed',false,'providerCalled',false));
 end if;
 insert into public.reviewflow_connection_revisions(id,property_id,connection_id,actor_id,version,before_state,after_state,reason) values(p_id,p_property_id,saved.id,p_actor_id,saved.version,before_value,after_value,p_input->>'reason');
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,jsonb_build_object('connectionId',existing.id,'version',coalesce(existing.version,0),'configurationHash',public.crm_configuration_hash(coalesce(before_value,'{}'::jsonb))),jsonb_build_object('connectionId',saved.id,'version',saved.version,'active',saved.is_active,'configurationHash',public.crm_configuration_hash(after_value)),jsonb_build_object('connectionId',saved.id,'version',saved.version,'active',saved.is_active,'providerCalled',false,'remoteAccessRevoked',false));
end$$;

-- Intake receipts are private. Human decisions and worker results have separate actors.
alter table public.shared_action_events alter column actor_id drop not null;
alter table public.shared_action_episodes alter column actor_id drop not null;
alter table public.shared_action_events add column service_principal text;
alter table public.shared_action_episodes add column service_principal text;
alter table public.shared_action_events add constraint shared_action_actor_kind check((actor_id is not null and service_principal is null) or(actor_id is null and service_principal is not null));
alter table public.shared_action_episodes add constraint shared_episode_actor_kind check((actor_id is not null and service_principal is null) or(actor_id is null and service_principal is not null));
revoke insert,update,delete on public.reviews from public,anon,authenticated;

create table public.reviewflow_intake_requests(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid references public.profiles(id),
 kind text not null check(kind in('manual','csv','source')),trigger_kind text not null check(trigger_kind in('operator','schedule')),connection_id uuid references public.review_platform_connections(id),source_snapshot jsonb,fetch_input jsonb,
 input jsonb not null,input_hash text not null,raw_result jsonb,result_hash text,normalized jsonb,preview jsonb,error_code text,error_detail text,
 state text not null check(state in('queued','running','result_ready','preview','held','stopped','completed')),version integer not null default 1,claim_token uuid,
 parent_request_id uuid references public.reviewflow_intake_requests(id),summary jsonb,created_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz,updated_at timestamptz not null default clock_timestamp(),
 check((trigger_kind='operator' and actor_id is not null) or(trigger_kind='schedule' and actor_id is null)),check((kind='source' and connection_id is not null) or(kind<>'source' and connection_id is null)),
 check(octet_length(raw_result::text)<=2200000)
);
create unique index reviewflow_intake_active_source on public.reviewflow_intake_requests(connection_id) where kind='source' and state in('queued','running','result_ready','preview','held');
create index reviewflow_intake_property on public.reviewflow_intake_requests(property_id,created_at desc,id desc);
create index reviewflow_intake_org on public.reviewflow_intake_requests(org_id);
create index reviewflow_intake_actor on public.reviewflow_intake_requests(actor_id);
create index reviewflow_intake_parent on public.reviewflow_intake_requests(parent_request_id);
alter table public.reviewflow_intake_requests enable row level security;
revoke all on public.reviewflow_intake_requests from public,anon,authenticated;
grant all on public.reviewflow_intake_requests to service_role;
create policy reviewflow_intake_service on public.reviewflow_intake_requests for all to service_role using(true) with check(true);
create table public.reviewflow_intake_observations(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.reviewflow_intake_requests(id) on delete cascade,property_id uuid not null references public.properties(id) on delete cascade,review_id uuid not null references public.reviews(id),row_number integer not null,change_kind text not null check(change_kind in('inserted','updated','unchanged')),before_state jsonb,after_state jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(request_id,review_id)
);
create index reviewflow_intake_observation_property on public.reviewflow_intake_observations(property_id);
create index reviewflow_intake_observation_review on public.reviewflow_intake_observations(review_id,created_at desc);
alter table public.reviewflow_intake_observations enable row level security;
revoke all on public.reviewflow_intake_observations from public,anon,authenticated;
grant all on public.reviewflow_intake_observations to service_role;
create policy reviewflow_intake_observations_service on public.reviewflow_intake_observations for all to service_role using(true) with check(true);
create trigger reviewflow_intake_observation_guard before update or delete on public.reviewflow_intake_observations for each row execute function public.guard_reviewflow_configuration_revision();
create function public.guard_reviewflow_intake() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Saved import evidence is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.kind,new.trigger_kind,new.connection_id,new.source_snapshot,new.fetch_input,new.input,new.input_hash,new.parent_request_id,new.created_at) is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.kind,old.trigger_kind,old.connection_id,old.source_snapshot,old.fetch_input,old.input,old.input_hash,old.parent_request_id,old.created_at) then raise exception 'Saved intake identity is immutable';end if;
 if old.claim_token is not null and new.claim_token is distinct from old.claim_token then raise exception 'One source fetch intent is retained';end if;
 if old.raw_result is not null and(new.raw_result,new.result_hash) is distinct from(old.raw_result,old.result_hash) then raise exception 'The source receipt cannot be replaced';end if;
 if old.normalized is not null and(new.normalized,new.preview) is distinct from(old.normalized,old.preview) then raise exception 'The saved import preview cannot change';end if;
 if old.state in('stopped','completed') and new.state<>old.state then raise exception 'Closed intake cannot restart';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_intake_guard before update or delete on public.reviewflow_intake_requests for each row execute function public.guard_reviewflow_intake();

create function public.record_reviewflow_intake_system(p_run public.reviewflow_intake_requests,p_action text,p_phase text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare event_id uuid:=md5(p_run.id::text||':'||p_action)::uuid;e public.shared_action_events;organization uuid;payload jsonb;begin
 if p_action not in('review.intake.scheduled','review.intake.started','review.intake.result_received','review.intake.previewed','review.intake.held') or p_phase not in('succeeded','failed') or jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>8192 then raise exception 'Invalid intake outcome evidence';end if;
 select org_id into organization from public.properties where id=p_run.property_id;
 if organization is distinct from p_run.org_id then return;end if;
 payload:=p_result||jsonb_build_object('requestId',p_run.id,'requestedBy',p_run.actor_id,'trigger',p_run.trigger_kind);
 select * into e from public.shared_action_events where id=event_id;
 if found then if(e.property_id,e.service_principal,e.action,e.phase,e.result) is distinct from(p_run.property_id,'reviewflow.intake',p_action,p_phase,payload) then raise exception 'Intake outcome identity conflict';end if;return;end if;
 if not exists(select 1 from public.shared_jobs where id=p_run.id and property_id=p_run.property_id and org_id=p_run.org_id) then raise exception 'Saved intake job scope is unavailable';end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin) values(event_id,p_run.org_id,p_run.property_id,null,'reviewflow.intake','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref)
 values(event_id,event_id,p_run.org_id,p_run.property_id,null,'reviewflow.intake','reviewflow',p_action,'server_confirmed',p_phase,jsonb_build_object('requestId',p_run.id),null,jsonb_build_object('state',p_result->>'requestState'),payload,p_run.id);
end$$;
create function public.reviewflow_intake_authorized(p_run public.reviewflow_intake_requests) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.properties p where p.id=p_run.property_id and p.org_id=p_run.org_id)
 and case when p_run.kind='source' then exists(select 1 from public.review_platform_connections c join public.profiles u on u.org_id=c.org_id where c.id=p_run.connection_id and c.property_id=p_run.property_id and c.org_id=p_run.org_id and c.is_active=true and c.version=(p_run.source_snapshot->>'version')::integer and public.reviewflow_connection_snapshot(c)=p_run.source_snapshot-'scheduledBy' and u.id=case when p_run.trigger_kind='schedule' then c.scheduled_by else p_run.actor_id end and u.role in('manager','admin'))
 else exists(select 1 from public.profiles where id=p_run.actor_id and org_id=p_run.org_id) end;
$$;
create function public.reviewflow_intake_hold(p_run public.reviewflow_intake_requests,p_code text,p_detail text) returns jsonb language plpgsql security invoker set search_path='' as $$declare saved public.reviewflow_intake_requests;begin
 if p_run.state in('completed','stopped','held') then return jsonb_build_object('state',p_run.state,'requestId',p_run.id);end if;
 update public.reviewflow_intake_requests set state='held',error_code=p_code,error_detail=left(p_detail,2000),finished_at=clock_timestamp() where id=p_run.id returning * into saved;
 update public.shared_jobs set lifecycle_status='failed',status_reason=p_code,stage='review',current_step='Saved import needs review',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_run.id;
 perform public.record_reviewflow_intake_system(saved,'review.intake.held','failed',jsonb_build_object('requestState','held','reason',p_code));return jsonb_build_object('state','held','requestId',p_run.id);
end$$;

create function public.begin_reviewflow_intake(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_fetch_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_intake_requests;source public.review_platform_connections;organization uuid;result jsonb;kind text:=p_input->>'kind';trigger_kind text:=coalesce(p_input->>'trigger','operator');snapshot jsonb;receipt jsonb;input_hash text;command_input jsonb;scheduled_key text;request_id uuid:=p_id;begin
 if kind not in('manual','csv','source') or trigger_kind not in('operator','schedule') or jsonb_typeof(p_input) is distinct from 'object' or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Choose a supported intake and reason';end if;
 select org_id into organization from public.properties where id=p_property_id;if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if trigger_kind='operator' then
  if not exists(select 1 from public.profiles where id=p_actor_id and org_id=organization and(kind<>'source' or role in('manager','admin'))) then return '{"state":"forbidden"}';end if;
 else if p_actor_id is not null or kind<>'source' then return '{"state":"forbidden"}';end if;end if;
 input_hash:=public.crm_configuration_hash(p_input);command_input:=p_input-'content'||case when p_input?'content' then jsonb_build_object('sourceHash',encode(extensions.digest(convert_to(p_input->>'content','UTF8'),'sha256'),'hex')) else '{}'::jsonb end;
 if trigger_kind='schedule' then
  select * into source from public.review_platform_connections where id=(p_input->>'connectionId')::uuid and property_id=p_property_id and org_id=organization for update;
  if not found or not source.is_active or source.sync_frequency not in('hourly','daily') or not exists(select 1 from public.profiles where id=source.scheduled_by and org_id=organization and role in('admin','manager')) then return '{"state":"schedule_unavailable"}';end if;
  scheduled_key:=source.id::text||':'||source.version::text||':'||to_char(clock_timestamp() at time zone 'UTC',case source.sync_frequency when 'daily' then 'YYYY-MM-DD' else 'YYYY-MM-DD-HH24' end);
  if p_input->>'scheduleKey' is distinct from scheduled_key then return '{"state":"stale_schedule"}';end if;
  request_id:=md5('reviewflow.intake:'||scheduled_key)::uuid;
 end if;
 select * into run from public.reviewflow_intake_requests where id=request_id;
 if found then if(run.property_id,run.org_id,run.actor_id,run.input_hash) is distinct from(p_property_id,organization,p_actor_id,input_hash) then return '{"state":"request_conflict"}';end if;return jsonb_build_object('state',run.state,'requestId',run.id,'version',run.version);end if;
 if trigger_kind='operator' then result:=public.reviewflow_command_start(request_id,p_property_id,p_actor_id,'intake.requested',command_input);if result->>'state'<>'new' then return result;end if;end if;
 if kind='source' then
  if(p_input-'kind'-'trigger'-'reason'-'connectionId'-'connectionVersion'-'scheduleKey')<>'{}'::jsonb then raise exception 'Review the saved source request';end if;
  select * into source from public.review_platform_connections where id=(p_input->>'connectionId')::uuid and property_id=p_property_id and org_id=organization for update;
  if not found or not source.is_active or source.platform not in('google','yelp') then return '{"state":"source_unavailable"}';end if;
  if source.version is distinct from(p_input->>'connectionVersion')::integer then return '{"state":"stale_connection"}';end if;
  select * into run from public.reviewflow_intake_requests where connection_id=source.id and state in('queued','running','result_ready','preview','held');if found then return jsonb_build_object('state','busy','requestId',run.id,'version',run.version);end if;
  snapshot:=public.reviewflow_connection_snapshot(source)||jsonb_build_object('scheduledBy',source.scheduled_by);
  if jsonb_typeof(p_fetch_input) is distinct from 'object' or p_fetch_input->>'contractVersion' is distinct from 'review-intake-v1' or p_fetch_input->>'platform' is distinct from source.platform or p_fetch_input->>'providerId' is distinct from(snapshot->>'providerId') or p_fetch_input->>'method' is distinct from source.connection_type or length(p_fetch_input::text)>16000 then raise exception 'Saved fetch input differs from the source';end if;
 else
  if(p_input-'kind'-'trigger'-'reason'-'content'-'fileName')<>'{}'::jsonb or jsonb_typeof(p_input->'content') is distinct from 'string' or octet_length(p_input->>'content') not between 1 and 2000000 or length(coalesce(p_input->>'fileName',''))>300 then raise exception 'Review the bounded source file';end if;
  receipt:=jsonb_build_object('status','received','content',p_input->>'content','receivedAt',clock_timestamp());
 end if;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,max_attempts,stage,progress,current_step) values(request_id,organization,p_property_id,'reviewflow.intake','review_source',coalesce(source.id::text,kind),'queued','intake_saved',request_id::text,jsonb_build_object('requestId',request_id,'kind',kind),1,'queued',0,'Saved source awaits validation');
 insert into public.reviewflow_intake_requests(id,property_id,org_id,actor_id,kind,trigger_kind,connection_id,source_snapshot,fetch_input,input,input_hash,raw_result,result_hash,state)
 values(request_id,p_property_id,organization,p_actor_id,kind,trigger_kind,source.id,snapshot,case when kind='source' then p_fetch_input end,p_input,input_hash,receipt,case when receipt is not null then public.crm_configuration_hash(receipt) end,case when kind='source' then 'queued' else 'result_ready' end) returning * into run;
 if trigger_kind='operator' then perform public.reviewflow_command_finish(request_id,p_property_id,p_actor_id,'intake.requested',command_input,null,jsonb_build_object('requestId',run.id,'state',run.state),jsonb_build_object('requestId',run.id,'kind',kind,'providerCalled',false),jsonb_build_object('jobId',run.id));
 else perform public.record_reviewflow_intake_system(run,'review.intake.scheduled','succeeded',jsonb_build_object('requestState','queued','connectionId',source.id,'connectionVersion',source.version,'authorizedBy',source.scheduled_by));end if;
 return jsonb_build_object('state',run.state,'requestId',run.id,'version',run.version);
end$$;

create function public.claim_reviewflow_intake(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_intake_requests;begin
 select * into run from public.reviewflow_intake_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_intake_requests where id=p_id for update;
 if run.state<>'queued' then return jsonb_build_object('state',run.state);end if;
 if not public.reviewflow_intake_authorized(run) then return public.reviewflow_intake_hold(run,'source_or_access_changed','The source or scheduling authority changed.');end if;
 update public.reviewflow_intake_requests set state='running',claim_token=gen_random_uuid(),started_at=clock_timestamp() where id=p_id returning * into run;
 update public.shared_jobs set lifecycle_status='running',attempt_count=1,stage='fetching',progress=10,started_at=clock_timestamp(),current_step='One source fetch started; awaiting its saved receipt',updated_at=clock_timestamp() where id=p_id;
 perform public.record_reviewflow_intake_system(run,'review.intake.started','succeeded',jsonb_build_object('requestState','running'));
 return jsonb_build_object('state','invoke_once','claimToken',run.claim_token,'fetchInput',run.fetch_input,'propertyId',run.property_id);
end$$;
create function public.record_reviewflow_intake_result(p_id uuid,p_claim_token uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare run public.reviewflow_intake_requests;next_state text;begin
 select * into run from public.reviewflow_intake_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_intake_requests where id=p_id for update;
 if p_claim_token is null or run.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if run.raw_result is not null then if run.result_hash=public.crm_configuration_hash(p_result) then return jsonb_build_object('state','replayed','requestState',run.state);end if;return '{"state":"result_conflict"}';end if;
 if jsonb_typeof(p_result) is distinct from 'object' or coalesce(p_result->>'status','') not in('received','uncertain','blocked') or(p_result-'status'-'httpStatus'-'content'-'receivedAt'-'errorCode')<>'{}'::jsonb or octet_length(p_result::text)>2200000 or(p_result->>'status'='received' and jsonb_typeof(p_result->'content') is distinct from 'string') then raise exception 'Invalid source receipt';end if;
 next_state:=case when run.state='stopped' then 'stopped' when p_result->>'status'='received' then 'result_ready' else 'running' end;
 update public.reviewflow_intake_requests set raw_result=p_result,result_hash=public.crm_configuration_hash(p_result),state=next_state where id=p_id returning * into run;
 perform public.record_reviewflow_intake_system(run,'review.intake.result_received',case when next_state='result_ready' then 'succeeded' else 'failed' end,jsonb_build_object('requestState',run.state,'resultHash',run.result_hash,'receiptStatus',p_result->>'status'));
 if run.state='running' then return public.reviewflow_intake_hold(run,coalesce(p_result->>'errorCode','fetch_uncertain'),'No confirmed source result is available. This fetch will not be repeated automatically.');end if;
 update public.shared_jobs set lifecycle_status=case when run.state='stopped' then 'cancelled' else 'failed' end,status_reason=case when run.state='stopped' then 'intake_stopped' else 'intake_result_saved' end,stage='review',current_step='Saved source awaits validation',updated_at=clock_timestamp() where id=p_id;
 return jsonb_build_object('state','saved','requestState',run.state);
end$$;

create function public.preview_reviewflow_intake(p_id uuid,p_result_hash text,p_normalized jsonb,p_error text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_intake_requests;item jsonb;existing public.reviews;manifest jsonb:='[]';kind text;seen_ids uuid[]:='{}';begin
 select * into run from public.reviewflow_intake_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_intake_requests where id=p_id for update;
 if run.state<>'result_ready' then return jsonb_build_object('state',run.state,'requestId',run.id);end if;
 if p_result_hash is distinct from run.result_hash then return '{"state":"result_conflict"}';end if;
 if not public.reviewflow_intake_authorized(run) then return public.reviewflow_intake_hold(run,'source_or_access_changed','The source or access changed after this receipt was saved.');end if;
 if p_error is not null then return public.reviewflow_intake_hold(run,'invalid_source',p_error);end if;
 if p_normalized->>'contractVersion' is distinct from 'review-intake-v1' or jsonb_typeof(p_normalized->'reviews') is distinct from 'array' or jsonb_array_length(p_normalized->'reviews')>500 or p_normalized->>'sourceHash' is distinct from encode(extensions.digest(convert_to(run.raw_result->>'content','UTF8'),'sha256'),'hex') or p_normalized->>'retrievalMethod' not in('provider_api','scraper','manual','csv_import') or p_normalized->>'completeness' not in('complete','sample','degraded','unknown') then raise exception 'The preview does not match the saved receipt';end if;
 for item in select value from jsonb_array_elements(p_normalized->'reviews') loop
  if coalesce(item->>'platform','') not in('google','yelp','apartments_com','facebook','other') or length(coalesce(item->>'platformReviewId','')) not between 1 and 500 or length(trim(coalesce(item->>'reviewText',''))) not between 1 and 20000 or length(coalesce(item->>'reviewerName',''))>300 or(item->>'rating' is not null and (item->>'rating')::integer not between 1 and 5) or(item->>'fingerprint')!~'^[a-f0-9]{64}$' then raise exception 'Invalid normalized review row';end if;
  if run.kind='source' and item->>'platform' is distinct from run.source_snapshot->>'platform' then raise exception 'Source platform mismatch';end if;
  select * into existing from public.reviews where property_id=run.property_id and platform=item->>'platform' and platform_review_id=item->>'platformReviewId' for update;
  -- Older manual imports hashed an omitted author as blank instead of Anonymous.
  if existing.id is null and item->>'identityBasis'='content_fingerprint' then
   select * into existing from public.reviews where property_id=run.property_id and platform=item->>'platform' and platform_review_id='fp-'||left(item->>'legacyFingerprint',24) for update;
  end if;
  if existing.id=any(seen_ids) then raise exception 'Two source rows resolve to the same saved review';end if;
  if existing.id is not null then seen_ids:=array_append(seen_ids,existing.id);end if;
  kind:=case when existing.id is null then 'inserted' when(existing.review_text,existing.rating,coalesce(existing.reviewer_name,'Anonymous'),existing.review_date,existing.reviewer_avatar_url) is distinct from(item->>'reviewText',(item->>'rating')::integer,item->>'reviewerName',(item->>'reviewDate')::timestamptz,item->>'reviewerAvatarUrl') then 'updated' else 'unchanged' end;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('reviewId',existing.id,'sourceVersion',existing.source_version,'beforeHash',case when existing.id is not null then public.crm_configuration_hash(to_jsonb(existing)-'updated_at'-'last_observed_at'-'sentiment'-'sentiment_score'-'topics'-'is_urgent'-'response_status') end,'changeKind',kind));
 end loop;
 update public.reviewflow_intake_requests set normalized=p_normalized,preview=manifest,state='preview' where id=p_id returning * into run;
 update public.shared_jobs set lifecycle_status='queued',status_reason='intake_preview_ready',stage='review',progress=50,current_step='Review saved rows before applying the import',updated_at=clock_timestamp() where id=p_id;
 perform public.record_reviewflow_intake_system(run,'review.intake.previewed','succeeded',jsonb_build_object('requestState','preview','rowCount',jsonb_array_length(manifest),'resultHash',run.result_hash));return jsonb_build_object('state','preview','requestId',run.id,'version',run.version);
end$$;

create function public.apply_reviewflow_intake(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;run public.reviewflow_intake_requests;item jsonb;planned jsonb;existing public.reviews;saved public.reviews;case_id uuid;row_index integer:=0;inserted_count integer:=0;updated_count integer:=0;unchanged_count integer:=0;before_value jsonb;change_kind text;begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'intake.applied',p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'intakeId'-'expectedVersion'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review this saved preview before importing';end if;
 select * into run from public.reviewflow_intake_requests where id=(p_input->>'intakeId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id) for update;if not found then return '{"state":"not_found"}';end if;
 if run.kind='source' and not exists(select 1 from public.profiles where id=p_actor_id and org_id=run.org_id and role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if run.state<>'preview' then return jsonb_build_object('state',run.state);end if;
 if not public.reviewflow_intake_authorized(run) then return public.reviewflow_intake_hold(run,'source_or_access_changed','The source or access changed. Save a new request after reviewing its current setup.');end if;
 -- Validate every head before any business mutation. Concurrent previews cannot overwrite later imports.
 for item in select value from jsonb_array_elements(run.normalized->'reviews') loop
  planned:=run.preview->row_index;row_index:=row_index+1;
  select * into existing from public.reviews where property_id=p_property_id and id=(planned->>'reviewId')::uuid for update;
  if planned->>'reviewId' is null then
   if exists(select 1 from public.reviews where property_id=p_property_id and platform=item->>'platform' and platform_review_id in(item->>'platformReviewId','fp-'||left(item->>'legacyFingerprint',24))) then return public.reviewflow_intake_hold(run,'reviews_changed','A matching review arrived after the preview. Rebuild the preview from this saved source.');end if;
  elsif existing.id is null or existing.source_version is distinct from(planned->>'sourceVersion')::integer or public.crm_configuration_hash(to_jsonb(existing)-'updated_at'-'last_observed_at'-'sentiment'-'sentiment_score'-'topics'-'is_urgent'-'response_status') is distinct from planned->>'beforeHash' then
   return public.reviewflow_intake_hold(run,'reviews_changed','A review changed after this preview. Rebuild the preview from this saved source.');
  end if;
 end loop;
 row_index:=0;
 for item in select value from jsonb_array_elements(run.normalized->'reviews') loop
  planned:=run.preview->row_index;row_index:=row_index+1;change_kind:=planned->>'changeKind';
  select * into existing from public.reviews where id=(planned->>'reviewId')::uuid;before_value:=case when existing.id is null then null else to_jsonb(existing) end;
  if existing.id is null then
   insert into public.reviews(property_id,platform,platform_review_id,reviewer_name,reviewer_avatar_url,rating,review_text,review_date,retrieval_method,source_completeness,content_fingerprint,last_observed_at,response_status)
   values(p_property_id,item->>'platform',item->>'platformReviewId',item->>'reviewerName',item->>'reviewerAvatarUrl',(item->>'rating')::integer,item->>'reviewText',(item->>'reviewDate')::timestamptz,run.normalized->>'retrievalMethod',run.normalized->>'completeness',item->>'fingerprint',clock_timestamp(),'pending') returning * into saved;inserted_count:=inserted_count+1;
  else
   update public.reviews set reviewer_name=item->>'reviewerName',reviewer_avatar_url=item->>'reviewerAvatarUrl',rating=(item->>'rating')::integer,review_text=item->>'reviewText',review_date=(item->>'reviewDate')::timestamptz,retrieval_method=run.normalized->>'retrievalMethod',source_completeness=run.normalized->>'completeness',content_fingerprint=item->>'fingerprint',last_observed_at=clock_timestamp(),updated_at=clock_timestamp() where id=existing.id returning * into saved;
   if change_kind='updated' then updated_count:=updated_count+1;else unchanged_count:=unchanged_count+1;end if;
  end if;
  insert into public.reviewflow_intake_observations(request_id,property_id,review_id,row_number,change_kind,before_state,after_state) values(run.id,p_property_id,saved.id,row_index,change_kind,before_value,to_jsonb(saved));
  insert into public.reputation_cases(property_id,review_id,status,priority) values(p_property_id,saved.id,'open','medium') on conflict(review_id) do nothing;
  select id into case_id from public.reputation_cases where review_id=saved.id and property_id=p_property_id;if case_id is null then raise exception 'Review case scope differs from its source';end if;
  if change_kind<>'unchanged' then insert into public.reputation_case_events(case_id,property_id,event_type,actor_profile_id,payload) values(case_id,p_property_id,'source_imported',p_actor_id,jsonb_build_object('requestId',run.id,'sourceVersion',saved.source_version,'changeKind',change_kind));end if;
 end loop;
 result:=jsonb_build_object('requestId',run.id,'inserted',inserted_count,'updated',updated_count,'unchanged',unchanged_count,'duplicates',run.normalized->'duplicateRows','completeness',run.normalized->>'completeness','analysisStarted',false);
 update public.reviewflow_intake_requests set state='completed',summary=result,finished_at=clock_timestamp() where id=run.id;
 if run.connection_id is not null then update public.review_platform_connections set last_sync_at=clock_timestamp(),last_error=null,error_count=0,total_reviews_synced=coalesce(total_reviews_synced,0)+inserted_count where id=run.connection_id;end if;
 update public.shared_jobs set lifecycle_status='succeeded',status_reason='intake_applied',stage='completed',progress=100,current_step='All previewed rows were applied atomically',output=result,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'intake.applied',p_input,jsonb_build_object('state',run.state,'version',run.version),jsonb_build_object('state','completed','version',run.version+1),result,jsonb_build_object('jobId',run.id));
end$$;

create function public.control_reviewflow_intake(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_intake_requests;result jsonb;operation text:=p_input->>'operation';next_run public.reviewflow_intake_requests;kind text;begin
 if operation not in('stop','recover','rebase') then raise exception 'Choose a supported import decision';end if;
 kind:='intake.'||case operation when 'stop' then 'stopped' when 'recover' then 'recovered' else 'rebased' end;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'intakeId'-'expectedVersion'-'reason'-'operation')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review this import decision';end if;
 select * into run from public.reviewflow_intake_requests where id=(p_input->>'intakeId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id) for update;if not found then return '{"state":"not_found"}';end if;
 if run.kind='source' and not exists(select 1 from public.profiles where id=p_actor_id and org_id=run.org_id and role in('admin','manager')) then return '{"state":"manager_required"}';end if;
 if run.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_request"}';end if;
 if operation='stop' then
  if run.state in('stopped','completed') then return jsonb_build_object('state',run.state);end if;
  update public.reviewflow_intake_requests set state='stopped',finished_at=clock_timestamp() where id=run.id;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='intake_stopped',current_step='Intake stopped; late source evidence is retained without applying reviews',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
  result:=jsonb_build_object('requestId',run.id,'requestState','stopped','providerCancelled',false);
 elsif operation='rebase' then
  if run.raw_result->>'status' is distinct from 'received' or run.state not in('preview','held') or run.error_code in('invalid_source','source_or_access_changed') then return '{"state":"rebase_unavailable"}';end if;
  if not public.reviewflow_intake_authorized(run) then return '{"state":"source_changed"}';end if;
  update public.reviewflow_intake_requests set state='stopped',finished_at=clock_timestamp() where id=run.id;
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='intake_rebased',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
  insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,max_attempts,stage,progress,current_step) values(p_id,run.org_id,p_property_id,'reviewflow.intake','review_source',coalesce(run.connection_id::text,run.kind),'queued','saved_source_reused',p_id::text,jsonb_build_object('requestId',p_id,'parentId',run.id),1,'review',25,'Rebuild a preview from the saved source; no provider call');
  insert into public.reviewflow_intake_requests(id,property_id,org_id,actor_id,kind,trigger_kind,connection_id,source_snapshot,fetch_input,input,input_hash,raw_result,result_hash,parent_request_id,state)
  values(p_id,p_property_id,run.org_id,p_actor_id,run.kind,'operator',run.connection_id,run.source_snapshot,run.fetch_input,p_input,public.crm_configuration_hash(p_input),run.raw_result,run.result_hash,run.id,'result_ready') returning * into next_run;
  result:=jsonb_build_object('requestId',next_run.id,'parentId',run.id,'requestState','result_ready','providerCalled',false);
 else
  result:=jsonb_build_object('requestId',run.id,'requestState',run.state,'providerCalled',false);
 end if;
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,jsonb_build_object('requestId',run.id,'state',run.state,'version',run.version),jsonb_build_object('requestId',result->>'requestId','state',result->>'requestState'),result,jsonb_build_object('jobId',run.id));
end$$;
create function public.list_reviewflow_due_sources(p_limit integer default 20) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from(
  select c.id,c.property_id,c.version,c.sync_frequency,c.id::text||':'||c.version::text||':'||to_char(now() at time zone 'UTC',case c.sync_frequency when 'daily' then 'YYYY-MM-DD' else 'YYYY-MM-DD-HH24' end) as schedule_key
  from public.review_platform_connections c join public.properties p on p.id=c.property_id and p.org_id=c.org_id join public.profiles u on u.id=c.scheduled_by and u.org_id=c.org_id and u.role in('admin','manager')
  where c.is_active=true and c.sync_frequency in('hourly','daily') and c.platform in('google','yelp')
   and not exists(select 1 from public.reviewflow_intake_requests r where r.connection_id=c.id and(r.state in('queued','running','result_ready','preview','held') or r.id=md5('reviewflow.intake:'||c.id::text||':'||c.version::text||':'||to_char(now() at time zone 'UTC',case c.sync_frequency when 'daily' then 'YYYY-MM-DD' else 'YYYY-MM-DD-HH24' end))::uuid))
  order by coalesce(c.last_sync_at,c.created_at),c.id limit least(greatest(p_limit,1),50)
 ) d;
$$;

revoke all on function public.guard_reviewflow_configuration(),public.guard_reviewflow_configuration_revision(),public.decide_reviewflow_configuration(uuid,uuid,uuid,jsonb),public.guard_reviewflow_connection(),public.reviewflow_connection_snapshot(public.review_platform_connections),public.decide_reviewflow_connection(uuid,uuid,uuid,jsonb),public.guard_reviewflow_intake(),public.record_reviewflow_intake_system(public.reviewflow_intake_requests,text,text,jsonb),public.reviewflow_intake_authorized(public.reviewflow_intake_requests),public.reviewflow_intake_hold(public.reviewflow_intake_requests,text,text),public.begin_reviewflow_intake(uuid,uuid,uuid,jsonb,jsonb),public.claim_reviewflow_intake(uuid),public.record_reviewflow_intake_result(uuid,uuid,jsonb),public.preview_reviewflow_intake(uuid,text,jsonb,text),public.apply_reviewflow_intake(uuid,uuid,uuid,jsonb),public.control_reviewflow_intake(uuid,uuid,uuid,jsonb),public.list_reviewflow_due_sources(integer) from public,anon,authenticated;
grant execute on function public.guard_reviewflow_configuration(),public.guard_reviewflow_configuration_revision(),public.decide_reviewflow_configuration(uuid,uuid,uuid,jsonb),public.guard_reviewflow_connection(),public.reviewflow_connection_snapshot(public.review_platform_connections),public.decide_reviewflow_connection(uuid,uuid,uuid,jsonb),public.guard_reviewflow_intake(),public.record_reviewflow_intake_system(public.reviewflow_intake_requests,text,text,jsonb),public.reviewflow_intake_authorized(public.reviewflow_intake_requests),public.reviewflow_intake_hold(public.reviewflow_intake_requests,text,text),public.begin_reviewflow_intake(uuid,uuid,uuid,jsonb,jsonb),public.claim_reviewflow_intake(uuid),public.record_reviewflow_intake_result(uuid,uuid,jsonb),public.preview_reviewflow_intake(uuid,text,jsonb,text),public.apply_reviewflow_intake(uuid,uuid,uuid,jsonb),public.control_reviewflow_intake(uuid,uuid,uuid,jsonb),public.list_reviewflow_due_sources(integer) to service_role;
notify pgrst,'reload schema';
