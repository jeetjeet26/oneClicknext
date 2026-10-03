create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action like 'readiness.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid readiness review evidence';end if;
 elsif p_action like 'neighborhood.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid neighborhood review evidence';end if;
 elsif p_action like 'legal.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid legal review evidence';end if;
 elsif p_action like 'checklist.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid checklist evidence';end if;
 elsif p_action like 'property.unit.%'then
  if p_product<>'property'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid floor-plan evidence';end if;
 elsif p_action like 'knowledge.%' then
  if p_product<>'knowledge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid knowledge decision evidence';end if;
 elsif p_action in('organization.setup.completed','property.setup.saved','property.created','property.onboarding.completed') then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
 elsif p_action like 'pipeline.%' then
  if p_product<>'pipelines'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid pipeline evidence';end if;
 elsif p_action like 'bi.%' then
  if p_product<>'bi' or(p_action='bi.export.reported'and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action<>'bi.export.reported'and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid BI report evidence';end if;
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
 elsif p_action='audit.report.reported'then
  if p_product<>'propertyaudit'or p_evidence<>'browser_observed'or p_phase<>'observed'then raise exception 'Invalid report observation';end if;
 elsif p_action like 'audit.%' then
  if p_product<>'propertyaudit'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid audit decision evidence';end if;
 elsif p_action like 'lead.record.%' then
  if p_product<>'tourspark'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid lead record evidence';end if;
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
 origin:=case when p_action like 'audit.%'then'console' when p_action like 'bi.%'then'console' when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create or replace function public.record_geo_service(p_property_id uuid,p_run_id uuid,p_invocation_id uuid,p_kind text,p_detail jsonb)returns uuid language plpgsql security invoker set search_path=''as $$
declare event_id uuid:=gen_random_uuid();organization uuid;
begin
 select org_id into organization from public.properties where id=p_property_id;
 if organization is null or(p_run_id is not null and not exists(select 1 from public.geo_runs where id=p_run_id and property_id=p_property_id))or(p_invocation_id is not null and not exists(select 1 from public.geo_provider_invocations where id=p_invocation_id and run_id=p_run_id and property_id=p_property_id))or p_kind not in('invocation_started','response_retained','response_applied','execution_claimed','execution_finished','execution_held','crawl_claimed','crawl_checkpoint','crawl_completed','crawl_failed','evaluation_prepared')or jsonb_typeof(p_detail)is distinct from'object'then raise exception 'Invalid audit worker evidence';end if;
 perform set_config('p11.geo_service_scope',p_property_id::text,true);
 insert into public.geo_service_events(id,property_id,org_id,run_id,invocation_id,kind,detail)values(event_id,p_property_id,organization,p_run_id,p_invocation_id,p_kind,p_detail);
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,organization,p_property_id,'propertyaudit.worker','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,'propertyaudit.worker','propertyaudit','audit.worker.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('runId',p_run_id,'invocationId',p_invocation_id),jsonb_build_object('serviceEventId',event_id));
 return event_id;
end$$;
-- Derived evaluations retain their exact original measurement source.
create table public.geo_evaluations(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 run_id uuid references public.geo_runs(id)on delete cascade,evaluator_version text,source jsonb,source_hash text,
 preview jsonb,preview_hash text,state text not null check(state in('prepared','ready','applied','discarded','cancelled')),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,decision_id uuid
);
create index geo_evaluations_property on public.geo_evaluations(property_id,created_at desc,id desc);
create index geo_evaluations_org on public.geo_evaluations(org_id);
create index geo_evaluations_actor on public.geo_evaluations(actor_id);
create index geo_evaluations_run on public.geo_evaluations(run_id);
alter table public.geo_evaluations enable row level security;
revoke all on public.geo_evaluations from public,anon,authenticated;
grant all on public.geo_evaluations to service_role;
create policy geo_evaluations_service on public.geo_evaluations for all to service_role using(true)with check(true);
create function public.guard_geo_evaluation()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  raise exception 'Retain evaluation evidence';
 end if;
 if current_setting('p11.geo_evaluation_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded evaluation';end if;
 if tg_op='UPDATE'then
  if(new.id,new.property_id,new.org_id,new.actor_id,new.run_id,new.source,new.source_hash,new.evaluator_version,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.run_id,old.source,old.source_hash,old.evaluator_version,old.created_at)then raise exception 'Evaluation source is immutable';end if;
  if old.preview is not null and(new.preview,new.preview_hash)is distinct from(old.preview,old.preview_hash)then raise exception 'Evaluation result is immutable';end if;
  if old.state in('applied','discarded','cancelled')and new is distinct from old then raise exception 'Evaluation decision is immutable';end if;
 end if;return new;
end$$;
create trigger geo_evaluations_guard before insert or update or delete on public.geo_evaluations for each row execute function public.guard_geo_evaluation();
create function public.geo_evaluation_source(p_run_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 with captured as(select r.id,r.run_metadata,public.geo_operator_run_source(r.id)||jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'query',i.query_snapshot,'state',i.state,'answerId',i.answer_id)order by i.ordinal)from public.geo_execution_items i where i.run_id=r.id),'[]')) source from public.geo_runs r where r.id=p_run_id)
 select c.source||jsonb_build_object('originalAnswers',coalesce((select e.source->'originalAnswers'from public.geo_evaluations e where e.id::text=c.run_metadata->>'evaluation_id'and e.run_id=c.id and e.state='applied'),c.source->'answers'))from captured c;
$$;
create function public.prepare_geo_evaluation(p_id uuid,p_actor_id uuid,p_property_id uuid,p_run_id uuid,p_source_hash text,p_evaluator_version text,p_cancel boolean default false)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;e public.geo_evaluations;source_value jsonb;result jsonb;action_name text;
begin
 select p.org_id,u.role into organization,member_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found or member_role not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,989));select*into e from public.geo_evaluations where id=p_id for update;
 if found then
  if(e.actor_id,e.property_id,e.org_id)is distinct from(p_actor_id,p_property_id,organization)then return'{"state":"not_found"}';end if;
  if p_cancel and e.state in('prepared','ready')then return'{"state":"review_required"}';end if;
  if not p_cancel and e.state<>'cancelled'and(e.run_id,e.source_hash,e.evaluator_version)is distinct from(p_run_id,p_source_hash,p_evaluator_version)then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','status',e.state,'id',p_id,'propertyId',p_property_id);
 end if;
 perform set_config('p11.geo_evaluation_scope',p_property_id::text,true);
 if p_cancel then
  insert into public.geo_evaluations(id,property_id,org_id,actor_id,state)values(p_id,p_property_id,organization,p_actor_id,'cancelled');action_name:='audit.evaluation.cancelled';
 else
  if length(coalesce(p_evaluator_version,''))not between 8 and 200 or not exists(select 1 from public.geo_runs where id=p_run_id and property_id=p_property_id and status='completed')then return'{"state":"completed_run_required"}';end if;
  source_value:=public.geo_evaluation_source(p_run_id);
  if public.knowledge_hash(source_value)is distinct from p_source_hash then return'{"state":"source_changed"}';end if;
  if source_value#>>'{job,snapshot,property,name}'is null or jsonb_array_length(source_value->'items')=0 or jsonb_array_length(source_value->'answers')=0 then return'{"state":"legacy_source_unavailable"}';end if;
  if octet_length(source_value::text)>16777216 then return'{"state":"source_limit"}';end if;
  insert into public.geo_evaluations(id,property_id,org_id,actor_id,run_id,evaluator_version,source,source_hash,state)values(p_id,p_property_id,organization,p_actor_id,p_run_id,p_evaluator_version,source_value,p_source_hash,'prepared');action_name:='audit.evaluation.requested';
 end if;
 result:=jsonb_build_object('state','saved','status',case when p_cancel then'cancelled'else'prepared'end,'id',p_id,'propertyId',p_property_id);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'propertyaudit',action_name,'server_confirmed','succeeded',jsonb_build_object('evaluationId',p_id),null,null,result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Evaluation history unavailable';end if;
 return result;
end$$;
create function public.finish_geo_evaluation(p_id uuid,p_actor_id uuid,p_property_id uuid,p_source_hash text,p_preview jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare e public.geo_evaluations;item jsonb;row_count integer;
begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager'))then return'{"state":"forbidden"}';end if;
 select*into e from public.geo_evaluations where id=p_id and property_id=p_property_id and actor_id=p_actor_id for update;
 if not found then return'{"state":"not_found"}';end if;
 if e.state in('cancelled','discarded')then return jsonb_build_object('state','saved','status',e.state,'id',p_id,'propertyId',p_property_id);end if;
 if e.source_hash is distinct from p_source_hash then return'{"state":"source_changed"}';end if;
 if e.preview is not null then
  if e.preview is distinct from p_preview then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','status',e.state,'id',p_id,'propertyId',p_property_id);
 end if;
 if jsonb_typeof(p_preview)is distinct from'object'or p_preview-array['answers','aggregate','version','coverage']<>'{}'or p_preview->>'version'is distinct from e.evaluator_version or jsonb_typeof(p_preview->'answers')is distinct from'array'or jsonb_typeof(p_preview->'aggregate')is distinct from'object'or octet_length(p_preview::text)>16777216 then return'{"state":"invalid_input"}';end if;
 row_count:=jsonb_array_length(e.source->'answers');
 if jsonb_array_length(p_preview->'answers')<>row_count or(select count(distinct a->>'id')from jsonb_array_elements(p_preview->'answers')a)<>row_count then return'{"state":"incomplete_evaluation"}';end if;
 for item in select value from jsonb_array_elements(p_preview->'answers')loop
  if not exists(select 1 from jsonb_array_elements(e.source->'answers')a where a#>>'{answer,id}'=item->>'id')or jsonb_typeof(item->'presence')is distinct from'boolean'or jsonb_typeof(item->'flags')is distinct from'array'or jsonb_typeof(item->'ordered_entities')is distinct from'array'or(item->>'llm_rank'is not null and not((item->>'llm_rank')::numeric>=1))or(item->>'link_rank'is not null and not((item->>'link_rank')::numeric>=1))or(item->>'sov'is not null and not((item->>'sov')::numeric between 0 and 1))then return'{"state":"invalid_input"}';end if;
 end loop;
 if ((p_preview#>>'{aggregate,overall_score}')::numeric between 0 and 100)is distinct from true or ((p_preview#>>'{aggregate,visibility_pct}')::numeric between 0 and 100)is distinct from true then return'{"state":"invalid_input"}';end if;
 perform set_config('p11.geo_evaluation_scope',p_property_id::text,true);
 update public.geo_evaluations set preview=p_preview,preview_hash=public.knowledge_hash(p_preview),state='ready',finished_at=clock_timestamp()where id=p_id;
 perform public.record_geo_service(p_property_id,e.run_id,null,'evaluation_prepared',jsonb_build_object('evaluationId',p_id,'sourceHash',e.source_hash,'evaluatorVersion',e.evaluator_version,'answerCount',row_count));
 return jsonb_build_object('state','saved','status','ready','id',p_id,'propertyId',p_property_id);
end$$;
create function public.decide_geo_evaluation(p_id uuid,p_actor_id uuid,p_property_id uuid,p_evaluation_id uuid,p_operation text,p_preview_hash text,p_reason text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;e public.geo_evaluations;cmd public.geo_operator_commands;input_value jsonb;result jsonb;source_value jsonb;item jsonb;metric public.geo_scores;
begin
 select p.org_id,u.role into organization,member_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found or member_role not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null or p_evaluation_id is null or p_operation not in('apply','discard')or length(btrim(coalesce(p_reason,'')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
 input_value:=jsonb_build_object('evaluationId',p_evaluation_id,'operation',p_operation,'previewHash',p_preview_hash,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,981));select*into cmd from public.geo_operator_commands where id=p_id;
 if found then
  if(cmd.actor_id,cmd.property_id,cmd.org_id)is distinct from(p_actor_id,p_property_id,organization)then return'{"state":"not_found"}';end if;
  if cmd.operation='cancel_request'then return cmd.result||'{"state":"replayed"}';end if;
  if cmd.input is distinct from input_value then return'{"state":"request_conflict"}';end if;return cmd.result||'{"state":"replayed"}';
 end if;
 select*into e from public.geo_evaluations where id=p_evaluation_id and property_id=p_property_id and org_id=organization for update;
 if not found then return'{"state":"not_found"}';end if;
 if e.state not in('prepared','ready')or e.preview_hash is distinct from p_preview_hash then return'{"state":"source_changed"}';end if;
 perform set_config('p11.geo_evaluation_scope',p_property_id::text,true);perform set_config('p11.geo_operator_scope',p_property_id::text,true);
 if p_operation='apply'then
  if e.state<>'ready'then return'{"state":"incomplete_evaluation"}';end if;
  perform 1 from public.geo_execution_jobs where run_id=e.run_id for update;perform 1 from public.geo_runs where id=e.run_id and property_id=p_property_id for update;
  source_value:=public.geo_evaluation_source(e.run_id);
  if public.knowledge_hash(source_value)is distinct from e.source_hash then return'{"state":"source_changed"}';end if;
  for item in select value from jsonb_array_elements(e.preview->'answers')loop
   update public.geo_answers set presence=(item->>'presence')::boolean,llm_rank=(item->>'llm_rank')::integer,link_rank=(item->>'link_rank')::integer,sov=(item->>'sov')::numeric,flags=item->'flags',ordered_entities=item->'ordered_entities'where id=(item->>'id')::uuid and run_id=e.run_id;
   if not found then raise exception 'Evaluation answer disappeared';end if;
  end loop;
  metric:=jsonb_populate_record(null::public.geo_scores,e.preview->'aggregate');
  update public.geo_scores set overall_score=metric.overall_score,visibility_pct=metric.visibility_pct,avg_llm_rank=metric.avg_llm_rank,avg_link_rank=metric.avg_link_rank,avg_sov=metric.avg_sov,breakdown=metric.breakdown,query_scores=metric.query_scores where run_id=e.run_id;
  if not found then insert into public.geo_scores(run_id,overall_score,visibility_pct,avg_llm_rank,avg_link_rank,avg_sov,breakdown,query_scores)values(e.run_id,metric.overall_score,metric.visibility_pct,metric.avg_llm_rank,metric.avg_link_rank,metric.avg_sov,metric.breakdown,metric.query_scores);end if;
  update public.geo_runs set run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('evaluation_id',e.id,'evaluator_version',e.evaluator_version)where id=e.run_id;
 end if;
 update public.geo_evaluations set state=case when p_operation='apply'then'applied'else'discarded'end,decision_id=p_id where id=e.id;
 result:=jsonb_build_object('state','saved','status',case when p_operation='apply'then'applied'else'discarded'end,'id',p_id,'propertyId',p_property_id,'evaluationId',e.id,'runId',e.run_id,'verifiedImprovement',false);
 insert into public.geo_operator_commands(id,property_id,org_id,actor_id,operation,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,'evaluation_'||p_operation,input_value,jsonb_build_object('sourceHash',e.source_hash,'evaluationState',e.state),jsonb_build_object('previewHash',e.preview_hash,'evaluationId',e.id,'status',result->>'status'),result);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'propertyaudit','audit.evaluation.'||case when p_operation='apply'then'applied'else'discarded'end,'server_confirmed','succeeded',jsonb_build_object('evaluationId',e.id),null,null,result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Evaluation decision history unavailable';end if;
 return result;
end$$;
create function public.read_geo_evaluations(p_actor_id uuid,p_property_id uuid,p_id uuid default null,p_run_id uuid default null,p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;member_role text;e public.geo_evaluations;source_value jsonb;items jsonb;count_value bigint;hash_value text;
begin
 select p.org_id,u.role into organization,member_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found then return'{"state":"forbidden"}';end if;
 if p_id is not null then
  select*into e from public.geo_evaluations where id=p_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','id',p_id,'propertyId',p_property_id,'canManage',member_role in('admin','manager'),'canResume',e.actor_id=p_actor_id and member_role in('admin','manager'),'record',to_jsonb(e));
 end if;
 if p_offset not between 0 and 1000000 then return'{"state":"invalid_input"}';end if;
 if p_run_id is not null then
  if not exists(select 1 from public.geo_runs where id=p_run_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
  source_value:=public.geo_evaluation_source(p_run_id);
 end if;
 select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,state,preview_hash)order by created_at desc,id desc),'[]'))into count_value,hash_value from public.geo_evaluations where property_id=p_property_id and org_id=organization and(p_run_id is null or run_id=p_run_id);
 if p_hash is not null and p_hash<>hash_value then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(to_jsonb(r)-array['source','preview']order by r.created_at desc,r.id desc),'[]')into items from(select*from public.geo_evaluations where property_id=p_property_id and org_id=organization and(p_run_id is null or run_id=p_run_id)order by created_at desc,id desc offset p_offset limit 25)r;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',member_role in('admin','manager'),'source',source_value,'sourceHash',case when source_value is not null then public.knowledge_hash(source_value)else null end,'items',items,'count',count_value,'hash',hash_value,'offset',p_offset);
end$$;
revoke all on function public.guard_geo_evaluation(),public.geo_evaluation_source(uuid),public.prepare_geo_evaluation(uuid,uuid,uuid,uuid,text,text,boolean),public.finish_geo_evaluation(uuid,uuid,uuid,text,jsonb),public.decide_geo_evaluation(uuid,uuid,uuid,uuid,text,text,text),public.read_geo_evaluations(uuid,uuid,uuid,uuid,integer,text)from public,anon,authenticated;
grant execute on function public.geo_evaluation_source(uuid),public.prepare_geo_evaluation(uuid,uuid,uuid,uuid,text,text,boolean),public.finish_geo_evaluation(uuid,uuid,uuid,text,jsonb),public.decide_geo_evaluation(uuid,uuid,uuid,uuid,text,text,text),public.read_geo_evaluations(uuid,uuid,uuid,uuid,integer,text)to service_role;
-- Authenticated callers cannot rewrite evidence through direct table APIs.
-- Completed derived metrics may only change through the recorded review above.
create function public.guard_geo_measurement_revision()returns trigger language plpgsql security invoker set search_path=''as $$
declare property_value uuid;status_value text;run_value uuid;
begin
 if tg_op='DELETE'then run_value:=old.run_id;else run_value:=new.run_id;end if;
 select property_id,status::text into property_value,status_value from public.geo_runs where id=run_value;
 if tg_op='DELETE'then
  if property_value is null or not exists(select 1 from public.properties where id=property_value)then return old;end if;
  raise exception 'Retain measurement evidence; archive its run';
 end if;
 if current_user='authenticated'then raise exception 'Use recorded measurement operations';end if;
 if tg_op='UPDATE'then
  if new.id<>old.id or new.run_id<>old.run_id then raise exception 'Measurement identity is immutable';end if;
  if tg_table_name='geo_answers'then
   if(new.query_id,new.answer_summary,new.natural_response,new.raw_json,new.analysis_method,new.created_at)is distinct from(old.query_id,old.answer_summary,old.natural_response,old.raw_json,old.analysis_method,old.created_at)then raise exception 'Original measurement response is immutable';end if;
  end if;
  if status_value='completed'and new is distinct from old and current_setting('p11.geo_evaluation_scope',true)is distinct from property_value::text then raise exception 'Review a saved evaluation before changing completed measurements';end if;
 end if;
 return new;
end$$;
create trigger geo_answers_revision_guard before insert or update or delete on public.geo_answers for each row execute function public.guard_geo_measurement_revision();
create trigger geo_scores_revision_guard before insert or update or delete on public.geo_scores for each row execute function public.guard_geo_measurement_revision();
revoke all on function public.guard_geo_measurement_revision()from public,anon,authenticated;
