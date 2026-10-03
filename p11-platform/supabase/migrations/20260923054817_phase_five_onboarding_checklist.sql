-- Reviewed property checklist. Reported progress never grants provider or launch readiness.
create table public.onboarding_task_workspaces(
 task_id uuid primary key references public.onboarding_tasks(id)on delete cascade,
 property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),
 revision bigint not null default 1 check(revision>0),archived boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create index onboarding_task_workspace_property on public.onboarding_task_workspaces(property_id,org_id);
create table public.onboarding_task_decisions(
 id uuid primary key,task_id uuid not null references public.onboarding_tasks(id)on delete cascade,
 property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 actor_id uuid references public.profiles(id),origin text not null check(origin in('operator','property_setup','default_setup')),
 kind text not null check(kind in('created','saved','archived','restored','setup_completed','initialized')),
 input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb not null,result jsonb not null,
 decision_sequence bigint generated always as identity,created_at timestamptz not null default clock_timestamp(),
 check((origin='default_setup'and actor_id is null)or(origin<>'default_setup'and actor_id is not null)));
create index onboarding_task_decision_property on public.onboarding_task_decisions(property_id,org_id,decision_sequence desc);
create index onboarding_task_decision_task on public.onboarding_task_decisions(task_id,decision_sequence desc);
create table public.onboarding_task_cancellations(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 input_hash text not null,reason text not null,created_at timestamptz not null default clock_timestamp());
alter table public.onboarding_task_workspaces enable row level security;
alter table public.onboarding_task_decisions enable row level security;
alter table public.onboarding_task_cancellations enable row level security;
revoke all on public.onboarding_task_workspaces,public.onboarding_task_decisions,public.onboarding_task_cancellations from public,anon,authenticated;
grant all on public.onboarding_task_workspaces,public.onboarding_task_decisions,public.onboarding_task_cancellations to service_role;
grant usage,select on sequence public.onboarding_task_decisions_decision_sequence_seq to service_role;
revoke all on public.onboarding_tasks from public,anon,authenticated;
create function public.guard_onboarding_task_evidence()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
 raise exception 'Retain checklist decision history';
end$$;
create trigger onboarding_decision_immutable before update or delete on public.onboarding_task_decisions for each row execute function public.guard_onboarding_task_evidence();
create trigger onboarding_cancellation_immutable before update or delete on public.onboarding_task_cancellations for each row execute function public.guard_onboarding_task_evidence();
create function public.guard_onboarding_task()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
 if tg_table_name='onboarding_task_workspaces'then
  if tg_op='DELETE'then raise exception 'Retain checklist workspace';end if;
  if current_setting('p11.checklist_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded checklist decision';end if;
  if tg_op='UPDATE'and(new.task_id,new.property_id,new.org_id,new.created_at)is distinct from(old.task_id,old.property_id,old.org_id,old.created_at)then raise exception 'Checklist scope is immutable';end if;
 elsif exists(select 1 from public.onboarding_task_workspaces where task_id=old.id)then
  if tg_op='DELETE'then raise exception 'Archive a reviewed checklist task';end if;
  if current_setting('p11.checklist_scope',true)is distinct from old.property_id::text then raise exception 'Use a recorded checklist decision';end if;
  if(new.id,new.property_id,new.created_at,new.task_type)is distinct from(old.id,old.property_id,old.created_at,old.task_type)then raise exception 'Checklist identity is immutable';end if;
 end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger onboarding_task_review_guard before update or delete on public.onboarding_tasks for each row execute function public.guard_onboarding_task();
create trigger onboarding_workspace_guard before insert or update or delete on public.onboarding_task_workspaces for each row execute function public.guard_onboarding_task();
create function public.onboarding_task_snapshot(p_task_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('task',to_jsonb(t),'workspace',case when w.task_id is not null then to_jsonb(w)else null end)
 from public.onboarding_tasks t left join public.onboarding_task_workspaces w on w.task_id=t.id where t.id=p_task_id
$$;
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'checklist.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid checklist evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('organization.setup.completed','property.setup.saved','property.created','property.onboarding.completed') then
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
 origin:=case when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create function public.record_onboarding_task_decision(p_id uuid,p_task_id uuid,p_actor_id uuid,p_origin text,p_kind text,p_input jsonb,p_before jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_after jsonb;v_org uuid;v_property uuid;v_result jsonb;v_event jsonb;
begin
 select property_id,org_id into v_property,v_org from public.onboarding_task_workspaces where task_id=p_task_id;
 if v_property is null or current_setting('p11.checklist_scope',true)is distinct from v_property::text then raise exception 'Record the checklist change in its transaction';end if;
 v_after:=public.onboarding_task_snapshot(p_task_id);
 v_result:=jsonb_build_object('state','saved','propertyId',v_property,'taskId',p_task_id,'decisionId',p_id,'revision',v_after->'workspace'->'revision','reportedStatus',v_after->'task'->'status','verifiedReadiness',false,'connectionsActivated',false);
 insert into public.onboarding_task_decisions(id,task_id,property_id,org_id,actor_id,origin,kind,input,input_hash,before_state,after_state,result)values(p_id,p_task_id,v_property,v_org,p_actor_id,p_origin,p_kind,p_input,public.knowledge_hash(p_input),p_before,v_after,v_result);
 if p_origin='default_setup'then
  insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(p_id,v_org,v_property,'property.setup','workflow');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,after_state,result)
  values(p_id,p_id,v_org,v_property,'property.setup','property','checklist.initialized','server_confirmed','succeeded',jsonb_build_object('inputHash',public.knowledge_hash(p_input)),jsonb_build_object('hash',public.knowledge_hash(v_after)),v_result);
 else
  v_event:=public.append_shared_action_event(p_id,p_id,v_property,p_actor_id,'property','checklist.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.knowledge_hash(p_input),'origin',p_origin),case when p_before is not null then jsonb_build_object('hash',public.knowledge_hash(p_before))end,jsonb_build_object('hash',public.knowledge_hash(v_after)),v_result);
  if v_event->>'state'not in('recorded','replayed')then raise exception 'Checklist activity could not be saved';end if;
 end if;
 return v_result;
end$$;
create function public.decide_onboarding_task(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_prior public.onboarding_task_decisions;v_cancel public.onboarding_task_cancellations;v_task public.onboarding_tasks;v_workspace public.onboarding_task_workspaces;v_id uuid;v_before jsonb;v_op text:=p_input->>'operation';v_kind text;v_fields jsonb:=p_input->'fields';v_key text;v_event jsonb;v_event_id uuid;v_result jsonb;
begin
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>32768 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 or v_op is null or v_op not in('create','save','archive','restore','cancel_unused')then raise exception 'Review the checklist change and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and p.org_id=v_org and u.id=p_actor_id and u.role in('admin','manager')for update of p for share of u;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,927));
 select *into v_prior from public.onboarding_task_decisions where id=p_id;
 if found then
  if(v_prior.property_id,v_prior.org_id,v_prior.actor_id)is distinct from(p_property_id,v_org,p_actor_id)or(v_op<>'cancel_unused'and v_prior.input<>p_input)then return'{"state":"request_conflict"}';end if;
  return v_prior.result||'{"state":"replayed"}';
 end if;
 select *into v_cancel from public.onboarding_task_cancellations where id=p_id;
 if found then
  if v_op<>'cancel_unused'then return'{"state":"decision_cancelled"}';end if;
  if(v_cancel.property_id,v_cancel.org_id,v_cancel.actor_id,v_cancel.input_hash,v_cancel.reason)is distinct from(p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason')then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);
 end if;
 if v_op='cancel_unused'then
  if p_input-array['operation','reason','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused request digest';end if;
  insert into public.onboarding_task_cancellations(id,property_id,org_id,actor_id,input_hash,reason)values(p_id,p_property_id,v_org,p_actor_id,p_input->>'inputHash',p_input->>'reason');
  v_event_id:=md5('checklist-cancel:'||p_id::text)::uuid;
  v_event:=public.append_shared_action_event(v_event_id,v_event_id,p_property_id,p_actor_id,'property','checklist.cancelled','server_confirmed','succeeded',jsonb_build_object('unusedRequestId',p_id,'browserInputHash',p_input->>'inputHash'),null,null,'{"cancelled":true}');
  if v_event->>'state'not in('recorded','replayed')then raise exception 'Cancellation activity could not be saved';end if;
  return jsonb_build_object('state','cancelled','propertyId',p_property_id,'decisionId',p_id);
 end if;
 if exists(select 1 from public.onboarding_task_workspaces w join public.onboarding_tasks t on t.id=w.task_id where t.property_id=p_property_id and(w.org_id<>v_org or w.property_id<>p_property_id))then return'{"state":"scope_changed"}';end if;
 if v_op in('create','save')then
  if p_input-array['operation','reason','taskId','expectedHash','fields','confirmed']<>'{}'or jsonb_typeof(v_fields)is distinct from'object'or v_fields-array['name','description','category','priority','status','notes','blockedReason']<>'{}'or not(v_fields?&array['name','description','category','priority','status','notes','blockedReason'])then raise exception 'Review every supported task field';end if;
  foreach v_key in array array['name','description','category','status','notes','blockedReason']loop
   if jsonb_typeof(v_fields->v_key)is distinct from'string'or length(v_fields->>v_key)>(case when v_key='name'then 200 when v_key in('category','status')then 30 else 4000 end)then raise exception 'Task field exceeds its supported size';end if;
  end loop;
  if length(btrim(v_fields->>'name'))<1 or v_fields->>'status'not in('pending','in_progress','completed','blocked','skipped')or v_fields->>'category'not in('setup','documents','integrations','billing','training','general')or jsonb_typeof(v_fields->'priority')is distinct from'number'or(v_fields->>'priority')::numeric<>trunc((v_fields->>'priority')::numeric)or(v_fields->>'priority')::numeric not between 0 and 100 then raise exception 'Choose supported task details';end if;
  if v_fields->>'status'='blocked'and length(btrim(v_fields->>'blockedReason'))<3 then raise exception 'Explain what blocks this task';end if;
  if v_fields->>'status'='completed'and p_input->'confirmed'is distinct from'true'then raise exception 'Confirm this is reported progress only';end if;
  if p_input?'confirmed'and jsonb_typeof(p_input->'confirmed')is distinct from'boolean'then raise exception 'Invalid task confirmation';end if;
 else
  if p_input-array['operation','reason','taskId','expectedHash']<>'{}'then raise exception 'Review the exact task before archiving or restoring';end if;
 end if;
 if v_op='create'then
  if p_input?'taskId'or p_input?'expectedHash'or v_fields->>'status'<>'pending'then raise exception 'New tasks begin pending with a new request identity';end if;
  v_id:=p_id;v_kind:='created';
  if exists(select 1 from public.onboarding_tasks where id=v_id)then return'{"state":"request_conflict"}';end if;
 else
  v_id:=(p_input->>'taskId')::uuid;
  select *into v_task from public.onboarding_tasks where id=v_id and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;
  select *into v_workspace from public.onboarding_task_workspaces where task_id=v_id;
  if found and(v_workspace.property_id,v_workspace.org_id)is distinct from(p_property_id,v_org)then return'{"state":"scope_changed"}';end if;
  v_before:=public.onboarding_task_snapshot(v_id);
  if p_input->>'expectedHash'is distinct from public.knowledge_hash(v_before)then return'{"state":"task_changed"}';end if;
  if coalesce(v_workspace.archived,false)and v_op<>'restore'then return'{"state":"task_archived"}';end if;
  if v_op='restore'and not coalesce(v_workspace.archived,false)then return'{"state":"task_changed"}';end if;
  v_kind:=case v_op when'save'then'saved'when'archive'then'archived'else'restored'end;
 end if;
 perform set_config('p11.checklist_scope',p_property_id::text,true);
 if v_op='create'then insert into public.onboarding_tasks(id,property_id,task_type,task_name,description,category,priority,status,notes,blocked_reason)values(v_id,p_property_id,'other',v_fields->>'name',nullif(v_fields->>'description',''),v_fields->>'category',(v_fields->>'priority')::int,'pending',nullif(v_fields->>'notes',''),nullif(v_fields->>'blockedReason',''));
 elsif v_op='save'then
  update public.onboarding_tasks set task_name=v_fields->>'name',description=nullif(v_fields->>'description',''),category=v_fields->>'category',priority=(v_fields->>'priority')::int,status=v_fields->>'status',notes=nullif(v_fields->>'notes',''),blocked_reason=nullif(v_fields->>'blockedReason',''),completed_at=case when v_fields->>'status'='completed'then case when v_task.status='completed'then v_task.completed_at else clock_timestamp()end else null end,completed_by=case when v_fields->>'status'='completed'then case when v_task.status='completed'then v_task.completed_by else p_actor_id end else null end where id=v_id;
 end if;
 insert into public.onboarding_task_workspaces(task_id,property_id,org_id,archived)values(v_id,p_property_id,v_org,v_op='archive')on conflict(task_id)do update set revision=onboarding_task_workspaces.revision+1,archived=excluded.archived,updated_at=clock_timestamp();
 v_result:=public.record_onboarding_task_decision(p_id,v_id,p_actor_id,'operator',v_kind,p_input,v_before);
 perform set_config('p11.checklist_scope','',true);return v_result;
end$$;
create or replace function public.create_default_onboarding_tasks(p_property_id uuid)returns void language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_id uuid;v_event uuid;t record;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));select org_id into v_org from public.properties where id=p_property_id for update;if v_org is null then raise exception 'Choose a saved property';end if;
 perform set_config('p11.checklist_scope',p_property_id::text,true);
 for t in select *from(values
 ('details','intake_form','Complete community details','Review the property facts and save the setup details.','setup',100),
 ('contacts','intake_form','Add contact information','Review the property contacts and their roles.','setup',95),
 ('brochure','doc_upload','Upload property brochure','Retain the private original and review knowledge before publication.','documents',90),
 ('pets','doc_upload','Upload pet policy','Review the current pet policy in Knowledge Base.','documents',80),
 ('guidelines','doc_upload','Upload community guidelines','Review community guidance in Knowledge Base.','documents',70),
 ('analytics','ga4_access','Connect Google Analytics','Review the account connection and its verified status in Integrations.','integrations',85),
 ('google_ads','google_ads_access','Connect Google Ads','Review the account connection and its verified status in Integrations.','integrations',84),
 ('meta','meta_access','Connect Meta Ads','Review the account connection and its verified status in Integrations.','integrations',83),
 ('billing','payment_setup','Set up billing','Review billing contacts and the approved billing workflow.','billing',75)
 )as x(key,kind,name,description,category,priority)loop
  v_id:=md5('property-checklist:'||p_property_id::text||':'||t.key)::uuid;
  if exists(select 1 from public.onboarding_tasks where id=v_id or(property_id=p_property_id and task_type=t.kind and task_name=t.name))then continue;end if;
  insert into public.onboarding_tasks(id,property_id,task_type,task_name,description,category,priority)values(v_id,p_property_id,t.kind,t.name,t.description,t.category,t.priority);
  insert into public.onboarding_task_workspaces(task_id,property_id,org_id)values(v_id,p_property_id,v_org);
  v_event:=md5('checklist-initialized:'||v_id::text)::uuid;
  perform public.record_onboarding_task_decision(v_event,v_id,null,'default_setup','initialized',jsonb_build_object('defaultKey',t.key,'reason','Initialize the property setup checklist'),null);
 end loop;
 perform set_config('p11.checklist_scope','',true);
end$$;
create function public.complete_property_setup_tasks(p_decision_id uuid,p_property_id uuid,p_actor_id uuid)returns void language plpgsql security invoker set search_path=''as $$
declare t public.onboarding_tasks;v_org uuid;v_before jsonb;v_id uuid;
begin
 if current_setting('p11.property_setup_scope',true)is distinct from p_property_id::text then raise exception 'Complete checklist facts within reviewed property setup';end if;
 select p.org_id into v_org from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if v_org is null then raise exception 'Property setup authority changed';end if;
 perform set_config('p11.checklist_scope',p_property_id::text,true);
 for t in select *from public.onboarding_tasks where property_id=p_property_id and task_type='intake_form'and task_name in('Complete community details','Add contact information')and status in('pending','in_progress')order by id for update loop
  if exists(select 1 from public.onboarding_task_workspaces w where task_id=t.id and(w.org_id<>v_org or w.property_id<>p_property_id))then raise exception 'Checklist scope requires review';end if;
  if exists(select 1 from public.onboarding_task_workspaces w where task_id=t.id and w.archived)then continue;end if;
  v_before:=public.onboarding_task_snapshot(t.id);v_id:=md5('setup-checklist:'||p_decision_id::text||':'||t.id::text)::uuid;
  update public.onboarding_tasks set status='completed',completed_at=clock_timestamp(),completed_by=p_actor_id where id=t.id;
  insert into public.onboarding_task_workspaces(task_id,property_id,org_id)values(t.id,p_property_id,v_org)on conflict(task_id)do update set revision=onboarding_task_workspaces.revision+1,updated_at=clock_timestamp();
  perform public.record_onboarding_task_decision(v_id,t.id,p_actor_id,'property_setup','setup_completed',jsonb_build_object('setupDecisionId',p_decision_id,'reason','Completed reviewed property facts and contacts'),v_before);
 end loop;
 perform set_config('p11.checklist_scope','',true);
end$$;
create or replace function public.save_property_setup(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_role text;v_property public.properties;v_saved public.property_setup_changes;v_before jsonb;v_after jsonb;v_hash text;v_after_hash text;v_profile jsonb;v_contact jsonb;v_request jsonb;v_event jsonb;v_sections jsonb:='[]';v_invalidated boolean:=false;v_now timestamptz:=clock_timestamp();v_key text;v_value jsonb;v_contact_id uuid;v_action text:='property.setup.saved';v_complete boolean:=false;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if v_org is null or not coalesce(v_role in('admin','manager'),false)then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object' or p_input-array['expectedHash','profile','contacts','connectionRequests','reason','completeOnboarding']<>'{}' or not(p_input?&array['expectedHash','profile','contacts','connectionRequests','reason'])or octet_length(p_input::text)>524288 or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 or coalesce(p_input->>'expectedHash','')!~'^[a-f0-9]{64}$'then raise exception 'Invalid property edit';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select *into v_property from public.properties where id=p_property_id and org_id=v_org for update;
 if not found or not exists(select 1 from public.profiles where id=p_actor_id and org_id=v_org and role in('admin','manager'))then return '{"state":"forbidden"}';end if;
 -- Serialize identical identities across properties too, then recheck saved scope.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,852));
 select *into v_saved from public.property_setup_changes where id=p_id;
 if found then
  if(v_saved.property_id,v_saved.org_id,v_saved.actor_id,v_saved.input)is distinct from(p_property_id,v_org,p_actor_id,p_input)then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','id',v_saved.id,'afterHash',v_saved.after_hash,'contextInvalidated',v_saved.context_invalidated,'setupCompleted',coalesce((v_saved.input->>'completeOnboarding')::boolean,false),'changedSections',v_saved.changed_sections);
 end if;
 perform 1 from public.property_contacts where property_id=p_property_id for update;
 if p_input?'completeOnboarding'and jsonb_typeof(p_input->'completeOnboarding')is distinct from'boolean'then raise exception 'Invalid setup completion decision';end if;
 v_complete:=coalesce((p_input->>'completeOnboarding')::boolean,false);
 if v_complete and v_property.onboarding_completed_at is not null then return '{"state":"already_completed"}';end if;
 v_before:=public.property_edit_snapshot(p_property_id);v_hash:=encode(extensions.digest(v_before::text,'sha256'),'hex');
 if v_hash<>p_input->>'expectedHash'then return '{"state":"source_changed"}';end if;
 v_profile:=p_input->'profile';
 if jsonb_typeof(v_profile)is distinct from'object'or v_profile-array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience']<>'{}' or not(v_profile?&array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience'])then raise exception 'Invalid property facts';end if;
 foreach v_key in array array['name','websiteUrl','brandVoice','targetAudience']loop
  if jsonb_typeof(v_profile->v_key)is distinct from'string'or length(v_profile->>v_key)>(case when v_key='name'then 300 else 4000 end) then raise exception 'Invalid property text';end if;
 end loop;
 if length(btrim(v_profile->>'name'))<1 then raise exception 'Property name is required';end if;
 if v_profile->'propertyType'<>'null'::jsonb and (jsonb_typeof(v_profile->'propertyType')is distinct from'string'or(v_profile->>'propertyType'not in('multifamily','senior','student','mixed_use','affordable','luxury','townhome','condo','single_family','master_planned')and v_profile->'propertyType'is distinct from v_before->'profile'->'propertyType'))then raise exception 'Select a supported property classification';end if;
 foreach v_key in array array['unitCount','yearBuilt']loop
  if v_profile->v_key<>'null'::jsonb and (jsonb_typeof(v_profile->v_key)is distinct from'number'or(v_profile->>v_key)!~'^\d+$'or(v_profile->>v_key)::numeric>(case when v_key='unitCount'then 1000000 else 9999 end) or(v_key='yearBuilt'and(v_profile->>v_key)::numeric<1))then raise exception 'Use a whole nonnegative unit count and a valid year';end if;
 end loop;
 if jsonb_typeof(v_profile->'address')is distinct from'object'or (v_profile->'address')-array['street','city','state','zip']<>'{}'or not(v_profile->'address'?&array['street','city','state','zip'])then raise exception 'Invalid property address';end if;
 for v_key,v_value in select *from jsonb_each(v_profile->'address')loop if jsonb_typeof(v_value)is distinct from'string'or length(v_value#>>'{}')>500 then raise exception 'Invalid property address';end if;end loop;
 foreach v_key in array array['additionalUrls','amenities','specialFeatures']loop
  if jsonb_typeof(v_profile->v_key)is distinct from'array'or jsonb_array_length(v_profile->v_key)>(case when v_key='additionalUrls'then 50 else 200 end) then raise exception 'Property list exceeds its supported size';end if;
  for v_value in select value from jsonb_array_elements(v_profile->v_key)loop if jsonb_typeof(v_value)is distinct from'string'or length(btrim(v_value#>>'{}'))not between 1 and 4000 then raise exception 'Invalid property list';end if;end loop;
 end loop;
 -- These are stored references only; no URL is fetched by this operation.
 for v_value in select value from jsonb_array_elements((v_profile->'additionalUrls')||jsonb_build_array(v_profile->>'websiteUrl'))loop
  if(v_value#>>'{}')<>''and(v_value#>>'{}')!~'^https?://[^[:space:]@]+$'then raise exception 'Use an HTTP or HTTPS website address without embedded credentials';end if;
 end loop;
 if jsonb_typeof(p_input->'contacts')is distinct from'array'or jsonb_array_length(p_input->'contacts')>100 then raise exception 'Edit at most 100 contacts in one property save';end if;
 if(select count(*)<>count(distinct c->>'id')from jsonb_array_elements(p_input->'contacts')c)then raise exception 'Contact identities must be unique';end if;
 if(select count(*)>1 from jsonb_array_elements(p_input->'contacts')c where c->>'type'='primary'or c->'isPrimary'='true')then raise exception 'Choose at most one primary contact';end if;
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  if jsonb_typeof(v_contact)is distinct from'object'or v_contact-array['id','type','name','email','phone','role','billingAddress','billingMethod','specialInstructions','needsW9','isPrimary']<>'{}'or not(v_contact?&array['id','type','name','email','phone','role','billingAddress','billingMethod','specialInstructions','needsW9','isPrimary'])then raise exception 'Invalid contact';end if;
  v_contact_id:=(v_contact->>'id')::uuid;
  if v_contact_id is null or exists(select 1 from public.property_contacts c where c.id=v_contact_id and c.property_id<>p_property_id)then return '{"state":"contact_conflict"}';end if;
  if v_contact->>'type'not in('primary','secondary','billing','emergency')or jsonb_typeof(v_contact->'needsW9')is distinct from'boolean'or jsonb_typeof(v_contact->'isPrimary')is distinct from'boolean'then raise exception 'Invalid contact type';end if;
  foreach v_key in array array['name','email','phone','role','billingMethod','specialInstructions']loop
   if jsonb_typeof(v_contact->v_key)is distinct from'string'or length(v_contact->>v_key)>(case when v_key='specialInstructions'then 4000 else 500 end) then raise exception 'Invalid contact details';end if;
  end loop;
  if length(btrim(v_contact->>'name'))<1 or v_contact->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise exception 'Each contact needs a name and email address';end if;
  if v_contact->>'billingMethod'not in('','ops_merchant','nexus','ach','check','credit_card','other')then raise exception 'Invalid billing method';end if;
  if jsonb_typeof(v_contact->'billingAddress')is distinct from'object'or (v_contact->'billingAddress')-array['street','city','state','zip']<>'{}'or not(v_contact->'billingAddress'?&array['street','city','state','zip'])then raise exception 'Invalid billing address';end if;
  for v_key,v_value in select *from jsonb_each(v_contact->'billingAddress')loop if jsonb_typeof(v_value)is distinct from'string'or length(v_value#>>'{}')>500 then raise exception 'Invalid billing address';end if;end loop;
 end loop;
 if jsonb_typeof(p_input->'connectionRequests')is distinct from'array'or jsonb_array_length(p_input->'connectionRequests')>11 then raise exception 'Invalid connection requests';end if;
 if(select count(*)<>count(distinct x->>'platform')from jsonb_array_elements(p_input->'connectionRequests')x)then raise exception 'Connection requests must be unique';end if;
 for v_request in select value from jsonb_array_elements(p_input->'connectionRequests')loop
  if jsonb_typeof(v_request)is distinct from'object'or v_request-array['platform','accountId','accountName','notes']<>'{}'or not(v_request?&array['platform','accountId','accountName','notes'])or v_request->>'platform'not in('google_analytics','google_search_console','google_tag_manager','google_ads','google_business_profile','meta_ads','linkedin_ads','tiktok_ads','email_marketing','crm','pms')then raise exception 'Invalid connection request';end if;
  foreach v_key in array array['platform','accountId','accountName','notes']loop if jsonb_typeof(v_request->v_key)is distinct from'string'or length(v_request->>v_key)>(case when v_key='notes'then 4000 else 500 end) then raise exception 'Invalid connection request details';end if;end loop;
 end loop;
 if v_complete and not exists(select 1 from jsonb_array_elements(p_input->'contacts')c where c->>'type'='primary')then raise exception 'A primary contact is required to complete setup';end if;
 perform set_config('p11.property_setup_scope',p_property_id::text,true);
 update public.properties set name=btrim(v_profile->>'name'),property_type=v_profile->>'propertyType',address=coalesce(address,'{}')||(v_profile->'address'),website_url=nullif(v_profile->>'websiteUrl',''),unit_count=(v_profile->>'unitCount')::integer,year_built=(v_profile->>'yearBuilt')::integer,
 amenities=array(select jsonb_array_elements_text(v_profile->'amenities')),special_features=array(select jsonb_array_elements_text(v_profile->'specialFeatures')),brand_voice=nullif(v_profile->>'brandVoice',''),target_audience=nullif(v_profile->>'targetAudience',''),settings=coalesce(settings,'{}')||jsonb_build_object('additionalUrls',v_profile->'additionalUrls','city',v_profile->'address'->>'city'),updated_at=v_now where id=p_property_id;
 delete from public.property_contacts c where c.property_id=p_property_id and not exists(select 1 from jsonb_array_elements(p_input->'contacts')x where(x->>'id')::uuid=c.id);
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  insert into public.property_contacts(id,property_id,contact_type,name,email,phone,role,billing_address,billing_method,special_instructions,needs_w9,is_primary,updated_at)
  values((v_contact->>'id')::uuid,p_property_id,v_contact->>'type',v_contact->>'name',v_contact->>'email',nullif(v_contact->>'phone',''),nullif(v_contact->>'role',''),v_contact->'billingAddress',nullif(v_contact->>'billingMethod',''),nullif(v_contact->>'specialInstructions',''),(v_contact->>'needsW9')::boolean,(v_contact->>'isPrimary')::boolean,v_now)
  on conflict(id)do update set contact_type=excluded.contact_type,name=excluded.name,email=excluded.email,phone=excluded.phone,role=excluded.role,billing_address=coalesce(public.property_contacts.billing_address,'{}')||excluded.billing_address,billing_method=excluded.billing_method,special_instructions=excluded.special_instructions,needs_w9=excluded.needs_w9,is_primary=excluded.is_primary,updated_at=excluded.updated_at where public.property_contacts.property_id=p_property_id;
 end loop;
 insert into public.property_setup_state(property_id,org_id,connection_requests,updated_at)values(p_property_id,v_org,p_input->'connectionRequests',v_now)on conflict(property_id)do update set connection_requests=excluded.connection_requests,org_id=excluded.org_id,updated_at=excluded.updated_at;
 v_after:=public.property_edit_snapshot(p_property_id);v_after_hash:=encode(extensions.digest(v_after::text,'sha256'),'hex');
 foreach v_key in array array['profile','contacts','connectionRequests']loop if v_before->v_key is distinct from v_after->v_key then v_sections:=v_sections||jsonb_build_array(v_key);end if;end loop;
 if v_before->'profile'is distinct from v_after->'profile'or v_before->'contextCity'is distinct from v_after->'contextCity'then
  update public.property_chatbot_contexts set status='stale',stale_at=v_now,last_change_summary='Saved property facts changed; refresh assistant facts before serving the new version.',version=version+1,updated_at=v_now where property_id=p_property_id;
  v_invalidated:=found;
 end if;
 if exists(select 1 from public.property_creation_requests r where r.id=p_id and r.property_id=p_property_id and r.actor_id=p_actor_id and r.org_id=v_org)then v_action:='property.created';end if;
 if v_complete then
  v_action:='property.onboarding.completed';v_sections:=v_sections||jsonb_build_array('setup');
  update public.properties set onboarding_completed_at=clock_timestamp()where id=p_property_id;
  perform public.complete_property_setup_tasks(p_id,p_property_id,p_actor_id);
 end if;
 insert into public.property_setup_changes(id,property_id,org_id,actor_id,input,before_state,after_state,before_hash,after_hash,changed_sections,context_invalidated)values(p_id,p_property_id,v_org,p_actor_id,p_input,v_before,v_after,v_hash,v_after_hash,v_sections,v_invalidated);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property',v_action,'server_confirmed','succeeded',jsonb_build_object('changeId',p_id,'inputHash',encode(extensions.digest(p_input::text,'sha256'),'hex')),jsonb_build_object('hash',v_hash),jsonb_build_object('hash',v_after_hash),jsonb_build_object('changedSections',v_sections,'setupCompleted',v_complete,'contextInvalidated',v_invalidated,'connectionsActivated',false,'websiteFetched',false));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Could not record property change';end if;
 perform set_config('p11.property_setup_scope','',true);
 return jsonb_build_object('state','saved','id',p_id,'afterHash',v_after_hash,'contextInvalidated',v_invalidated,'setupCompleted',v_complete,'changedSections',v_sections);
end$$;
create function public.read_onboarding_tasks(p_property_id uuid,p_actor_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_org uuid;v_role text;v_kind text:=coalesce(p_input->>'kind','list');v_offset int:=coalesce((p_input->>'offset')::int,0);v_rows jsonb;v_items jsonb;v_stats jsonb;v_hash text;v_total int;v_task uuid;v_snap jsonb;d public.onboarding_task_decisions;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if v_org is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','taskId','decisionId','offset','expectedHash']<>'{}'or v_kind not in('list','task','history','decision')or v_offset not between 0 and 1000000 then raise exception 'Choose a checklist task or history page';end if;
 if exists(select 1 from public.onboarding_task_workspaces w join public.onboarding_tasks t on t.id=w.task_id where t.property_id=p_property_id and(w.org_id<>v_org or w.property_id<>p_property_id))then return'{"state":"scope_changed"}';end if;
 if v_kind='decision'then
  select *into d from public.onboarding_task_decisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=v_org and actor_id=p_actor_id;
  if not found then return'{"state":"not_found"}';end if;return d.result||'{"state":"ready"}';
 end if;
 if v_kind in('task','history')then
  v_task:=(p_input->>'taskId')::uuid;select public.onboarding_task_snapshot(id)into v_snap from public.onboarding_tasks where id=v_task and property_id=p_property_id;if not found then return'{"state":"not_found"}';end if;
 end if;
 if v_kind='task'then return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'snapshot',v_snap,'sourceHash',public.knowledge_hash(v_snap));end if;
 if v_kind='history'then
  select coalesce(jsonb_agg(to_jsonb(x)order by x.decision_sequence desc),'[]')into v_rows from public.onboarding_task_decisions x where task_id=v_task and org_id=v_org;
 else
  select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('revision',coalesce(w.revision,0),'archived',coalesce(w.archived,false),'recorded',w.task_id is not null)order by coalesce(w.archived,false),t.priority desc,t.created_at,t.id),'[]')into v_rows from public.onboarding_tasks t left join public.onboarding_task_workspaces w on w.task_id=t.id where t.property_id=p_property_id;
  select jsonb_build_object('total',count(*)filter(where v->'archived'='false'),'archived',count(*)filter(where v->'archived'='true'),'completed',count(*)filter(where v->'archived'='false'and v->>'status'='completed'),'inProgress',count(*)filter(where v->'archived'='false'and v->>'status'='in_progress'),'pending',count(*)filter(where v->'archived'='false'and v->>'status'='pending'),'blocked',count(*)filter(where v->'archived'='false'and v->>'status'='blocked'),'skipped',count(*)filter(where v->'archived'='false'and v->>'status'='skipped'),'progress',coalesce(round(100.0*count(*)filter(where v->'archived'='false'and v->>'status'='completed')/nullif(count(*)filter(where v->'archived'='false'),0)),0))into v_stats from jsonb_array_elements(v_rows)v;
 end if;
 v_total:=jsonb_array_length(v_rows);v_hash:=public.knowledge_hash(v_rows);if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v order by n),'[]')into v_items from jsonb_array_elements(v_rows)with ordinality p(v,n)where n>v_offset and n<=v_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(v_role in('admin','manager'),false),'items',v_items,'tasks',case when v_kind='list'then v_items else'[]'::jsonb end,'stats',v_stats,'total',v_total,'pageHash',v_hash,'nextOffset',case when v_offset+20<v_total then v_offset+20 else null end);
end$$;
revoke all on function public.guard_onboarding_task_evidence()from public,anon,authenticated;grant execute on function public.guard_onboarding_task_evidence()to service_role;
revoke all on function public.guard_onboarding_task()from public,anon,authenticated;grant execute on function public.guard_onboarding_task()to service_role;
revoke all on function public.onboarding_task_snapshot(uuid)from public,anon,authenticated;grant execute on function public.onboarding_task_snapshot(uuid)to service_role;
revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb)to service_role;
revoke all on function public.record_onboarding_task_decision(uuid,uuid,uuid,text,text,jsonb,jsonb)from public,anon,authenticated;grant execute on function public.record_onboarding_task_decision(uuid,uuid,uuid,text,text,jsonb,jsonb)to service_role;
revoke all on function public.decide_onboarding_task(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_onboarding_task(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.create_default_onboarding_tasks(uuid)from public,anon,authenticated;grant execute on function public.create_default_onboarding_tasks(uuid)to service_role;
revoke all on function public.complete_property_setup_tasks(uuid,uuid,uuid)from public,anon,authenticated;grant execute on function public.complete_property_setup_tasks(uuid,uuid,uuid)to service_role;
revoke all on function public.save_property_setup(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.save_property_setup(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_onboarding_tasks(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_onboarding_tasks(uuid,uuid,jsonb)to service_role;
revoke all on function public.get_onboarding_progress(uuid)from public,anon,authenticated;
notify pgrst,'reload schema';
