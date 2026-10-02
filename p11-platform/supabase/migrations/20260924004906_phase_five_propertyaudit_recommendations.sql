create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('audit.analysis.requested','audit.analysis.retried','audit.analysis.cancelled','audit.analysis.stopped','audit.analysis.discarded','audit.analysis.resumed','audit.analysis.applied','audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 if organization is null or(p_run_id is not null and not exists(select 1 from public.geo_runs where id=p_run_id and property_id=p_property_id))or(p_invocation_id is not null and not exists(select 1 from public.geo_provider_invocations where id=p_invocation_id and run_id=p_run_id and property_id=p_property_id))or p_kind not in('invocation_started','response_retained','response_applied','execution_claimed','execution_finished','execution_held','crawl_claimed','crawl_checkpoint','crawl_completed','crawl_failed','evaluation_prepared','analysis_requested','analysis_claimed','analysis_held','analysis_invocation_started','analysis_response_retained','analysis_prepared')or jsonb_typeof(p_detail)is distinct from'object'then raise exception 'Invalid audit worker evidence';end if;
 perform set_config('p11.geo_service_scope',p_property_id::text,true);
 insert into public.geo_service_events(id,property_id,org_id,run_id,invocation_id,kind,detail)values(event_id,p_property_id,organization,p_run_id,p_invocation_id,p_kind,p_detail);
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,organization,p_property_id,'propertyaudit.worker','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,'propertyaudit.worker','propertyaudit','audit.worker.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('runId',p_run_id,'invocationId',p_invocation_id),jsonb_build_object('serviceEventId',event_id));
 return event_id;
end$$;
-- Private recommendation sources, provider receipts and reviewed application.
create table public.geo_analysis_records(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 batch_id uuid,crawl_id uuid references public.geo_site_crawls(id)on delete cascade,
 parent_id uuid references public.geo_analysis_records(id),request_id uuid,
 origin text not null check(origin in('console','workflow')),source jsonb,source_hash text,model_plan jsonb,
 state text not null check(state in('queued','running','ready','applied','discarded','stopped','held','cancelled')),
 lease_token uuid,lease_until timestamptz,invocation jsonb,receipt jsonb,preview jsonb,preview_hash text,
 error_code text,decision_id uuid,created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index geo_analysis_records_property on public.geo_analysis_records(property_id,created_at desc,id desc);
create index geo_analysis_records_org on public.geo_analysis_records(org_id);
create index geo_analysis_records_actor on public.geo_analysis_records(actor_id);
create index geo_analysis_records_crawl on public.geo_analysis_records(crawl_id);
create index geo_analysis_records_parent on public.geo_analysis_records(parent_id);
create index geo_analysis_records_batch on public.geo_analysis_records(batch_id);
alter table public.geo_analysis_records enable row level security;
revoke all on public.geo_analysis_records from public,anon,authenticated;
grant all on public.geo_analysis_records to service_role;
create policy geo_analysis_records_service on public.geo_analysis_records for all to service_role using(true)with check(true);
create function public.guard_geo_analysis_record()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  raise exception 'Retain analysis evidence';
 end if;
 if current_setting('p11.geo_analysis_scope',true)is distinct from new.property_id::text then raise exception 'Use recorded recommendation operations';end if;
 if tg_op='UPDATE'then
  if(new.id,new.property_id,new.org_id,new.actor_id,new.batch_id,new.crawl_id,new.parent_id,new.request_id,new.origin,new.source,new.source_hash,new.model_plan,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.batch_id,old.crawl_id,old.parent_id,old.request_id,old.origin,old.source,old.source_hash,old.model_plan,old.created_at)then raise exception 'Analysis source is immutable';end if;
  if old.invocation is not null and new.invocation is distinct from old.invocation then raise exception 'Analysis invocation is immutable';end if;
  if old.receipt is not null and new.receipt is distinct from old.receipt then raise exception 'Analysis receipt is immutable';end if;
  if old.preview is not null and(new.preview,new.preview_hash)is distinct from(old.preview,old.preview_hash)then raise exception 'Analysis preview is immutable';end if;
  if old.state in('applied','discarded','stopped','cancelled')and(new.state,new.decision_id)is distinct from(old.state,old.decision_id)then raise exception 'Analysis decision is final';end if;
 end if;return new;
end$$;
create trigger geo_analysis_records_guard before insert or update or delete on public.geo_analysis_records for each row execute function public.guard_geo_analysis_record();
create function public.geo_analysis_source(p_property_id uuid,p_batch_id uuid,p_crawl_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('version',1,'property',(select jsonb_build_object('id',id,'name',name,'website_url',website_url,'address',address,'property_type',property_type)from public.properties where id=p_property_id),
 'crawl',(select to_jsonb(c)-array['lease_token','lease_until','frontier']from public.geo_site_crawls c where c.id=p_crawl_id and c.property_id=p_property_id and c.batch_id=p_batch_id),
 'pages',coalesce((select jsonb_agg(to_jsonb(p)order by p.url,p.id)from public.geo_crawl_pages p where p.crawl_id=p_crawl_id),'[]'),
 'findings',coalesce((select jsonb_agg(to_jsonb(f)order by f.id)from public.geo_site_findings f where f.property_id=p_property_id),'[]'),
 'runs',coalesce((select jsonb_agg(public.geo_evaluation_source(r.id)order by r.id)from public.geo_runs r where r.property_id=p_property_id and r.batch_id=p_batch_id),'[]'),
 'currentRecommendations',coalesce((select jsonb_agg(to_jsonb(r)order by r.id)from public.geo_recommendations r where r.property_id=p_property_id and r.is_current),'[]'));
$$;
create function public.geo_analysis_plan_valid(p_plan jsonb)returns boolean language sql immutable security invoker set search_path=''as $$
 select coalesce(jsonb_typeof(p_plan)='object'and p_plan-array['provider','model'] ='{}'and p_plan->>'provider'in('openai','anthropic')and length(p_plan->>'model')between 1 and 200,false);
$$;
create function public.prepare_geo_analysis(p_id uuid,p_actor_id uuid,p_property_id uuid,p_batch_id uuid,p_crawl_id uuid,p_source_hash text,p_plan jsonb,p_parent_id uuid default null,p_cancel boolean default false)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;r public.geo_analysis_records;v_source jsonb;v_result jsonb;v_action text;
begin
 select p.org_id,u.role into organization,member_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found or coalesce(member_role,'')not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,991));select*into r from public.geo_analysis_records where id=p_id for update;
 if found then
  if(r.actor_id,r.property_id,r.org_id)is distinct from(p_actor_id,p_property_id,organization)then return'{"state":"not_found"}';end if;
  if p_cancel and r.state<>'cancelled'then return'{"state":"review_required"}';end if;
  if not p_cancel and r.state<>'cancelled'and(r.batch_id,r.crawl_id,r.source_hash,r.model_plan,r.parent_id)is distinct from(p_batch_id,p_crawl_id,p_source_hash,p_plan,p_parent_id)then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','status',r.state,'id',p_id,'propertyId',p_property_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,17));perform set_config('p11.geo_analysis_scope',p_property_id::text,true);
 if p_cancel then
  insert into public.geo_analysis_records(id,property_id,org_id,actor_id,origin,state)values(p_id,p_property_id,organization,p_actor_id,'console','cancelled');v_action:='audit.analysis.cancelled';
 else
  if not public.geo_analysis_plan_valid(p_plan)then return'{"state":"invalid_input"}';end if;
  if not exists(select 1 from public.geo_site_crawls where id=p_crawl_id and property_id=p_property_id and batch_id=p_batch_id and status='completed')or not exists(select 1 from public.geo_runs where batch_id=p_batch_id and property_id=p_property_id)or exists(select 1 from public.geo_runs where batch_id=p_batch_id and property_id=p_property_id and status in('queued','running'))then return'{"state":"completed_run_required"}';end if;
  if p_parent_id is not null and not exists(select 1 from public.geo_analysis_records where id=p_parent_id and property_id=p_property_id and org_id=organization and batch_id=p_batch_id and state in('held','stopped','discarded','applied'))then return'{"state":"invalid_parent"}';end if;
  if exists(select 1 from public.geo_analysis_records where property_id=p_property_id and state in('queued','running','ready'))then return'{"state":"review_required"}';end if;
  if(select count(*)from public.geo_analysis_records where property_id=p_property_id and created_at>now()-interval'24 hours'and state<>'cancelled')>=24 then return'{"state":"daily_limit"}';end if;
  v_source:=public.geo_analysis_source(p_property_id,p_batch_id,p_crawl_id);
  if public.knowledge_hash(v_source)is distinct from p_source_hash then return'{"state":"source_changed"}';end if;
  if octet_length(v_source::text)>16777216 then return'{"state":"source_limit"}';end if;
  insert into public.geo_analysis_records(id,property_id,org_id,actor_id,batch_id,crawl_id,parent_id,origin,source,source_hash,model_plan,state)values(p_id,p_property_id,organization,p_actor_id,p_batch_id,p_crawl_id,p_parent_id,'console',v_source,p_source_hash,p_plan,'queued');
  v_action:=case when p_parent_id is null then'audit.analysis.requested'else'audit.analysis.retried'end;
 end if;
 v_result:=jsonb_build_object('state','saved','status',case when p_cancel then'cancelled'else'queued'end,'id',p_id,'propertyId',p_property_id);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'propertyaudit',v_action,'server_confirmed','succeeded',jsonb_build_object('analysisId',p_id,'parentId',p_parent_id),null,null,v_result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Analysis history unavailable';end if;
 return v_result;
end$$;
create function public.claim_geo_recommendation(p_plan jsonb,p_id uuid default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.geo_analysis_records;j public.geo_analysis_jobs;v_run public.geo_runs;v_crawl public.geo_site_crawls;v_source jsonb;v_error text;organization uuid;
begin
 if not public.geo_analysis_plan_valid(p_plan)then raise exception 'Invalid analyst configuration';end if;
 perform pg_advisory_xact_lock(401905);
 -- An expired invocation without a receipt is uncertain, never an automatic repeat.
 for r in select*from public.geo_analysis_records where state in('queued','running')and(p_id is null or id=p_id)for update loop
  v_error:=null;
  if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=r.property_id and p.org_id=r.org_id and u.id=coalesce((select d.actor_id from public.geo_operator_commands d where d.id=r.decision_id and d.property_id=r.property_id and d.operation='analysis_resume'),r.actor_id)and u.role in('admin','manager'))then v_error:='requester_access_changed';
  elsif r.state='running'and r.lease_until<=now()and r.invocation is not null and r.receipt is null then v_error:='provider_outcome_unknown';end if;
  if v_error is not null then
   perform set_config('p11.geo_analysis_scope',r.property_id::text,true);update public.geo_analysis_records set state='held',error_code=v_error,finished_at=clock_timestamp()where id=r.id;
   update public.geo_analysis_jobs set state='failed',error_code=v_error,lease_until=null,lease_token=null where batch_id=r.batch_id;
   perform public.record_geo_service(r.property_id,null,null,'analysis_held',jsonb_build_object('analysisId',r.id,'reason',v_error));
  end if;
 end loop;
 if exists(select 1 from public.geo_analysis_records where state='running'and lease_until>now())then return null;end if;
 -- Automatic work inherits an explicit, still-authorized run request including a crawl.
 if p_id is null and not exists(select 1 from public.geo_analysis_records a where(a.state='queued'or(a.state='running'and a.receipt is not null and a.lease_until<=now()))and not exists(select 1 from public.geo_runs x where x.batch_id=a.batch_id and x.measurement_mode='local_fixture'))then
  for j in select*from public.geo_analysis_jobs a where a.state in('queued','running')and(a.lease_until is null or a.lease_until<=now())and a.available_at<=now()and not exists(select 1 from public.geo_analysis_records x where x.batch_id=a.batch_id)and not exists(select 1 from public.geo_runs x where x.batch_id=a.batch_id and x.measurement_mode='local_fixture')order by a.created_at limit 20 for update skip locked loop
   if exists(select 1 from public.geo_runs x where x.batch_id=j.batch_id and x.status in('queued','running'))then continue;end if;
   select*into v_run from public.geo_runs where batch_id=j.batch_id and property_id=j.property_id order by id limit 1;
   v_error:=null;
   if not found or v_run.requested_by is null or v_run.operator_request_id is null or not exists(select 1 from public.geo_operator_commands c where c.id=v_run.operator_request_id and c.property_id=j.property_id and c.actor_id=v_run.requested_by and c.operation='run_request'and c.input->>'includeSiteCrawl'='true')then v_error:='reviewed_analysis_request_required';
   elsif not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=j.property_id and u.id=v_run.requested_by and u.role in('admin','manager'))then v_error:='requester_access_changed';end if;
   select*into v_crawl from public.geo_site_crawls where batch_id=j.batch_id and property_id=j.property_id and status='completed'order by finished_at desc,id desc limit 1;
   if not found and v_error is null then
    if exists(select 1 from public.geo_site_crawls where batch_id=j.batch_id and status in('queued','running'))then continue;end if;
    v_error:='website_crawl_unavailable';
   end if;
   if v_error is null then
    v_source:=public.geo_analysis_source(j.property_id,j.batch_id,v_crawl.id);
    if octet_length(v_source::text)>16777216 then v_error:='source_limit';end if;
   end if;
   if v_error is not null then
    update public.geo_analysis_jobs set state='failed',error_code=v_error,lease_token=null,lease_until=null where batch_id=j.batch_id;
    perform public.record_geo_service(j.property_id,null,null,'analysis_held',jsonb_build_object('batchId',j.batch_id,'reason',v_error));continue;
   end if;
   if exists(select 1 from public.geo_analysis_records where property_id=j.property_id and state in('queued','running','ready'))then continue;end if;
   select org_id into organization from public.properties where id=j.property_id;
   perform set_config('p11.geo_analysis_scope',j.property_id::text,true);
   insert into public.geo_analysis_records(id,property_id,org_id,actor_id,batch_id,crawl_id,request_id,origin,source,source_hash,model_plan,state)values(gen_random_uuid(),j.property_id,organization,v_run.requested_by,j.batch_id,v_crawl.id,v_run.operator_request_id,'workflow',v_source,public.knowledge_hash(v_source),p_plan,'queued')returning*into r;
   perform public.record_geo_service(j.property_id,null,null,'analysis_requested',jsonb_build_object('analysisId',r.id,'requestId',r.request_id,'sourceHash',r.source_hash));exit;
  end loop;
 end if;
 select*into r from public.geo_analysis_records a where(p_id is null or a.id=p_id)and(a.state='queued'or(a.state='running'and a.lease_until<=now()and(a.invocation is null or a.receipt is not null)))and(p_id is not null or not exists(select 1 from public.geo_runs x where x.batch_id=a.batch_id and x.measurement_mode='local_fixture'))order by a.created_at,a.id limit 1 for update skip locked;
 if not found then return null;end if;
 perform set_config('p11.geo_analysis_scope',r.property_id::text,true);
 update public.geo_analysis_records set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval'3 minutes',error_code=null where id=r.id returning*into r;
 update public.geo_analysis_jobs set state='running',attempts=attempts+1,lease_token=r.lease_token,lease_until=r.lease_until,error_code=null where batch_id=r.batch_id;
 perform public.record_geo_service(r.property_id,null,null,'analysis_claimed',jsonb_build_object('analysisId',r.id,'recoveringReceipt',r.receipt is not null));
 return to_jsonb(r)||jsonb_build_object('analysis_id',r.id);
end$$;
create function public.start_geo_analysis_invocation(p_id uuid,p_token uuid,p_request jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.geo_analysis_records;v_error text;
begin
 select*into r from public.geo_analysis_records where id=p_id for update;if not found then return'{"state":"not_found"}';end if;
 if r.state<>'running'or r.lease_token is distinct from p_token or r.lease_until<=now()then return'{"state":"lease_lost"}';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=r.property_id and p.org_id=r.org_id and u.id=coalesce((select d.actor_id from public.geo_operator_commands d where d.id=r.decision_id and d.property_id=r.property_id and d.operation='analysis_resume'),r.actor_id)and u.role in('admin','manager'))then v_error:='requester_access_changed';
 elsif r.invocation is null and r.source_hash is distinct from public.knowledge_hash(public.geo_analysis_source(r.property_id,r.batch_id,r.crawl_id))then v_error:='analysis_source_changed';end if;
 perform set_config('p11.geo_analysis_scope',r.property_id::text,true);
 if v_error is not null then
  update public.geo_analysis_records set state='held',error_code=v_error,finished_at=clock_timestamp()where id=p_id;
  update public.geo_analysis_jobs set state='failed',error_code=v_error,lease_token=null,lease_until=null where batch_id=r.batch_id;
  perform public.record_geo_service(r.property_id,null,null,'analysis_held',jsonb_build_object('analysisId',r.id,'reason',v_error));return jsonb_build_object('state','held','reason',v_error);
 end if;
 if r.receipt is not null then return jsonb_build_object('state','retained','receipt',r.receipt,'invocation',r.invocation);end if;
 if r.invocation is not null then return'{"state":"already_started"}';end if;
 if jsonb_typeof(p_request)is distinct from'object'or p_request->'modelPlan'is distinct from r.model_plan or p_request->>'sourceHash'is distinct from r.source_hash or jsonb_typeof(p_request->'parameters')is distinct from'object'or jsonb_typeof(p_request->'context')is distinct from'object'or jsonb_typeof(p_request->'coverage')is distinct from'object'or octet_length(p_request::text)>16777216 then return'{"state":"invalid_input"}';end if;
 update public.geo_analysis_records set invocation=p_request||jsonb_build_object('token',p_token,'startedAt',clock_timestamp())where id=p_id;
 perform public.record_geo_service(r.property_id,null,null,'analysis_invocation_started',jsonb_build_object('analysisId',p_id,'sourceHash',r.source_hash,'provider',r.model_plan->>'provider','model',r.model_plan->>'model'));
 return jsonb_build_object('state','claimed','analysisId',p_id);
end$$;
create function public.retain_geo_analysis_receipt(p_id uuid,p_token uuid,p_receipt jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.geo_analysis_records;
begin
 select*into r from public.geo_analysis_records where id=p_id for update;if not found then return'{"state":"not_found"}';end if;
 -- Retain an actual late reply even after stop, role withdrawal or lease loss.
 if r.invocation is null or r.invocation->>'token'is distinct from p_token::text then return'{"state":"lease_lost"}';end if;
 if jsonb_typeof(p_receipt)is distinct from'object'or not(p_receipt?&array['response','text','error'])or p_receipt-array['response','text','error']<>'{}'or(jsonb_typeof(p_receipt->'response')not in('object','null'))or jsonb_typeof(p_receipt->'text')is distinct from'string'or octet_length(p_receipt::text)>16777216 then return'{"state":"invalid_input"}';end if;
 if r.receipt is not null then
  if r.receipt is distinct from p_receipt then return'{"state":"request_conflict"}';end if;
  return'{"state":"retained"}';
 end if;
 perform set_config('p11.geo_analysis_scope',r.property_id::text,true);update public.geo_analysis_records set receipt=p_receipt where id=p_id;
 perform public.record_geo_service(r.property_id,null,null,'analysis_response_retained',jsonb_build_object('analysisId',p_id,'hasResponse',p_receipt->'response'<>'null'::jsonb,'error',p_receipt->>'error','state',r.state));
 return'{"state":"retained"}';
end$$;
create function public.finish_geo_recommendation(p_id uuid,p_token uuid,p_preview jsonb,p_error text default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.geo_analysis_records;v_error text:=p_error;item jsonb;
begin
 select*into r from public.geo_analysis_records where id=p_id for update;if not found then return'{"state":"not_found"}';end if;
 if r.preview is not null and r.preview=p_preview then return jsonb_build_object('state','replayed','status',r.state);end if;
 if r.state<>'running'or r.lease_token is distinct from p_token or r.lease_until<=now()then return'{"state":"lease_lost"}';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=r.property_id and p.org_id=r.org_id and u.id=coalesce((select d.actor_id from public.geo_operator_commands d where d.id=r.decision_id and d.property_id=r.property_id and d.operation='analysis_resume'),r.actor_id)and u.role in('admin','manager'))then v_error:='requester_access_changed';end if;
 if v_error is null then
  if r.receipt is null or r.receipt->'response'='null'::jsonb or r.receipt->>'error'is not null or jsonb_typeof(p_preview)is distinct from'object'or jsonb_typeof(p_preview->'recommendations')is distinct from'array'or jsonb_array_length(p_preview->'recommendations')not between 1 and 100 or octet_length(p_preview::text)>16777216 then return'{"state":"invalid_input"}';end if;
  for item in select value from jsonb_array_elements(p_preview->'recommendations')loop
   if coalesce(item->>'type','')not in('technical_fix','content_proposal','strategic','citation')or coalesce(item->>'priority','')not in('high','medium','low')or length(coalesce(item->>'title',''))not between 1 and 300 or length(coalesce(item->>'narrative',''))not between 50 and 5000 or jsonb_typeof(item->'grounding')is distinct from'object'then return'{"state":"invalid_input"}';end if;
  end loop;
 elsif length(v_error)not between 1 and 120 then return'{"state":"invalid_input"}';end if;
 perform set_config('p11.geo_analysis_scope',r.property_id::text,true);
 update public.geo_analysis_records set state=case when v_error is null then'ready'else'held'end,preview=case when v_error is null then p_preview else null end,preview_hash=case when v_error is null then public.knowledge_hash(p_preview)else null end,error_code=v_error,lease_until=null,finished_at=clock_timestamp()where id=p_id;
 update public.geo_analysis_jobs set state=case when v_error is null then'completed'else'failed'end,error_code=v_error,lease_token=null,lease_until=null where batch_id=r.batch_id;
 perform public.record_geo_service(r.property_id,null,null,case when v_error is null then'analysis_prepared'else'analysis_held'end,jsonb_build_object('analysisId',p_id,'reason',v_error,'count',case when v_error is null then jsonb_array_length(p_preview->'recommendations')else 0 end));
 return jsonb_build_object('state','saved','status',case when v_error is null then'ready'else'held'end);
end$$;
create function public.decide_geo_analysis(p_id uuid,p_actor_id uuid,p_property_id uuid,p_analysis_id uuid,p_operation text,p_preview_hash text,p_reason text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;r public.geo_analysis_records;cmd public.geo_operator_commands;v_input jsonb;v_result jsonb;item jsonb;v_state text;v_action text;
begin
 select p.org_id,u.role into organization,member_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found or coalesce(member_role,'')not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null or p_analysis_id is null or coalesce(p_operation,'')not in('apply','discard','stop','resume')or length(btrim(coalesce(p_reason,'')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
 v_input:=jsonb_build_object('analysisId',p_analysis_id,'operation',p_operation,'previewHash',p_preview_hash,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,973));select*into cmd from public.geo_operator_commands where id=p_id;
 if found then
  if(cmd.actor_id,cmd.property_id,cmd.org_id)is distinct from(p_actor_id,p_property_id,organization)then return'{"state":"not_found"}';end if;
  if cmd.operation='cancel_request'then return cmd.result||'{"state":"replayed"}';end if;
  if cmd.input is distinct from v_input then return'{"state":"request_conflict"}';end if;return cmd.result||'{"state":"replayed"}';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,17));
 select*into r from public.geo_analysis_records where id=p_analysis_id and property_id=p_property_id and org_id=organization for update;
 if not found then return'{"state":"not_found"}';end if;
 if r.preview_hash is distinct from p_preview_hash then return'{"state":"source_changed"}';end if;
 if p_operation='stop'then
  if r.state not in('queued','running','held')then return'{"state":"review_required"}';end if;v_state:='stopped';v_action:='stopped';
 elsif p_operation='discard'then
  if r.state not in('ready','held')then return'{"state":"review_required"}';end if;v_state:='discarded';v_action:='discarded';
 elsif p_operation='resume'then
  if r.state<>'held'or r.receipt is null or r.preview is not null or r.receipt->>'error'is not null then return'{"state":"saved_receipt_required"}';end if;
  if exists(select 1 from public.geo_analysis_records where property_id=p_property_id and state in('queued','running','ready'))then return'{"state":"review_required"}';end if;v_state:='queued';v_action:='resumed';
 else
  if r.state<>'ready'or r.preview is null then return'{"state":"review_required"}';end if;
  if r.source_hash is distinct from public.knowledge_hash(public.geo_analysis_source(p_property_id,r.batch_id,r.crawl_id))then return'{"state":"source_changed"}';end if;
  v_state:='applied';v_action:='applied';
  perform set_config('p11.geo_analysis_scope',p_property_id::text,true);
  update public.geo_recommendations set is_current=false,updated_at=clock_timestamp()where property_id=p_property_id and is_current;
  for item in select value from jsonb_array_elements(r.preview->'recommendations')loop
   insert into public.geo_recommendations(property_id,batch_id,crawl_id,generation_id,is_current,type,priority,owner,title,narrative,proposed_changes,grounding,status,model_used)
    values(p_property_id,r.batch_id,r.crawl_id,r.id,true,item->>'type',item->>'priority',item->>'owner',item->>'title',item->>'narrative',coalesce(item->'proposed_changes','[]'),item->'grounding','todo',r.model_plan->>'model');
  end loop;
 end if;
 perform set_config('p11.geo_analysis_scope',p_property_id::text,true);perform set_config('p11.geo_operator_scope',p_property_id::text,true);
 update public.geo_analysis_records set state=v_state,decision_id=p_id,lease_until=null,finished_at=clock_timestamp(),error_code=case when p_operation='resume'then null else error_code end where id=r.id;
 if p_operation in('stop','discard')then update public.geo_analysis_jobs set state='failed',error_code='operator_'||v_state,lease_token=null,lease_until=null where batch_id=r.batch_id;end if;
 v_result:=jsonb_build_object('state','saved','status',v_state,'id',p_id,'propertyId',p_property_id,'analysisId',r.id,'verifiedImprovement',false);
 insert into public.geo_operator_commands(id,property_id,org_id,actor_id,operation,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,'analysis_'||p_operation,v_input,jsonb_build_object('sourceHash',r.source_hash,'state',r.state,'previewHash',r.preview_hash),jsonb_build_object('analysisId',r.id,'state',v_state),v_result);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'propertyaudit','audit.analysis.'||v_action,'server_confirmed','succeeded',jsonb_build_object('analysisId',r.id),null,null,v_result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Analysis decision history unavailable';end if;
 return v_result;
end$$;
create function public.read_geo_analyses(p_actor_id uuid,p_property_id uuid,p_id uuid default null,p_batch_id uuid default null,p_crawl_id uuid default null,p_kind text default'history',p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;member_role text;r public.geo_analysis_records;v_source jsonb;v_items jsonb;v_count bigint;v_hash text;
begin
 select p.org_id,u.role into organization,member_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if not found then return'{"state":"forbidden"}';end if;
 if p_id is not null then
  select*into r from public.geo_analysis_records where id=p_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','id',p_id,'propertyId',p_property_id,'canManage',member_role in('admin','manager'),'record',(to_jsonb(r)-array['lease_token','lease_until','invocation'])||jsonb_build_object('invocation',r.invocation-'token'));
 end if;
 if p_offset not between 0 and 1000000 or coalesce(p_kind,'')not in('sources','history')then return'{"state":"invalid_input"}';end if;
 if p_crawl_id is not null or p_batch_id is not null then
  if not exists(select 1 from public.geo_site_crawls where id=p_crawl_id and property_id=p_property_id and batch_id=p_batch_id)then return'{"state":"not_found"}';end if;
  v_source:=public.geo_analysis_source(p_property_id,p_batch_id,p_crawl_id);if octet_length(v_source::text)>16777216 then return'{"state":"source_limit"}';end if;
 end if;
 if p_kind='sources'then
  select coalesce(jsonb_agg(jsonb_build_object('crawlId',c.id,'batchId',c.batch_id,'finishedAt',c.finished_at,'seedUrl',c.seed_url,'synthetic',c.measurement_mode='local_fixture')order by c.finished_at desc,c.id desc),'[]')into v_items from public.geo_site_crawls c where c.property_id=p_property_id and c.status='completed'and exists(select 1 from public.geo_runs x where x.property_id=p_property_id and x.batch_id=c.batch_id)and not exists(select 1 from public.geo_runs x where x.property_id=p_property_id and x.batch_id=c.batch_id and x.status in('queued','running'));
 else
  select coalesce(jsonb_agg(to_jsonb(a)-array['source','invocation','receipt','preview','lease_token','lease_until']order by a.created_at desc,a.id desc),'[]')into v_items from public.geo_analysis_records a where a.property_id=p_property_id and a.org_id=organization;
 end if;
 v_count:=jsonb_array_length(v_items);v_hash:=public.knowledge_hash(v_items);
 if p_hash is not null and p_hash<>v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(x.value order by x.ordinality),'[]')into v_items from jsonb_array_elements(v_items)with ordinality x where x.ordinality>p_offset and x.ordinality<=p_offset+25;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',member_role in('admin','manager'),'items',v_items,'count',v_count,'hash',v_hash,'offset',p_offset,'source',v_source,'sourceHash',case when v_source is not null then public.knowledge_hash(v_source)else null end);
end$$;
-- Earlier callers cannot issue unrecorded recommendations or automatic model retries.
create or replace function public.claim_geo_analysis()returns jsonb language sql security invoker set search_path=''as $$select null::jsonb$$;
create or replace function public.finish_geo_analysis(p_batch_id uuid,p_token uuid,p_success boolean)returns boolean language sql security invoker set search_path=''as $$select false$$;
create or replace function public.replace_geo_recommendations(p_property_id uuid,p_crawl_id uuid,p_generation_id uuid,p_rows jsonb,p_token uuid default null)returns integer language plpgsql security invoker set search_path=''as $$begin raise exception 'Review the retained recommendation preview before application';end$$;
create function public.guard_geo_recommendation_generation()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if current_user='authenticated'then raise exception 'Use recorded recommendation operations';end if;
 if tg_op='UPDATE'then
  if(new.property_id,new.batch_id,new.crawl_id,new.generation_id,new.type,new.priority,new.title,new.narrative,new.proposed_changes,new.grounding,new.model_used)is distinct from(old.property_id,old.batch_id,old.crawl_id,old.generation_id,old.type,old.priority,old.title,old.narrative,old.proposed_changes,old.grounding,old.model_used)then raise exception 'Recommendation source is immutable';end if;
  if new.is_current is distinct from old.is_current and current_setting('p11.geo_analysis_scope',true)is distinct from new.property_id::text then raise exception 'Review the current recommendation replacement';end if;
 else
  if exists(select 1 from public.geo_analysis_records where id=new.generation_id)and current_setting('p11.geo_analysis_scope',true)is distinct from new.property_id::text then raise exception 'Review saved recommendation application';end if;
 end if;return new;
end$$;
create trigger geo_recommendations_generation_guard before insert or update on public.geo_recommendations for each row execute function public.guard_geo_recommendation_generation();

revoke all on function public.guard_geo_analysis_record(),public.geo_analysis_source(uuid,uuid,uuid),public.geo_analysis_plan_valid(jsonb),public.prepare_geo_analysis(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid,boolean),public.claim_geo_recommendation(jsonb,uuid),public.start_geo_analysis_invocation(uuid,uuid,jsonb),public.retain_geo_analysis_receipt(uuid,uuid,jsonb),public.finish_geo_recommendation(uuid,uuid,jsonb,text),public.decide_geo_analysis(uuid,uuid,uuid,uuid,text,text,text),public.read_geo_analyses(uuid,uuid,uuid,uuid,uuid,text,integer,text),public.guard_geo_recommendation_generation() from public,anon,authenticated;
grant execute on function public.guard_geo_analysis_record(),public.geo_analysis_source(uuid,uuid,uuid),public.geo_analysis_plan_valid(jsonb),public.prepare_geo_analysis(uuid,uuid,uuid,uuid,uuid,text,jsonb,uuid,boolean),public.claim_geo_recommendation(jsonb,uuid),public.start_geo_analysis_invocation(uuid,uuid,jsonb),public.retain_geo_analysis_receipt(uuid,uuid,jsonb),public.finish_geo_recommendation(uuid,uuid,jsonb,text),public.decide_geo_analysis(uuid,uuid,uuid,uuid,text,text,text),public.read_geo_analyses(uuid,uuid,uuid,uuid,uuid,text,integer,text),public.guard_geo_recommendation_generation() to service_role;
notify pgrst,'reload schema';
