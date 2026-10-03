create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
-- Retained report sources and exact artifacts. All rendering is deterministic and private.
create table public.geo_report_records(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 options jsonb not null,source jsonb,source_hash text,artifact text,artifact_hash text,
 state text not null check(state in('prepared','ready','cancelled')),created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index geo_report_records_property on public.geo_report_records(property_id,created_at desc,id desc);
create index geo_report_records_org on public.geo_report_records(org_id);
create index geo_report_records_actor on public.geo_report_records(actor_id);
create table public.geo_report_observations(
 id uuid primary key,report_id uuid not null references public.geo_report_records(id)on delete cascade,
 property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 outcome text not null check(outcome in('prepared','download_initiated','print_view_opened','blocked','failed')),created_at timestamptz not null default clock_timestamp()
);
create index geo_report_observations_report on public.geo_report_observations(report_id);
create index geo_report_observations_property on public.geo_report_observations(property_id,created_at desc);
create index geo_report_observations_actor on public.geo_report_observations(actor_id);
create index geo_report_observations_org on public.geo_report_observations(org_id);
alter table public.geo_report_records enable row level security;
alter table public.geo_report_observations enable row level security;
revoke all on public.geo_report_records,public.geo_report_observations from public,anon,authenticated;
grant all on public.geo_report_records,public.geo_report_observations to service_role;
create policy geo_report_records_service on public.geo_report_records for all to service_role using(true)with check(true);
create policy geo_report_observations_service on public.geo_report_observations for all to service_role using(true)with check(true);
create function public.guard_geo_report()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  raise exception 'Retain report evidence until an authorized retention operation';
 end if;
 if current_setting('p11.geo_report_scope',true)is distinct from new.property_id::text then raise exception 'Use recorded report operations';end if;
 if tg_op='UPDATE'then
  if tg_table_name='geo_report_observations'then
   if old.outcome<>'prepared'or new.outcome='prepared'or(new.id,new.report_id,new.property_id,new.org_id,new.actor_id,new.created_at)is distinct from(old.id,old.report_id,old.property_id,old.org_id,old.actor_id,old.created_at)then raise exception 'Report outcomes are immutable';end if;return new;end if;
  if old.state<>'prepared'or new.state not in('ready','cancelled')or(new.id,new.property_id,new.org_id,new.actor_id,new.options,new.source,new.source_hash,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.options,old.source,old.source_hash,old.created_at)then raise exception 'Report sources and completed artifacts are immutable';end if;
 end if;return new;
end$$;
create trigger geo_report_records_guard before insert or update or delete on public.geo_report_records for each row execute function public.guard_geo_report();
create trigger geo_report_observations_guard before insert or update or delete on public.geo_report_observations for each row execute function public.guard_geo_report();
create function public.geo_report_source(p_property_id uuid,p_options jsonb)returns jsonb language sql stable security invoker set search_path=''as $$
 with latest as(select r.id,r.batch_id from public.geo_runs r where r.property_id=p_property_id and r.archived_at is null and r.status='completed'and r.measurement_mode is distinct from'local_fixture' order by r.started_at desc,r.id desc limit 1),
 selected as(select r.*from public.geo_runs r where r.property_id=p_property_id and case
  when p_options->>'format'in('findings_csv','queries_csv')then false
  when p_options->>'runId'is not null then r.id=(p_options->>'runId')::uuid
  when p_options->>'batchId'is not null then r.batch_id=(p_options->>'batchId')::uuid
  else r.archived_at is null and(r.batch_id=(select batch_id from latest)or r.id=(select id from latest))end)
 select jsonb_build_object('version',1,'capturedAt',statement_timestamp(),'property',(select jsonb_build_object('id',id,'name',name,'address',address,'website_url',website_url)from public.properties where id=p_property_id),
 'runs',coalesce((select jsonb_agg(public.geo_operator_run_source(r.id)||jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'ordinal',i.ordinal,'query',i.query_snapshot,'state',i.state,'answerId',i.answer_id,'errorCode',i.error_code)order by i.ordinal)from public.geo_execution_items i where i.run_id=r.id),'[]'))order by r.started_at desc,r.id)from selected r),'[]'),
 'queries',coalesce((select jsonb_agg(to_jsonb(q)order by q.text,q.id)from public.geo_queries q where q.property_id=p_property_id and q.is_active and q.archived_at is null),'[]'),
 'findings',coalesce((select jsonb_agg(to_jsonb(f)order by f.category,f.id)from public.geo_site_findings f where f.property_id=p_property_id and(coalesce((p_options->>'includeFixed')::boolean,true)or f.status<>'fixed')),'[]'),
 'recommendations',coalesce((select jsonb_agg(to_jsonb(r)order by r.created_at,r.id)from public.geo_recommendations r where r.property_id=p_property_id and r.is_current and(r.batch_id in(select batch_id from selected)or r.batch_id is null)),'[]'),
 'crawls',coalesce((select jsonb_agg(to_jsonb(c)-array['lease_token','lease_until','frontier']order by c.created_at,c.id)from public.geo_site_crawls c where c.property_id=p_property_id and c.batch_id in(select batch_id from selected)),'[]'),
 'trends',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'batch_id',r.batch_id,'surface',r.surface,'model_name',r.model_name,'started_at',r.started_at,'geo_scores',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from public.geo_scores s where s.run_id=r.id),'[]'))order by r.started_at,r.id)from public.geo_runs r where r.property_id=p_property_id and r.status='completed'and r.archived_at is null and r.measurement_mode is distinct from'local_fixture'and r.started_at>=date_trunc('month',statement_timestamp()at time zone'UTC')at time zone'UTC'-interval'3 months'),'[]'),
 'trendScope','Completed, unarchived, non-synthetic runs from the start of the UTC month three months ago through capture time. Different questions/models can limit comparability.',
 'findingScope','Current retained findings at report capture. Fixed means staff-reported; it does not certify an observed improvement.');
$$;
create function public.prepare_geo_report(p_id uuid,p_actor_id uuid,p_property_id uuid,p_options jsonb,p_cancel boolean default false)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;r public.geo_report_records;v_source jsonb;v_action text;v_result jsonb;v_format text:=p_options->>'format';
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found then return'{"state":"forbidden"}';end if;
 -- Viewers may export information they can already read; exports grant no write/execution authority.
 if p_id is null then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,983));select*into r from public.geo_report_records where id=p_id for update;
 if found then
  if(r.actor_id,r.property_id,r.org_id)is distinct from(p_actor_id,p_property_id,organization)then return'{"state":"not_found"}';end if;
  if p_cancel and r.state='prepared'then
   perform set_config('p11.geo_report_scope',p_property_id::text,true);update public.geo_report_records set state='cancelled',finished_at=clock_timestamp()where id=p_id returning*into r;v_action:='audit.report.cancelled';
  else
   if not p_cancel and r.state<>'cancelled'and r.options<>p_options then return'{"state":"request_conflict"}';end if;
   return jsonb_build_object('state','replayed','status',r.state,'id',r.id,'propertyId',p_property_id,'sourceHash',r.source_hash);
  end if;
 else
  perform set_config('p11.geo_report_scope',p_property_id::text,true);
  if p_cancel then insert into public.geo_report_records(id,actor_id,property_id,org_id,options,state,finished_at)values(p_id,p_actor_id,p_property_id,organization,'{}','cancelled',clock_timestamp())returning*into r;v_action:='audit.report.cancelled';
  else
   if jsonb_typeof(p_options)is distinct from'object'or p_options-array['format','template','sections','runId','batchId','includeFixed']<>'{}'or coalesce(v_format,'')not in('html','markdown','findings_csv','queries_csv')or coalesce(p_options->>'template','')not in('executive','comprehensive','competitive','progress')or jsonb_typeof(p_options->'sections')is distinct from'array'or jsonb_array_length(p_options->'sections')not between 1 and 7 or exists(select 1 from jsonb_array_elements_text(p_options->'sections')s where s not in('summary','scores','models','competitors','recommendations','queries','appendix'))or(p_options->>'runId'is not null and p_options->>'batchId'is not null)then return'{"state":"invalid_input"}';end if;
   if p_options->>'runId'is not null and not exists(select 1 from public.geo_runs where property_id=p_property_id and id=(p_options->>'runId')::uuid)then return'{"state":"not_found"}';end if;
   if p_options->>'batchId'is not null and not exists(select 1 from public.geo_runs where property_id=p_property_id and batch_id=(p_options->>'batchId')::uuid)then return'{"state":"not_found"}';end if;
   perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,4));v_source:=public.geo_report_source(p_property_id,p_options)||jsonb_build_object('performance',public.read_geo_operator(p_actor_id,p_property_id,'{"kind":"performance"}'));
   if v_source#>>'{performance,state}'is distinct from'ready'then return'{"state":"forbidden"}';end if;
   if octet_length(v_source::text)>16777216 then return'{"state":"source_limit"}';end if;
   if v_format in('html','markdown')and not exists(select 1 from jsonb_array_elements(v_source->'runs')x where x#>>'{run,status}'='completed')then return'{"state":"completed_run_required"}';end if;
   insert into public.geo_report_records(id,actor_id,property_id,org_id,options,source,source_hash,state)values(p_id,p_actor_id,p_property_id,organization,p_options,v_source,public.knowledge_hash(v_source),'prepared')returning*into r;v_action:='audit.report.requested';
  end if;
 end if;
 v_result:=jsonb_build_object('state','saved','status',r.state,'id',r.id,'propertyId',p_property_id,'sourceHash',r.source_hash);
 if public.append_shared_action_event(gen_random_uuid(),p_id,p_property_id,p_actor_id,'propertyaudit',v_action,'server_confirmed','succeeded',jsonb_build_object('reportId',p_id),null,null,v_result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Report action history unavailable';end if;return v_result;
end$$;
create function public.finish_geo_report(p_id uuid,p_actor_id uuid,p_property_id uuid,p_source_hash text,p_artifact text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.geo_report_records;v_hash text;v_result jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,983));select*into r from public.geo_report_records where id=p_id and actor_id=p_actor_id and property_id=p_property_id and org_id=organization for update;if not found then return'{"state":"not_found"}';end if;
 if r.state='cancelled'then return'{"state":"cancelled"}';end if;
 if r.source_hash is distinct from p_source_hash then return'{"state":"source_changed"}';end if;
 if p_artifact is null or octet_length(p_artifact)not between 1 and 33554432 then return'{"state":"artifact_limit"}';end if;
 v_hash:=public.knowledge_hash(to_jsonb(p_artifact));
 if r.state='ready'then
  if r.artifact_hash<>v_hash then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','status','ready','id',p_id,'propertyId',p_property_id,'sourceHash',r.source_hash,'artifactHash',v_hash);
 end if;
 perform set_config('p11.geo_report_scope',p_property_id::text,true);update public.geo_report_records set state='ready',artifact=p_artifact,artifact_hash=v_hash,finished_at=clock_timestamp()where id=p_id;
 v_result:=jsonb_build_object('state','saved','status','ready','id',p_id,'propertyId',p_property_id,'sourceHash',r.source_hash,'artifactHash',v_hash);
 if public.append_shared_action_event(gen_random_uuid(),p_id,p_property_id,p_actor_id,'propertyaudit','audit.report.prepared','server_confirmed','succeeded',jsonb_build_object('reportId',p_id),null,null,v_result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Report preparation history unavailable';end if;return v_result;
end$$;
create function public.read_geo_reports(p_actor_id uuid,p_property_id uuid,p_id uuid default null,p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;r public.geo_report_records;v_items jsonb;v_count integer;v_hash text;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_id is not null then
  select*into r from public.geo_report_records where id=p_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'id',r.id,'record',to_jsonb(r),'canResume',r.actor_id=p_actor_id,'observations',coalesce((select jsonb_agg(to_jsonb(o)order by o.created_at,o.id)from public.geo_report_observations o where o.report_id=r.id),'[]'));
 end if;
 if p_offset not between 0 and 1000000 then return'{"state":"invalid_input"}';end if;
 select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,state,artifact_hash)order by created_at desc,id desc),'[]'))into v_count,v_hash from public.geo_report_records where property_id=p_property_id and org_id=organization;
 if p_offset>0 and p_hash is distinct from v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(x.v order by x.created_at desc,x.id desc),'[]')into v_items from(select id,created_at,to_jsonb(report_row)-array['source','artifact']v from public.geo_report_records report_row where property_id=p_property_id and org_id=organization order by created_at desc,id desc offset p_offset limit 25)x;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'items',v_items,'count',v_count,'hash',v_hash,'offset',p_offset);
end$$;
create function public.observe_geo_report(p_id uuid,p_actor_id uuid,p_property_id uuid,p_report_id uuid,p_outcome text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;o public.geo_report_observations;v_result jsonb;v_action text;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or p_outcome is null or p_outcome not in('prepared','download_initiated','print_view_opened','blocked','failed')then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,983));select*into o from public.geo_report_observations where id=p_id for update;
 if found then
  if(o.actor_id,o.org_id,o.property_id,o.report_id)is distinct from(p_actor_id,organization,p_property_id,p_report_id)then return'{"state":"not_found"}';end if;
  if o.outcome=p_outcome or p_outcome='prepared'then return jsonb_build_object('state','replayed','id',p_id,'propertyId',p_property_id,'outcome',o.outcome);end if;
  if o.outcome<>'prepared'then return'{"state":"request_conflict"}';end if;
  perform set_config('p11.geo_report_scope',p_property_id::text,true);update public.geo_report_observations set outcome=p_outcome where id=p_id;v_action:='audit.report.reported';
 else
  if p_outcome<>'prepared'then return'{"state":"not_found"}';end if;
  if not exists(select 1 from public.geo_report_records where id=p_report_id and property_id=p_property_id and org_id=organization and state='ready')then return'{"state":"not_found"}';end if;
  perform set_config('p11.geo_report_scope',p_property_id::text,true);insert into public.geo_report_observations(id,report_id,actor_id,org_id,property_id,outcome)values(p_id,p_report_id,p_actor_id,organization,p_property_id,p_outcome);v_action:='audit.report.download_prepared';
 end if;
 v_result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'outcome',p_outcome);
 if public.append_shared_action_event(gen_random_uuid(),p_id,p_property_id,p_actor_id,'propertyaudit',v_action,case when p_outcome='prepared'then'server_confirmed'else'browser_observed'end,case when p_outcome='prepared'then'succeeded'else'observed'end,jsonb_build_object('reportId',p_report_id),null,null,jsonb_build_object('outcome',p_outcome),'{}')->>'state'not in('recorded','replayed')then raise exception 'Report observation unavailable';end if;return v_result;
end$$;
revoke all on function public.guard_geo_report(),public.geo_report_source(uuid,jsonb),public.prepare_geo_report(uuid,uuid,uuid,jsonb,boolean),public.finish_geo_report(uuid,uuid,uuid,text,text),public.read_geo_reports(uuid,uuid,uuid,integer,text),public.observe_geo_report(uuid,uuid,uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.geo_report_source(uuid,jsonb),public.prepare_geo_report(uuid,uuid,uuid,jsonb,boolean),public.finish_geo_report(uuid,uuid,uuid,text,text),public.read_geo_reports(uuid,uuid,uuid,integer,text),public.observe_geo_report(uuid,uuid,uuid,uuid,text)to service_role;
