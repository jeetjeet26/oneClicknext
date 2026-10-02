create table public.knowledge_web_policies(property_id uuid primary key references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),owner_id uuid not null references public.profiles(id),revision integer not null,enabled boolean not null default false,interval_hours integer not null check(interval_hours between 24 and 168),daily_limit integer not null check(daily_limit between 1 and 5),last_decision_id uuid not null,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create table public.knowledge_web_policy_decisions(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),decision_sequence bigint generated always as identity unique,input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.knowledge_web_policies add foreign key(last_decision_id)references public.knowledge_web_policy_decisions(id)deferrable initially deferred;
alter table public.knowledge_web_captures alter column actor_id drop not null;
alter table public.knowledge_web_captures add column origin text not null default'operator'check(origin in('operator','scheduled')),add column policy_id uuid references public.knowledge_web_policies(property_id),add column policy_revision integer,add column source_material_id uuid references public.knowledge_materials(id),add column source_version_id uuid references public.knowledge_material_versions(id);
alter table public.knowledge_web_captures add constraint knowledge_web_capture_origin check((origin='operator'and actor_id is not null and policy_id is null and policy_revision is null and source_material_id is null and source_version_id is null)or(origin='scheduled'and actor_id is null and policy_id is not null and policy_revision is not null and source_material_id is not null and source_version_id is not null));
create unique index knowledge_web_scheduled_identity on public.knowledge_web_captures(policy_id,policy_revision,source_version_id)where origin='scheduled';
create index knowledge_web_policy_fk on public.knowledge_web_captures(policy_id);
create index knowledge_web_source_material_fk on public.knowledge_web_captures(source_material_id);
create index knowledge_web_source_version_fk on public.knowledge_web_captures(source_version_id);
create index knowledge_web_daily_budget on public.knowledge_web_captures(property_id,created_at)where origin='scheduled';
alter table public.knowledge_web_policies enable row level security;revoke all on public.knowledge_web_policies from public,anon,authenticated;grant all on public.knowledge_web_policies to service_role;create policy knowledge_web_policies_service on public.knowledge_web_policies for all to service_role using(true)with check(true);
create index knowledge_web_policies_idx_0 on public.knowledge_web_policies(org_id);
create index knowledge_web_policies_idx_1 on public.knowledge_web_policies(owner_id);
create index knowledge_web_policies_idx_2 on public.knowledge_web_policies(last_decision_id);
alter table public.knowledge_web_policy_decisions enable row level security;revoke all on public.knowledge_web_policy_decisions from public,anon,authenticated;grant all on public.knowledge_web_policy_decisions to service_role;create policy knowledge_web_policy_decisions_service on public.knowledge_web_policy_decisions for all to service_role using(true)with check(true);
create index knowledge_web_policy_decisions_idx_0 on public.knowledge_web_policy_decisions(property_id,decision_sequence desc);
create index knowledge_web_policy_decisions_idx_1 on public.knowledge_web_policy_decisions(org_id);
create index knowledge_web_policy_decisions_idx_2 on public.knowledge_web_policy_decisions(actor_id);
create trigger knowledge_web_policy_decisions_immutable before update or delete on public.knowledge_web_policy_decisions for each row execute function public.guard_siteforge_brief_history();
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('property.setup.saved','property.created','property.onboarding.completed') then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
 elsif p_action like 'site.%' then
  if p_product<>'siteforge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid brief evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.note.%' then
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid internal note evidence';end if;
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
 origin:=case when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create function public.save_knowledge_web_policy(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_start jsonb;v_old public.knowledge_web_policies;v_prior public.knowledge_web_policy_decisions;v_new public.knowledge_web_policies;v_stopped jsonb;v_result jsonb;v_event jsonb;
begin
 v_start:=public.knowledge_decision_start(p_id,p_property_id,p_actor_id,'web.policy_saved',p_input);if v_start->>'state'<>'new'then return v_start;end if;
 select *into v_prior from public.knowledge_web_policy_decisions where id=p_id;
 if found then if(v_prior.property_id,v_prior.org_id,v_prior.actor_id,v_prior.input)is distinct from(p_property_id,(v_start->>'orgId')::uuid,p_actor_id,p_input)then return'{"state":"request_conflict"}';end if;return v_prior.result||'{"state":"replayed"}';end if;
 if p_input-array['expectedRevision','enabled','intervalHours','dailyLimit','confirmed','reason']<>'{}'or not(p_input?&array['expectedRevision','enabled','intervalHours','dailyLimit','confirmed','reason'])or p_input->'confirmed'is distinct from'true'::jsonb or jsonb_typeof(p_input->'enabled')is distinct from'boolean'or coalesce(p_input->>'expectedRevision','')!~'^[0-9]{1,9}$'or coalesce(p_input->>'intervalHours','')!~'^[0-9]{1,3}$'or coalesce(p_input->>'dailyLimit','')!~'^[0-9]{1,3}$'or(p_input->>'intervalHours')::int not between 24 and 168 or(p_input->>'dailyLimit')::int not between 1 and 5 then raise exception 'Review the published-source scope, age threshold and daily request limit';end if;
 select *into v_old from public.knowledge_web_policies where property_id=p_property_id for update;
 if found and v_old.org_id<>(v_start->>'orgId')::uuid then return'{"state":"forbidden"}';end if;
 if coalesce(v_old.revision,0)is distinct from(p_input->>'expectedRevision')::int then return'{"state":"policy_changed"}';end if;
 perform set_config('p11.knowledge_policy_scope',p_property_id::text,true);perform set_config('p11.knowledge_web_scope',p_property_id::text,true);
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'state',c.state,'revision',c.revision)order by c.id),'[]')into v_stopped from public.knowledge_web_captures c where property_id=p_property_id and org_id=(v_start->>'orgId')::uuid and origin='scheduled'and state in('queued','running');
 update public.knowledge_web_captures set state='stopped'where id in(select(value->>'id')::uuid from jsonb_array_elements(v_stopped));
 insert into public.knowledge_web_policies(property_id,org_id,owner_id,revision,enabled,interval_hours,daily_limit,last_decision_id)
 values(p_property_id,(v_start->>'orgId')::uuid,p_actor_id,coalesce(v_old.revision,0)+1,(p_input->>'enabled')::boolean,(p_input->>'intervalHours')::int,(p_input->>'dailyLimit')::int,p_id)
 on conflict(property_id)do update set owner_id=excluded.owner_id,revision=excluded.revision,enabled=excluded.enabled,interval_hours=excluded.interval_hours,daily_limit=excluded.daily_limit,last_decision_id=excluded.last_decision_id,updated_at=clock_timestamp()returning *into v_new;
 v_result:=jsonb_build_object('propertyId',p_property_id,'revision',v_new.revision,'enabled',v_new.enabled,'stoppedCaptures',jsonb_array_length(v_stopped));
 insert into public.knowledge_web_policy_decisions(id,property_id,org_id,actor_id,input,input_hash,before_state,after_state,result)values(p_id,p_property_id,v_new.org_id,p_actor_id,p_input,public.knowledge_hash(p_input),jsonb_build_object('policy',to_jsonb(v_old),'unfinishedCaptures',v_stopped),to_jsonb(v_new),v_result);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'knowledge','knowledge.web.policy_saved','server_confirmed','succeeded',jsonb_build_object('inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(to_jsonb(v_old))),jsonb_build_object('hash',public.knowledge_hash(to_jsonb(v_new))),v_result);
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Website policy history could not be retained';end if;
 return v_result||'{"state":"saved"}';
end$$;
create function public.guard_knowledge_web_policy()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
 if tg_op='DELETE'then raise exception 'Retain website monitoring policy history';end if;
 if current_setting('p11.knowledge_policy_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded website policy review';end if;
 if tg_op='UPDATE'and(new.property_id,new.org_id)is distinct from(old.property_id,old.org_id)then raise exception 'Website policy scope is immutable';end if;
 return new;
end$$;
create trigger knowledge_web_policy_guard before insert or update or delete on public.knowledge_web_policies for each row execute function public.guard_knowledge_web_policy();
create function public.knowledge_web_capture_authorized(p_capture public.knowledge_web_captures)returns boolean language sql stable security invoker set search_path=''as $$
 select case when p_capture.origin='operator'then exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_capture.property_id and p.org_id=p_capture.org_id and u.id=p_capture.actor_id and u.role in('admin','manager'))
 else exists(select 1 from public.knowledge_web_policies q join public.properties p on p.id=q.property_id and p.org_id=q.org_id join public.profiles u on u.id=q.owner_id and u.org_id=q.org_id and u.role in('admin','manager')join public.knowledge_materials m on m.id=p_capture.source_material_id and m.property_id=q.property_id and m.org_id=q.org_id where q.property_id=p_capture.policy_id and q.property_id=p_capture.property_id and q.org_id=p_capture.org_id and q.enabled and q.revision=p_capture.policy_revision and m.active_version_id=p_capture.source_version_id and public.knowledge_hash(public.knowledge_version_web_origin(m.active_version_id))=p_capture.input->>'sourceOriginHash')end
$$;
create function public.dispatch_knowledge_web_checks(p_limit integer default 5)returns jsonb language plpgsql security invoker set search_path=''as $$
declare q public.knowledge_web_policies;m record;v_policy_id uuid;v_origin jsonb;v_count int;v_id uuid;v_event uuid;v_input jsonb;v_requests jsonb:='[]';v_now timestamptz:=clock_timestamp();
begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'At most five automatic captures may be dispatched per sweep';end if;
 perform pg_advisory_xact_lock(hashtextextended('knowledge.web.schedule',992));
 for v_policy_id in select property_id from public.knowledge_web_policies where enabled order by updated_at,property_id loop
  perform pg_advisory_xact_lock(hashtextextended(v_policy_id::text,12));
  select policy.*into q from public.knowledge_web_policies policy join public.properties p on p.id=policy.property_id and p.org_id=policy.org_id join public.profiles u on u.id=policy.owner_id and u.org_id=policy.org_id and u.role in('admin','manager')where policy.property_id=v_policy_id and policy.enabled for update of policy,p for share of u;
  if not found then continue;end if;
  select count(*)into v_count from public.knowledge_web_captures where property_id=q.property_id and org_id=q.org_id and origin='scheduled'and created_at>=date_trunc('day',v_now at time zone'UTC')at time zone'UTC';
  if v_count>=q.daily_limit then continue;end if;
  for m in select material.id,material.active_version_id,v.title from public.knowledge_materials material join public.knowledge_material_versions v on v.id=material.active_version_id where material.property_id=q.property_id and material.org_id=q.org_id order by material.updated_at,material.id loop
   if exists(select 1 from public.knowledge_web_captures where policy_id=q.property_id and policy_revision=q.revision and source_version_id=m.active_version_id)then continue;end if;
   v_origin:=public.knowledge_version_web_origin(m.active_version_id);
   if v_origin is null or(v_origin->>'fetchedAt')::timestamptz>v_now-make_interval(hours=>q.interval_hours)then continue;end if;
   v_id:=gen_random_uuid();v_input:=jsonb_build_object('title',m.title,'url',v_origin->>'url','materialId',m.id,'parentCaptureId',v_origin->>'captureId','sourceOriginHash',public.knowledge_hash(v_origin),'policyOwnerId',q.owner_id,'reason','Scheduled capture under the reviewed published-source policy');
   insert into public.knowledge_web_captures(id,property_id,org_id,actor_id,input,input_hash,parent_capture_id,origin,policy_id,policy_revision,source_material_id,source_version_id)
   values(v_id,q.property_id,q.org_id,null,v_input,public.knowledge_hash(v_input),(v_origin->>'captureId')::uuid,'scheduled',q.property_id,q.revision,m.id,m.active_version_id);
   v_event:=md5('knowledge.web.scheduled:'||v_id::text)::uuid;
   insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(v_event,q.org_id,q.property_id,'knowledge.web.schedule','workflow');
   insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(v_event,v_event,q.org_id,q.property_id,'knowledge.web.schedule','knowledge','knowledge.web.scheduled','server_confirmed','succeeded',jsonb_build_object('policyRevision',q.revision,'materialId',m.id,'sourceVersionId',m.active_version_id,'inputHash',public.knowledge_hash(v_input)),jsonb_build_object('captureId',v_id,'captureState','queued','published',false));
   v_requests:=v_requests||jsonb_build_array(jsonb_build_object('id',v_id,'propertyId',q.property_id));v_count:=v_count+1;
   if jsonb_array_length(v_requests)>=p_limit then return jsonb_build_object('state','ready','requests',v_requests);end if;
   exit when v_count>=q.daily_limit;
  end loop;
 end loop;
 return jsonb_build_object('state','ready','requests',v_requests);
end$$;
create function public.read_knowledge_web_policy(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;q public.knowledge_web_policies;d public.knowledge_web_policy_decisions;v_rows jsonb;v_items jsonb;v_total int;v_hash text;v_offset int:=coalesce((p_input->>'offset')::int,0);v_source_count int;v_scheduled int;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if v_org is null then return'{"state":"forbidden"}';end if;
 if p_input-array['kind','decisionId','offset','expectedHash']<>'{}'or coalesce(p_input->>'kind','policy')not in('policy','decision')or v_offset not between 0 and 1000000 then raise exception 'Choose a saved website policy or history page';end if;
 if p_input->>'kind'='decision'then select *into d from public.knowledge_web_policy_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=v_org and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return d.result||'{"state":"ready"}';end if;
 select *into q from public.knowledge_web_policies where property_id=p_property_id and org_id=v_org;
 select count(*)into v_source_count from public.knowledge_materials m where property_id=p_property_id and org_id=v_org and active_version_id is not null and public.knowledge_version_web_origin(active_version_id)is not null;
 select count(*)into v_scheduled from public.knowledge_web_captures where property_id=p_property_id and org_id=v_org and origin='scheduled'and created_at>=date_trunc('day',clock_timestamp()at time zone'UTC')at time zone'UTC';
 select coalesce(jsonb_agg((to_jsonb(x)-'input'-'input_hash'||jsonb_build_object('reason',x.input->>'reason'))order by x.decision_sequence desc),'[]')into v_rows from public.knowledge_web_policy_decisions x where property_id=p_property_id and org_id=v_org;
 v_total:=jsonb_array_length(v_rows);v_hash:=public.knowledge_hash(v_rows);if p_input?'expectedHash'and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v order by n),'[]')into v_items from jsonb_array_elements(v_rows)with ordinality p(v,n)where n>v_offset and n<=v_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'policy',case when q.property_id is not null then to_jsonb(q)end,'ownerAuthorized',case when q.property_id is null then true else exists(select 1 from public.profiles u where u.id=q.owner_id and u.org_id=v_org and u.role in('admin','manager'))end,'publishedWebsites',v_source_count,'scheduledToday',v_scheduled,'items',v_items,'total',v_total,'historyHash',v_hash,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end);
end$$;

create or replace function public.guard_knowledge_web_capture()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Website capture evidence is retained';end if;
 if coalesce(current_setting('p11.knowledge_web_scope',true),'')<>old.property_id::text then raise exception 'Use a recorded website capture decision';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.input,new.input_hash,new.parent_capture_id,new.capture_sequence,new.created_at,new.origin,new.policy_id,new.policy_revision,new.source_material_id,new.source_version_id)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.input,old.input_hash,old.parent_capture_id,old.capture_sequence,old.created_at,old.origin,old.policy_id,old.policy_revision,old.source_material_id,old.source_version_id)then raise exception 'Website request identity is immutable';end if;
 if(old.claim_token is not null and(new.claim_token,new.started_at)is distinct from(old.claim_token,old.started_at))or(old.receipt is not null and(new.receipt,new.receipt_hash,new.finished_at)is distinct from(old.receipt,old.receipt_hash,old.finished_at))or(old.accepted_version_id is not null and(new.accepted_version_id,new.material_id)is distinct from(old.accepted_version_id,old.material_id))then raise exception 'Website receipts are immutable';end if;
 new.revision:=old.revision+1;return new;
end$$;
create or replace function public.claim_knowledge_web_capture(p_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_capture public.knowledge_web_captures;v_token uuid;
begin
 select *into v_capture from public.knowledge_web_captures where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_capture.property_id::text,12));select *into v_capture from public.knowledge_web_captures where id=p_id for update;
 if not public.knowledge_web_capture_authorized(v_capture)then return'{"state":"forbidden"}';end if;
 if v_capture.state<>'queued'then return jsonb_build_object('state',v_capture.state);end if;
 v_token:=gen_random_uuid();perform set_config('p11.knowledge_web_scope',v_capture.property_id::text,true);
 update public.knowledge_web_captures set state='running',claim_token=v_token,started_at=clock_timestamp()where id=p_id;
 perform public.knowledge_web_service_event(p_id,v_capture.property_id,v_capture.org_id,'knowledge.web.started',jsonb_build_object('captureId',p_id));
 return jsonb_build_object('state','invoke_once','claimToken',v_token,'url',v_capture.input->>'url');
end$$;
create or replace function public.record_knowledge_web_capture(p_id uuid,p_claim_token uuid,p_receipt jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_capture public.knowledge_web_captures;v_state text;
begin
 select *into v_capture from public.knowledge_web_captures where id=p_id;if not found then return'{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_capture.property_id::text,12));select *into v_capture from public.knowledge_web_captures where id=p_id for update;
 if p_claim_token is null or v_capture.claim_token is distinct from p_claim_token then return'{"state":"request_conflict"}';end if;
 if v_capture.receipt is not null then if v_capture.receipt<>p_receipt then return'{"state":"receipt_changed"}';end if;return jsonb_build_object('state',v_capture.state,'receiptHash',v_capture.receipt_hash);end if;
 if jsonb_typeof(p_receipt)is distinct from'object'or octet_length(p_receipt::text)>8388608 then raise exception 'Retain one bounded website receipt';end if;
 v_state:=case when v_capture.state='stopped'then'stopped'when public.valid_knowledge_web_receipt(p_receipt,v_capture.input->>'url',v_capture.started_at)and public.knowledge_web_capture_authorized(v_capture)then'ready'else'held'end;
 perform set_config('p11.knowledge_web_scope',v_capture.property_id::text,true);
 update public.knowledge_web_captures set state=v_state,receipt=p_receipt,receipt_hash=public.knowledge_hash(p_receipt),finished_at=clock_timestamp()where id=p_id;
 perform public.knowledge_web_service_event(p_id,v_capture.property_id,v_capture.org_id,'knowledge.web.received',jsonb_build_object('captureId',p_id,'captureState',v_state,'receiptHash',public.knowledge_hash(p_receipt),'complete',p_receipt->'complete'));
 return jsonb_build_object('state',v_state,'receiptHash',public.knowledge_hash(p_receipt));
end$$;
create or replace function public.cancel_unused_knowledge_decision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_policy public.knowledge_web_policy_decisions;v_web public.knowledge_web_decisions;v_unit public.property_unit_decisions;v_fact public.assistant_fact_decisions;v_file public.knowledge_file_decisions;v_org uuid;v_prior public.knowledge_material_decisions;v_cancelled public.knowledge_cancelled_decisions;v_event jsonb;v_event_id uuid:=md5('knowledge-cancel:'||p_id::text)::uuid;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or p_input-array['inputHash','reason']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review the unused request before cancelling';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,886));
 select *into v_policy from public.knowledge_web_policy_decisions where id=p_id;if found then if(v_policy.property_id,v_policy.org_id,v_policy.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_policy.result||'{"state":"replayed","decisionDomain":"knowledge_web_policy"}';end if;
 select *into v_web from public.knowledge_web_decisions where id=p_id;if found then if(v_web.property_id,v_web.org_id,v_web.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_web.result||'{"state":"replayed","decisionDomain":"knowledge_web"}';end if;
 select *into v_unit from public.property_unit_decisions where id=p_id;
 if found then if(v_unit.property_id,v_unit.org_id,v_unit.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_unit.result||'{"state":"replayed","decisionDomain":"property_units"}';end if;
 select *into v_file from public.knowledge_file_decisions where id=p_id;
 if found then if(v_file.property_id,v_file.org_id,v_file.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_file.result||'{"state":"replayed","decisionDomain":"knowledge_files"}';end if;
 select *into v_fact from public.assistant_fact_decisions where id=p_id;
 if found then if(v_fact.property_id,v_fact.org_id,v_fact.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_fact.result||'{"state":"replayed","cancelled":false,"decisionDomain":"assistant_facts"}';end if;
 select *into v_prior from public.knowledge_material_decisions where id=p_id;
 if found then if(v_prior.property_id,v_prior.org_id,v_prior.actor_id)is distinct from(p_property_id,v_org,p_actor_id)then return'{"state":"request_conflict"}';end if;return v_prior.result||'{"state":"replayed","cancelled":false}';end if;
 select *into v_cancelled from public.knowledge_cancelled_decisions where id=p_id;
 if found then if(v_cancelled.property_id,v_cancelled.org_id,v_cancelled.actor_id,v_cancelled.input_hash,v_cancelled.reason)is distinct from(p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;return'{"state":"cancelled","cancelled":true}';end if;
 insert into public.knowledge_cancelled_decisions(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason');
 v_event:=public.append_shared_action_event(v_event_id,v_event_id,p_property_id,p_actor_id,'knowledge','knowledge.decision.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Cancellation history could not be saved';end if;
 return'{"state":"cancelled","cancelled":true}';
end$$;
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)to service_role;
revoke all on function public.save_knowledge_web_policy(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.save_knowledge_web_policy(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.guard_knowledge_web_policy()from public,anon,authenticated;grant execute on function public.guard_knowledge_web_policy()to service_role;
revoke all on function public.knowledge_web_capture_authorized(public.knowledge_web_captures)from public,anon,authenticated;grant execute on function public.knowledge_web_capture_authorized(public.knowledge_web_captures)to service_role;
revoke all on function public.dispatch_knowledge_web_checks(integer)from public,anon,authenticated;grant execute on function public.dispatch_knowledge_web_checks(integer)to service_role;
revoke all on function public.read_knowledge_web_policy(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_knowledge_web_policy(uuid,uuid,jsonb)to service_role;
revoke all on function public.guard_knowledge_web_capture()from public,anon,authenticated;grant execute on function public.guard_knowledge_web_capture()to service_role;
revoke all on function public.claim_knowledge_web_capture(uuid)from public,anon,authenticated;grant execute on function public.claim_knowledge_web_capture(uuid)to service_role;
revoke all on function public.record_knowledge_web_capture(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.record_knowledge_web_capture(uuid,uuid,jsonb)to service_role;
revoke all on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.cancel_unused_knowledge_decision(uuid,uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
