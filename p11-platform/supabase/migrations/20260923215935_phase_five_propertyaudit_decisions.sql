create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 origin:=case when p_action like 'bi.%'then'console' when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- Reviewed website crawls are discovered by the worker and fenced by a current lease.
alter table public.geo_site_crawls add column requested_by uuid references public.profiles(id);
alter table public.geo_site_crawls add column operator_request_id uuid;
alter table public.geo_site_crawls add column measurement_mode text;
alter table public.geo_site_crawls add column lease_token uuid;
alter table public.geo_site_crawls add column lease_until timestamptz;
alter table public.geo_site_crawls add column claim_count integer not null default 0;
alter table public.geo_site_crawls add column retry_of uuid references public.geo_site_crawls(id);
create index geo_site_crawls_retry_of on public.geo_site_crawls(retry_of);
create index geo_site_crawls_requested_by on public.geo_site_crawls(requested_by);
create index geo_site_crawls_operator_request on public.geo_site_crawls(operator_request_id);
-- Reviewed audit decisions retain source history. Reported fixes are not verified measurements.
alter table public.geo_queries add column decision_revision integer not null default 1;
alter table public.geo_queries add column archived_at timestamptz;
alter table public.geo_runs add column control_revision integer not null default 1;
alter table public.geo_runs add column archived_at timestamptz;
alter table public.geo_runs add column stopped_by_operator boolean not null default false;
alter table public.geo_runs add column requested_by uuid references public.profiles(id);
alter table public.geo_runs add column operator_request_id uuid;
alter table public.geo_runs add column retry_of uuid references public.geo_runs(id);
create index geo_runs_requested_by on public.geo_runs(requested_by);
create index geo_runs_retry_of on public.geo_runs(retry_of);
create index geo_runs_operator_request on public.geo_runs(operator_request_id);
create table public.geo_operator_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),operation text not null,input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create index geo_operator_commands_property on public.geo_operator_commands(property_id,created_at desc,id desc);
create index geo_operator_commands_actor on public.geo_operator_commands(actor_id);
create index geo_operator_commands_org on public.geo_operator_commands(org_id);
alter table public.geo_operator_commands enable row level security;
revoke all on public.geo_operator_commands from public,anon,authenticated;
grant all on public.geo_operator_commands to service_role;
create policy geo_operator_commands_service on public.geo_operator_commands for all to service_role using(true)with check(true);
create function public.guard_geo_operator()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  raise exception 'Retain audit decisions and measurement sources; use archive';
 end if;
 if tg_table_name='geo_operator_commands'then
  if tg_op='UPDATE'then raise exception 'Audit decisions are immutable';end if;
  if current_setting('p11.geo_operator_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded audit decision';end if;
  return new;
 end if;
 if tg_table_name='geo_queries'then
  if current_user='authenticated'and current_setting('p11.geo_operator_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded audit query decision';end if;
  if tg_op='INSERT'then new.decision_revision:=1;
  elsif(new.property_id,new.text,new.type,new.geo,new.weight,new.run_count,new.is_active,new.archived_at)is distinct from(old.property_id,old.text,old.type,old.geo,old.weight,old.run_count,old.is_active,old.archived_at)then new.decision_revision:=old.decision_revision+1;
  else new.decision_revision:=old.decision_revision;end if;
  if new.archived_at is not null then new.is_active:=false;end if;
 else
  if current_user='authenticated' then raise exception 'Use a recorded audit run decision';end if;
  if tg_op='UPDATE'then
   if(new.property_id,new.batch_id,new.surface,new.model_name,new.measurement_mode,new.requested_by,new.operator_request_id,new.retry_of)is distinct from(old.property_id,old.batch_id,old.surface,old.model_name,old.measurement_mode,old.requested_by,old.operator_request_id,old.retry_of)then raise exception 'Audit run source identity is immutable';end if;
  end if;
  if tg_op='INSERT'then new.control_revision:=1;
  elsif(new.status,new.archived_at,new.stopped_by_operator)is distinct from(old.status,old.archived_at,old.stopped_by_operator)then new.control_revision:=old.control_revision+1;
  else new.control_revision:=old.control_revision;
  end if;
 end if;return new;
end$$;
create trigger geo_operator_commands_guard before insert or update or delete on public.geo_operator_commands for each row execute function public.guard_geo_operator();
create trigger geo_operator_queries_guard before insert or update or delete on public.geo_queries for each row execute function public.guard_geo_operator();
create trigger geo_operator_runs_guard before insert or update or delete on public.geo_runs for each row execute function public.guard_geo_operator();
create function public.geo_operator_context(p_property_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 with source as(select jsonb_build_object('property',jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'website_url',p.website_url,'property_type',p.property_type,'amenities',p.amenities,'special_features',p.special_features),'configuration',(select jsonb_build_object('domains',c.domains,'competitor_domains',c.competitor_domains,'crawl_page_cap',c.crawl_page_cap)from public.geo_property_config c where c.property_id=p.id),'brand',(select jsonb_build_object('id',b.id,'unique_selling_points',b.unique_selling_points)from public.brand_books b where b.property_id=p.id order by b.created_at desc,b.id limit 1),'competitors',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)order by c.id)from public.competitors c where c.property_id=p.id and c.is_active),'[]'),'queries',coalesce((select jsonb_agg(to_jsonb(q)order by q.id)from public.geo_queries q where q.property_id=p.id and q.is_active and q.archived_at is null),'[]'))v from public.properties p where p.id=p_property_id)
 select v||jsonb_build_object('hash',public.knowledge_hash(v),'queryCount',jsonb_array_length(v->'queries'))from source;
$$;
create function public.geo_operator_query_valid(p_value jsonb)returns boolean language plpgsql immutable security invoker set search_path=''as $$
begin
 if jsonb_typeof(p_value)is distinct from'object'or not(p_value?&array['text','type','geo','weight','runCount','isActive'])or p_value-array['text','type','geo','weight','runCount','isActive']<>'{}'then return false;end if;
 if jsonb_typeof(p_value->'text')is distinct from'string'or length(btrim(p_value->>'text'))not between 1 and 2000 or coalesce(p_value->>'type','')not in('branded','category','comparison','local','faq','voice_search')or jsonb_typeof(p_value->'geo')is distinct from'string'or length(p_value->>'geo')>300 or jsonb_typeof(p_value->'weight')is distinct from'number'or(p_value->>'weight')::numeric not between 0.5 and 2 or jsonb_typeof(p_value->'runCount')is distinct from'number'or(p_value->>'runCount')!~'^[1-5]$'or jsonb_typeof(p_value->'isActive')is distinct from'boolean'then return false;end if;
 return true;
end$$;
create function public.decide_geo_operator(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;kind text:=p_input->>'operation';cmd public.geo_operator_commands;q public.geo_queries;r public.geo_runs;finding public.geo_site_findings;rec public.geo_recommendations;v_before jsonb;v_after jsonb;v_result jsonb:='{}';v_action text;v_value jsonb;v_context jsonb;v_hash text;ids uuid[];v_id uuid;v_count integer;v_run_ids jsonb:='[]';v_surface jsonb;source_job public.geo_execution_jobs;v_crawl public.geo_site_crawls;
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found or member_role is null or member_role not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,973));select*into cmd from public.geo_operator_commands where id=p_id;
 if found then
  if(cmd.property_id,cmd.org_id,cmd.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if kind='cancel_request'or cmd.operation='cancel_request'then return cmd.result||'{"state":"replayed"}';end if;
  if cmd.input<>p_input then return'{"state":"request_conflict"}';end if;return cmd.result||'{"state":"replayed"}';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,4));
 perform set_config('p11.geo_operator_scope',p_property_id::text,true);
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='audit.request_cancelled';v_result:='{"status":"cancelled_request"}';
 elsif kind='query_create'then
  if p_input-array['operation','queries','sourceHash','sourceKind','sourceEvidence']<>'{}'or jsonb_typeof(p_input->'queries')is distinct from'array'or jsonb_array_length(p_input->'queries')not between 1 and 100 or coalesce(p_input->>'sourceKind','')not in('manual','property_templates','keyword_intake')then return'{"state":"invalid_input"}';end if;
  v_context:=public.geo_operator_context(p_property_id);
  if p_input->>'sourceHash'is distinct from v_context->>'hash'then return'{"state":"source_changed"}';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'queries')x where not public.geo_operator_query_valid(x))then return'{"state":"invalid_input"}';end if;
  if jsonb_typeof(p_input->'sourceEvidence')is distinct from'object'or length((p_input->'sourceEvidence')::text)>32768 then return'{"state":"invalid_input"}';end if;
  -- The complete proposed set is reviewed; repeated normalized prompts are a conflict, never silently dropped.
  if (select count(distinct lower(btrim(x->>'text')))from jsonb_array_elements(p_input->'queries')x)<>jsonb_array_length(p_input->'queries')or exists(select 1 from jsonb_array_elements(p_input->'queries')x join public.geo_queries oldq on lower(btrim(oldq.text))=lower(btrim(x->>'text'))where oldq.property_id=p_property_id and oldq.archived_at is null)then return'{"state":"query_conflict"}';end if;
  v_before:=jsonb_build_object('source',v_context);v_after:='[]';
  for v_value in select value from jsonb_array_elements(p_input->'queries')loop
   insert into public.geo_queries(property_id,text,type,geo,weight,run_count,is_active)values(p_property_id,btrim(v_value->>'text'),(v_value->>'type')::public.geo_query_type_enum,nullif(btrim(v_value->>'geo'),''),(v_value->>'weight')::numeric,(v_value->>'runCount')::integer,(v_value->>'isActive')::boolean)returning*into q;
   v_after:=v_after||jsonb_build_array(to_jsonb(q));
  end loop;v_action:='audit.queries_created';v_result:=jsonb_build_object('queryIds',(select jsonb_agg(x->'id')from jsonb_array_elements(v_after)x),'count',jsonb_array_length(v_after));
 elsif kind in('query_edit','query_archive','query_restore')then
  if p_input-array['operation','selection','fields','reason']<>'{}'or jsonb_typeof(p_input->'selection')is distinct from'array'or jsonb_array_length(p_input->'selection')not between 1 and 100 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(p_input->>'reason')>2000 then return'{"state":"invalid_input"}';end if;
  if kind='query_edit'and(jsonb_array_length(p_input->'selection')<>1 or not public.geo_operator_query_valid(p_input->'fields'))then return'{"state":"invalid_input"}';end if;
  if kind<>'query_edit'and p_input?'fields'then return'{"state":"invalid_input"}';end if;
  begin select array_agg((x->>'id')::uuid order by x->>'id')into ids from jsonb_array_elements(p_input->'selection')x;exception when others then return'{"state":"invalid_input"}';end;
  if cardinality(ids)<>(select count(distinct x)from unnest(ids)x)then return'{"state":"invalid_input"}';end if;
  perform 1 from public.geo_queries where property_id=p_property_id and id=any(ids)order by id for update;
  if (select count(*)from public.geo_queries where property_id=p_property_id and id=any(ids))<>cardinality(ids)then return'{"state":"not_found"}';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'selection')x join public.geo_queries z on z.id=(x->>'id')::uuid where z.decision_revision::text is distinct from x->>'revision')then return'{"state":"query_changed"}';end if;
  if kind='query_edit'and exists(select 1 from public.geo_queries where id=any(ids)and archived_at is not null)then return'{"state":"query_changed"}';end if;
  v_value:=p_input->'fields';
  if kind='query_edit'and exists(select 1 from public.geo_queries where property_id=p_property_id and id<>all(ids)and archived_at is null and lower(btrim(text))=lower(btrim(v_value->>'text')))then return'{"state":"query_conflict"}';end if;
  if kind='query_restore'and(select count(distinct lower(btrim(text)))from public.geo_queries where id=any(ids))<>cardinality(ids)then return'{"state":"query_conflict"}';end if;
  if kind='query_restore'and exists(select 1 from public.geo_queries a join public.geo_queries b on b.property_id=a.property_id and b.id<>a.id and b.archived_at is null and lower(btrim(a.text))=lower(btrim(b.text))where a.id=any(ids))then return'{"state":"query_conflict"}';end if;
  select jsonb_agg(to_jsonb(z)order by z.id)into v_before from public.geo_queries z where z.id=any(ids);
  if kind='query_edit'then update public.geo_queries set text=btrim(v_value->>'text'),type=(v_value->>'type')::public.geo_query_type_enum,geo=nullif(btrim(v_value->>'geo'),''),weight=(v_value->>'weight')::numeric,run_count=(v_value->>'runCount')::integer,is_active=(v_value->>'isActive')::boolean,updated_at=clock_timestamp()where id=any(ids);
  elsif kind='query_archive'then update public.geo_queries set archived_at=coalesce(archived_at,clock_timestamp()),is_active=false,updated_at=clock_timestamp()where id=any(ids);
  else update public.geo_queries set archived_at=null,is_active=false,updated_at=clock_timestamp()where id=any(ids);end if;
  select jsonb_agg(to_jsonb(z)order by z.id)into v_after from public.geo_queries z where z.id=any(ids);v_action:=case kind when'query_edit'then'audit.query_edited'when'query_archive'then'audit.queries_archived'else'audit.queries_restored'end;v_result:=jsonb_build_object('queryIds',to_jsonb(ids),'count',cardinality(ids));
 elsif kind in('finding_review','recommendation_review')then
  if p_input-array['operation','resourceId','sourceHash','status','owner','notes','reason']<>'{}'or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 1 and 2000 or coalesce(p_input->>'status','')not in('todo','in_progress','fixed','wont_fix')or jsonb_typeof(p_input->'owner')is distinct from'string'or (p_input->>'owner')not in('','web_developer','content','seo','partnerships')or jsonb_typeof(p_input->'notes')is distinct from'string'or length(p_input->>'notes')>8000 then return'{"state":"invalid_input"}';end if;
  begin v_id:=(p_input->>'resourceId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
  if kind='finding_review'then select*into finding from public.geo_site_findings where id=v_id and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;v_before:=to_jsonb(finding);
  else select*into rec from public.geo_recommendations where id=v_id and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;v_before:=to_jsonb(rec);if not rec.is_current then return'{"state":"source_changed"}';end if;end if;
  if p_input->>'sourceHash'is distinct from public.knowledge_hash(v_before)then return'{"state":"source_changed"}';end if;
  if kind='finding_review'then
   update public.geo_site_findings set status=(p_input->>'status')::public.geo_finding_status_enum,owner=nullif(p_input->>'owner',''),notes=nullif(p_input->>'notes',''),fixed_at=case when p_input->>'status'='fixed'then coalesce(fixed_at,clock_timestamp())else null end,updated_at=clock_timestamp()where id=v_id returning*into finding;v_after:=to_jsonb(finding);v_action:='audit.finding_reviewed';
  else
   update public.geo_recommendations set status=(p_input->>'status')::public.geo_finding_status_enum,owner=nullif(p_input->>'owner',''),updated_at=clock_timestamp()where id=v_id returning*into rec;v_after:=to_jsonb(rec);v_action:='audit.recommendation_reviewed';
  end if;v_result:=jsonb_build_object('resourceId',v_id,'reportedStatus',p_input->>'status','verifiedImprovement',false);
 elsif kind='run_request'then
  if p_input-array['operation','sourceHash','surfaces','executionCount','measurementMode','includeSiteCrawl']<>'{}'or jsonb_typeof(p_input->'surfaces')is distinct from'array'or jsonb_array_length(p_input->'surfaces')not between 1 and 6 or jsonb_typeof(p_input->'executionCount')is distinct from'number'or(p_input->>'executionCount')!~'^[1-5]$'or coalesce(p_input->>'measurementMode','')not in('natural','structured','local_fixture')or(p_input?'includeSiteCrawl'and jsonb_typeof(p_input->'includeSiteCrawl')is distinct from'boolean')then return'{"state":"invalid_input"}';end if;
  if exists(select 1 from jsonb_array_elements(p_input->'surfaces')x where jsonb_typeof(x)is distinct from'object'or x-array['surface','modelName']<>'{}'or coalesce(x->>'surface','')not in('openai','chatgpt','claude','gemini','perplexity','google_ai')or jsonb_typeof(x->'modelName')is distinct from'string'or length(btrim(x->>'modelName'))not between 1 and 200)or(select count(distinct x->>'surface')from jsonb_array_elements(p_input->'surfaces')x)<>jsonb_array_length(p_input->'surfaces')then return'{"state":"invalid_input"}';end if;
  perform 1 from public.properties where id=p_property_id for share;perform 1 from public.geo_property_config where property_id=p_property_id for share;perform 1 from public.geo_queries where property_id=p_property_id order by id for share;
  v_context:=public.geo_operator_context(p_property_id);
  if p_input->>'sourceHash'is distinct from v_context->>'hash'then return'{"state":"source_changed"}';end if;
  v_count:=(v_context->>'queryCount')::integer*(p_input->>'executionCount')::integer;
  if v_count not between 1 and 300 then return'{"state":"query_limit"}';end if;
  if (select count(*)from public.geo_execution_jobs where property_id=p_property_id and created_at>statement_timestamp()-interval'24 hours')+jsonb_array_length(p_input->'surfaces')>24 then return'{"state":"daily_limit"}';end if;
  if coalesce((p_input->>'includeSiteCrawl')::boolean,false)then
   if coalesce(v_context#>>'{property,website_url}','')!~'^https?://[^/@[:space:]]+'then return'{"state":"website_required"}';end if;
   if exists(select 1 from public.geo_site_crawls where property_id=p_property_id and status in('queued','running'))then return'{"state":"crawl_open"}';end if;
   insert into public.geo_site_crawls(id,property_id,batch_id,status,seed_url,page_cap,requested_by,operator_request_id,measurement_mode)values(p_id,p_property_id,p_id,'queued',v_context#>>'{property,website_url}',greatest(1,least(5000,coalesce((v_context#>>'{configuration,crawl_page_cap}')::integer,500))),p_actor_id,p_id,p_input->>'measurementMode');
  end if;
  v_before:=v_context;v_after:='[]';
  for v_surface in select value from jsonb_array_elements(p_input->'surfaces')order by value->>'surface'loop
   insert into public.geo_runs(property_id,batch_id,surface,model_name,status,execution_count,query_count,measurement_mode,prompt_source,access_mode,requested_by,operator_request_id,started_at,run_metadata)
    values(p_property_id,p_id,(v_surface->>'surface')::public.geo_surface_enum,v_surface->>'modelName','queued',(p_input->>'executionCount')::integer,v_count,p_input->>'measurementMode','reviewed_queries','URLOnly',p_actor_id,p_id,clock_timestamp(),jsonb_build_object('operator_request_id',p_id,'reviewed_source_hash',v_context->>'hash','selected_surfaces',p_input->'surfaces','measurement_mode',p_input->>'measurementMode','include_site_crawl',coalesce((p_input->>'includeSiteCrawl')::boolean,false)))returning*into r;
   perform public.enqueue_geo_execution(r.id);
   select*into r from public.geo_runs where id=r.id;
   v_run_ids:=v_run_ids||jsonb_build_array(r.id);v_after:=v_after||jsonb_build_array(to_jsonb(r));
  end loop;
  if not coalesce((p_input->>'includeSiteCrawl')::boolean,false)then update public.geo_analysis_jobs set state='failed',error_code='website_crawl_not_selected'where batch_id=p_id;end if;
  v_action:='audit.runs_requested';v_result:=jsonb_build_object('runIds',v_run_ids,'count',jsonb_array_length(v_after),'expectedExecutions',v_count*jsonb_array_length(v_after),'crawlId',case when coalesce((p_input->>'includeSiteCrawl')::boolean,false)then p_id else null end);
 elsif kind in('crawl_stop','crawl_retry')then
  if p_input-array['operation','crawlId','sourceHash','reason']<>'{}'or jsonb_typeof(p_input->'reason')is distinct from'string'or length(p_input->>'reason')>2000 then return'{"state":"invalid_input"}';end if;
  begin v_id:=(p_input->>'crawlId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
  select*into v_crawl from public.geo_site_crawls where id=v_id and property_id=p_property_id for update;
  if not found then return'{"state":"not_found"}';end if;
  v_before:=to_jsonb(v_crawl)-array['lease_token','lease_until'];
  if p_input->>'sourceHash'is distinct from public.knowledge_hash(v_before)then return'{"state":"source_changed"}';end if;
  if v_crawl.operator_request_id is null then return'{"state":"legacy_source_unavailable"}';end if;
  if kind='crawl_stop'then
   if v_crawl.status not in('queued','running')then return'{"state":"run_changed"}';end if;
   update public.geo_site_crawls set status='failed',lease_token=null,lease_until=null,finished_at=clock_timestamp(),error_message='Stopped by an operator; captured pages retained.'where id=v_id returning*into v_crawl;v_action:='audit.crawl_stopped';
  else
   if v_crawl.status<>'failed'or exists(select 1 from public.geo_site_crawls where property_id=p_property_id and status in('queued','running'))then return'{"state":"crawl_open"}';end if;
   if(select count(*)from public.geo_site_crawls where property_id=p_property_id and created_at>statement_timestamp()-interval'24 hours')>=24 then return'{"state":"daily_limit"}';end if;
   insert into public.geo_site_crawls(id,property_id,batch_id,seed_url,page_cap,requested_by,operator_request_id,measurement_mode,retry_of)values(p_id,p_property_id,v_crawl.batch_id,v_crawl.seed_url,v_crawl.page_cap,p_actor_id,p_id,v_crawl.measurement_mode,v_id)returning*into v_crawl;
   update public.geo_analysis_jobs set state='queued',attempts=0,lease_token=null,lease_until=null,available_at=clock_timestamp(),error_code=null where batch_id=v_crawl.batch_id and state<>'running';v_action:='audit.crawl_retry_requested';
  end if;
  v_after:=to_jsonb(v_crawl)-array['lease_token','lease_until'];v_result:=jsonb_build_object('crawlId',v_crawl.id,'count',1);
 elsif kind in('run_stop','run_retry','run_archive','run_restore','run_review')then
  if p_input-array['operation','runId','revision','sourceHash','reason','review']<>'{}'or jsonb_typeof(p_input->'reason')is distinct from'string'or length(p_input->>'reason')>2000 or coalesce(p_input->>'revision','')!~'^[1-9][0-9]{0,8}$'then return'{"state":"invalid_input"}';end if;
  begin v_id:=(p_input->>'runId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
  -- Worker transitions lock the job before the run; operator controls use the same order.
  perform 1 from public.geo_execution_jobs where run_id=v_id and property_id=p_property_id for update;
  select*into r from public.geo_runs where id=v_id and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;
  if r.control_revision::text<>p_input->>'revision'then return'{"state":"run_changed"}';end if;
  v_before:=public.geo_operator_run_source(r.id);
  v_hash:=public.knowledge_hash(v_before);
  if p_input->>'sourceHash'is distinct from v_hash then return'{"state":"source_changed"}';end if;
  if kind='run_review'then
   if coalesce(p_input->>'review','')not in('accepted_for_planning','needs_correction','inconclusive')or length(btrim(p_input->>'reason'))=0 then return'{"state":"invalid_input"}';end if;
   if r.status in('queued','running')then return'{"state":"run_open"}';end if;
   v_after:=jsonb_build_object('review',p_input->>'review','reason',p_input->>'reason','sourceHash',v_hash,'verifiedImprovement',false);v_action:='audit.run_reviewed';
  elsif kind='run_stop'then
   if r.status not in('queued','running')then return'{"state":"run_changed"}';end if;
   update public.geo_execution_jobs set state='failed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where run_id=r.id;
   update public.geo_execution_items set state='failed',error_code='operator_stopped'where run_id=r.id and state in('queued','running');
   update public.geo_runs set stopped_by_operator=true,status='failed',finished_at=clock_timestamp(),last_updated_at=clock_timestamp(),error_message='Stopped by an operator. Earlier measured results are retained.',provider_failure_reason='operator_stopped'where id=r.id returning*into r;
   v_after:=to_jsonb(r);v_action:='audit.run_stopped';
  elsif kind='run_archive'then
   if r.status in('queued','running')then return'{"state":"run_open"}';end if;
   update public.geo_runs set archived_at=coalesce(archived_at,clock_timestamp())where id=r.id returning*into r;v_after:=to_jsonb(r);v_action:='audit.run_archived';
  elsif kind='run_restore'then
   update public.geo_runs set archived_at=null where id=r.id returning*into r;v_after:=to_jsonb(r);v_action:='audit.run_restored';
  else
   if r.status<>'failed'or r.archived_at is not null then return'{"state":"run_changed"}';end if;
   select*into source_job from public.geo_execution_jobs where run_id=r.id;
   if not found or not exists(select 1 from public.geo_execution_items where run_id=r.id)then return'{"state":"legacy_source_unavailable"}';end if;
   if (select count(*)from public.geo_execution_jobs where property_id=p_property_id and created_at>statement_timestamp()-interval'24 hours')>=24 then return'{"state":"daily_limit"}';end if;
   insert into public.geo_runs(id,property_id,batch_id,surface,model_name,status,execution_count,query_count,execution_version,measurement_mode,prompt_source,access_mode,requested_by,operator_request_id,retry_of,started_at,run_metadata)
    values(p_id,p_property_id,p_id,r.surface,r.model_name,'queued',r.execution_count,r.query_count,2,r.measurement_mode,r.prompt_source,r.access_mode,p_actor_id,p_id,r.id,clock_timestamp(),jsonb_build_object('retry_of',r.id,'source_request_id',r.operator_request_id,'operator_request_id',p_id,'measurement_mode',r.measurement_mode))returning*into r;
   insert into public.geo_execution_jobs(run_id,property_id,surface,snapshot)values(r.id,p_property_id,r.surface::text,jsonb_set(source_job.snapshot,'{run}',to_jsonb(r)));
   insert into public.geo_execution_items(run_id,ordinal,query_snapshot)select r.id,ordinal,query_snapshot from public.geo_execution_items where run_id=source_job.run_id order by ordinal;
   insert into public.geo_analysis_jobs(batch_id,property_id)values(r.batch_id,p_property_id);
   v_after:=to_jsonb(r);v_action:='audit.run_retry_requested';
  end if;v_result:=jsonb_build_object('runId',r.id,'count',1);

 else return'{"state":"invalid_input"}';end if;
 v_result:=v_result||jsonb_build_object('state','saved','status',coalesce(v_result->>'status','saved'),'id',p_id,'propertyId',p_property_id,'operation',kind);
 insert into public.geo_operator_commands(id,property_id,org_id,actor_id,operation,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,kind,p_input,v_before,v_after,v_result);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'propertyaudit',v_action,'server_confirmed','succeeded',jsonb_build_object('commandId',p_id),null,null,v_result-'state','{}')->>'state'not in('recorded','replayed')then raise exception 'Audit action history unavailable';end if;return v_result;
end$$;
create function public.geo_operator_run_source(p_run_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
begin return(select jsonb_build_object('run',to_jsonb(r),'invocations',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'itemId',v.item_id,'attempt',v.attempt,'state',v.state,'applied',v.applied,'startedAt',v.started_at,'returnedAt',v.returned_at,'resultHash',case when v.provider_result is null then null else public.knowledge_hash(v.provider_result)end,'errorCode',v.error_code)order by v.started_at,v.id)from public.geo_provider_invocations v where v.run_id=r.id),'[]'),'job',(select to_jsonb(j)-array['lease_token','lease_until']from public.geo_execution_jobs j where j.run_id=r.id),'answers',coalesce((select jsonb_agg(jsonb_build_object('answer',to_jsonb(a),'citations',coalesce((select jsonb_agg(to_jsonb(c)order by c.id)from public.geo_citations c where c.answer_id=a.id),'[]'))order by a.id)from public.geo_answers a where a.run_id=r.id),'[]'),'scores',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from public.geo_scores s where s.run_id=r.id),'[]'))from public.geo_runs r where r.id=p_run_id);end$$;
create function public.read_geo_operator(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;member_role text;kind text:=coalesce(p_input->>'kind','context');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_search text:=btrim(coalesce(p_input->>'search',''));v_archive text:=coalesce(p_input->>'archive','current');v_count integer;v_hash text;v_items jsonb;v_source jsonb;cmd public.geo_operator_commands;v_id uuid;
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_offset not between 0 and 1000000 or length(v_search)>200 or v_archive not in('current','archived','all')then return'{"state":"invalid_input"}';end if;
 if kind='command'then
  select*into cmd from public.geo_operator_commands where id=(p_input->>'id')::uuid and actor_id=p_actor_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  return cmd.result||'{"state":"ready"}';
 elsif kind='context'then
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(member_role in('admin','manager'),false),'context',public.geo_operator_context(p_property_id));
 elsif kind='run'then
  v_id:=(p_input->>'id')::uuid;
  if not exists(select 1 from public.geo_runs where id=v_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
  v_source:=public.geo_operator_run_source(v_id);
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(member_role in('admin','manager'),false),'source',v_source,'hash',public.knowledge_hash(v_source),'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'ordinal',i.ordinal,'query',i.query_snapshot,'state',i.state,'attempts',i.attempts,'answerId',i.answer_id,'errorCode',i.error_code)order by i.ordinal)from public.geo_execution_items i where i.run_id=v_id),'[]'));
 elsif kind='performance'then
  v_source:=public.geo_operator_context(p_property_id);
  return jsonb_build_object('state','ready','propertyId',p_property_id,'queryRows',v_source->'queries','answers',coalesce((
    select jsonb_agg(to_jsonb(a)||jsonb_build_object('geo_queries',i.query_snapshot)order by a.created_at,a.id)
    from public.geo_answers a join public.geo_execution_items i on i.answer_id=a.id and i.run_id=a.run_id
    join public.geo_queries q on q.id=a.query_id and q.property_id=p_property_id and q.is_active and q.archived_at is null
    where a.run_id in(select id from public.geo_runs where property_id=p_property_id and status='completed'and archived_at is null and measurement_mode<>'local_fixture'order by started_at desc,id limit 2)
    and i.query_snapshot->>'text'=q.text and i.query_snapshot->>'type'=q.type::text and coalesce(i.query_snapshot->>'geo','')=coalesce(q.geo,'')and coalesce((i.query_snapshot->>'weight')::numeric,1)=coalesce(q.weight,1)
   ),'[]'));
 elsif kind='invocation'then
  select to_jsonb(v)-'lease_token'into v_source from public.geo_provider_invocations v where v.id=(p_input->>'id')::uuid and v.property_id=p_property_id and v.org_id=organization;
  if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'source',v_source,'hash',public.knowledge_hash(v_source));
 elsif kind='crawl'then
  select to_jsonb(z)-array['lease_token','lease_until']into v_source from public.geo_site_crawls z where z.id=(p_input->>'id')::uuid and z.property_id=p_property_id;
  if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'source',v_source,'hash',public.knowledge_hash(v_source));
 elsif kind='crawls'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,status,last_updated_at)order by id),'[]'))into v_count,v_hash from public.geo_site_crawls where property_id=p_property_id;
  select coalesce(jsonb_agg(to_jsonb(z)-array['lease_token','lease_until','crawl_state']order by z.created_at desc,z.id),'[]')into v_items from(select*from public.geo_site_crawls where property_id=p_property_id order by created_at desc,id offset v_offset limit 25)z;
 elsif kind='service_history'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at desc,id desc),'[]'))into v_count,v_hash from public.geo_service_events where property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(to_jsonb(z)order by z.created_at desc,z.id desc),'[]')into v_items from(select*from public.geo_service_events where property_id=p_property_id and org_id=organization order by created_at desc,id desc offset v_offset limit 25)z;
 elsif kind='queries'then
  with items as(select*from public.geo_queries z where z.property_id=p_property_id and(v_archive='all'or(v_archive='archived')=(z.archived_at is not null))and(v_search=''or position(lower(v_search)in lower(z.text))>0))select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,decision_revision)order by id),'[]'))into v_count,v_hash from items;
  select coalesce(jsonb_agg(to_jsonb(z)order by z.created_at desc,z.id),'[]')into v_items from(select*from public.geo_queries where property_id=p_property_id and(v_archive='all'or(v_archive='archived')=(archived_at is not null))and(v_search=''or position(lower(v_search)in lower(text))>0)order by created_at desc,id offset v_offset limit 25)z;
 elsif kind='runs'then
  with items as(select*from public.geo_runs z where z.property_id=p_property_id and(v_archive='all'or(v_archive='archived')=(z.archived_at is not null)))select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,control_revision)order by id),'[]'))into v_count,v_hash from items;
  select coalesce(jsonb_agg(to_jsonb(z)order by z.started_at desc,z.id),'[]')into v_items from(select*from public.geo_runs where property_id=p_property_id and(v_archive='all'or(v_archive='archived')=(archived_at is not null))order by started_at desc,id offset v_offset limit 25)z;
 elsif kind in('findings','recommendations')then
  if kind='findings'then
   select count(*),public.knowledge_hash(coalesce(jsonb_agg(to_jsonb(z)order by z.id),'[]'))into v_count,v_hash from public.geo_site_findings z where property_id=p_property_id;
   select coalesce(jsonb_agg(to_jsonb(z)||jsonb_build_object('sourceHash',public.knowledge_hash(to_jsonb(z)))order by z.first_detected_at desc,z.id),'[]')into v_items from(select*from public.geo_site_findings where property_id=p_property_id order by first_detected_at desc,id offset v_offset limit 25)z;
  else
   select count(*),public.knowledge_hash(coalesce(jsonb_agg(to_jsonb(z)order by z.id),'[]'))into v_count,v_hash from public.geo_recommendations z where property_id=p_property_id and is_current;
   select coalesce(jsonb_agg(to_jsonb(z)||jsonb_build_object('sourceHash',public.knowledge_hash(to_jsonb(z)))order by z.created_at desc,z.id),'[]')into v_items from(select*from public.geo_recommendations where property_id=p_property_id and is_current order by created_at desc,id offset v_offset limit 25)z;
  end if;
 elsif kind='history'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at desc,id desc),'[]'))into v_count,v_hash from public.geo_operator_commands where property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(c)||jsonb_build_object('actorName',coalesce(a.full_name,'Team member'))value,c.created_at,c.id from public.geo_operator_commands c left join public.profiles a on a.id=c.actor_id where c.property_id=p_property_id and c.org_id=organization order by c.created_at desc,c.id desc offset v_offset limit 25)z;
 else return'{"state":"invalid_input"}';end if;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',coalesce(member_role in('admin','manager'),false),'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset);
end$$;

-- Provider responses survive application failures and operator stops. These are worker records, never human demonstrations.
create table public.geo_provider_invocations(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),run_id uuid not null references public.geo_runs(id)on delete cascade,item_id uuid not null references public.geo_execution_items(id)on delete cascade,lease_token uuid not null,attempt integer not null,source_snapshot jsonb not null,state text not null default'started'check(state in('started','returned','failed')),provider_result jsonb,error_code text,applied boolean not null default false,application_result jsonb,started_at timestamptz not null default clock_timestamp(),returned_at timestamptz,applied_at timestamptz,unique(item_id,attempt));
create index geo_provider_invocations_property on public.geo_provider_invocations(property_id,started_at desc,id);
create index geo_provider_invocations_org on public.geo_provider_invocations(org_id);
create index geo_provider_invocations_run on public.geo_provider_invocations(run_id);
create table public.geo_service_events(id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),run_id uuid references public.geo_runs(id)on delete cascade,invocation_id uuid references public.geo_provider_invocations(id)on delete cascade,kind text not null,detail jsonb not null,created_at timestamptz not null default clock_timestamp());
create index geo_service_events_property on public.geo_service_events(property_id,created_at desc,id);
create index geo_service_events_org on public.geo_service_events(org_id);
create index geo_service_events_run on public.geo_service_events(run_id);
create index geo_service_events_invocation on public.geo_service_events(invocation_id);
alter table public.geo_provider_invocations enable row level security;alter table public.geo_service_events enable row level security;
revoke all on public.geo_provider_invocations,public.geo_service_events from public,anon,authenticated;
grant all on public.geo_provider_invocations,public.geo_service_events to service_role;
create policy geo_provider_invocations_service on public.geo_provider_invocations for all to service_role using(true)with check(true);
create policy geo_service_events_service on public.geo_service_events for all to service_role using(true)with check(true);
create function public.guard_geo_service()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Retain audit provider evidence';end if;
 if current_setting('p11.geo_service_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded audit worker transition';end if;
 if tg_table_name='geo_service_events'then if tg_op='UPDATE'then raise exception 'Audit service history is immutable';end if;
 elsif tg_op='UPDATE'then
  if(new.id,new.property_id,new.org_id,new.run_id,new.item_id,new.lease_token,new.attempt,new.source_snapshot,new.started_at)is distinct from(old.id,old.property_id,old.org_id,old.run_id,old.item_id,old.lease_token,old.attempt,old.source_snapshot,old.started_at)then raise exception 'Audit invocation identity is immutable';end if;
  if old.state<>'started'and(new.state,new.provider_result,new.error_code,new.returned_at)is distinct from(old.state,old.provider_result,old.error_code,old.returned_at)then raise exception 'Audit provider response is immutable';end if;
  if old.applied and(new.applied,new.application_result,new.applied_at)is distinct from(old.applied,old.application_result,old.applied_at)then raise exception 'Audit application evidence is immutable';end if;
 end if;return new;
end$$;
create trigger geo_service_events_guard before insert or update or delete on public.geo_service_events for each row execute function public.guard_geo_service();
create trigger geo_provider_invocations_guard before insert or update or delete on public.geo_provider_invocations for each row execute function public.guard_geo_service();
create function public.record_geo_service(p_property_id uuid,p_run_id uuid,p_invocation_id uuid,p_kind text,p_detail jsonb)returns uuid language plpgsql security invoker set search_path=''as $$
declare event_id uuid:=gen_random_uuid();organization uuid;
begin
 select org_id into organization from public.properties where id=p_property_id;
 if organization is null or(p_run_id is not null and not exists(select 1 from public.geo_runs where id=p_run_id and property_id=p_property_id))or(p_invocation_id is not null and not exists(select 1 from public.geo_provider_invocations where id=p_invocation_id and run_id=p_run_id and property_id=p_property_id))or p_kind not in('invocation_started','response_retained','response_applied','execution_claimed','execution_finished','execution_held','crawl_claimed','crawl_checkpoint','crawl_completed','crawl_failed')or jsonb_typeof(p_detail)is distinct from'object'then raise exception 'Invalid audit worker evidence';end if;
 perform set_config('p11.geo_service_scope',p_property_id::text,true);
 insert into public.geo_service_events(id,property_id,org_id,run_id,invocation_id,kind,detail)values(event_id,p_property_id,organization,p_run_id,p_invocation_id,p_kind,p_detail);
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,organization,p_property_id,'propertyaudit.worker','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,'propertyaudit.worker','propertyaudit','audit.worker.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('runId',p_run_id,'invocationId',p_invocation_id),jsonb_build_object('serviceEventId',event_id));
 return event_id;
end$$;
create function public.start_geo_provider_invocation(p_run_id uuid,p_token uuid,p_item_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare j public.geo_execution_jobs;i public.geo_execution_items;v public.geo_provider_invocations;organization uuid;
begin
 select*into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>statement_timestamp()and state='running'for update;
 if not found or not exists(select 1 from public.geo_runs where id=p_run_id and status='running'and not stopped_by_operator)then return'{"state":"lease_lost"}';end if;
 select*into i from public.geo_execution_items where id=p_item_id and run_id=p_run_id and state='running'for update;if not found then return'{"state":"item_changed"}';end if;
 -- An actual retained response is applied before another provider call is allowed.
 select*into v from public.geo_provider_invocations where item_id=i.id and state='returned'and not applied order by started_at,id limit 1;
 if found then return jsonb_build_object('state','retained','invocationId',v.id);end if;
 select*into v from public.geo_provider_invocations where item_id=i.id and attempt=i.attempts;
 if found then return jsonb_build_object('state',case when v.state='started'then'in_progress'else'retained'end,'invocationId',v.id);end if;
 select org_id into organization from public.properties where id=j.property_id;perform set_config('p11.geo_service_scope',j.property_id::text,true);
 insert into public.geo_provider_invocations(property_id,org_id,run_id,item_id,lease_token,attempt,source_snapshot)values(j.property_id,organization,j.run_id,i.id,p_token,i.attempts,jsonb_build_object('job',j.snapshot,'query',i.query_snapshot,'ordinal',i.ordinal))returning*into v;
 perform public.record_geo_service(j.property_id,j.run_id,v.id,'invocation_started',jsonb_build_object('attempt',i.attempts,'measurementMode',j.snapshot#>>'{run,measurement_mode}'));
 return jsonb_build_object('state','claimed','invocationId',v.id);
end$$;
create function public.finish_geo_provider_invocation(p_id uuid,p_token uuid,p_result jsonb default null,p_error text default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v public.geo_provider_invocations;
begin
 select*into v from public.geo_provider_invocations where id=p_id and lease_token=p_token for update;if not found then return'{"state":"not_found"}';end if;
 if(p_result is null)=(p_error is null)or length(coalesce(p_error,''))>1000 or(p_result is not null and(jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>4194304))then return'{"state":"invalid_input"}';end if;
 if v.state<>'started'then
  if(v.provider_result,v.error_code)is distinct from(p_result,p_error)then return'{"state":"response_conflict"}';end if;
  return jsonb_build_object('state','retained','invocationId',v.id);
 end if;
 perform set_config('p11.geo_service_scope',v.property_id::text,true);
 update public.geo_provider_invocations set state=case when p_result is null then'failed'else'returned'end,provider_result=p_result,error_code=p_error,returned_at=clock_timestamp()where id=p_id;
 perform public.record_geo_service(v.property_id,v.run_id,v.id,'response_retained',jsonb_build_object('resultAvailable',p_result is not null,'errorCode',p_error,'leaseCurrent',exists(select 1 from public.geo_execution_jobs where run_id=v.run_id and lease_token=p_token and lease_until>statement_timestamp()and state='running')));
 return jsonb_build_object('state','retained','invocationId',v.id);
end$$;
create function public.apply_geo_provider_invocation(p_id uuid,p_run_id uuid,p_token uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v public.geo_provider_invocations;j public.geo_execution_jobs;answer jsonb;
begin
 select*into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>statement_timestamp()and state='running'for update;if not found then return'{"state":"lease_lost"}';end if;
 select*into v from public.geo_provider_invocations where id=p_id and run_id=p_run_id for update;if not found then return'{"state":"not_found"}';end if;
 if v.applied then return v.application_result;end if;
 if v.state='started'then return'{"state":"response_pending"}';end if;
 if not exists(select 1 from public.geo_runs where id=p_run_id and status='running'and not stopped_by_operator)then return'{"state":"stopped"}';end if;
 if not exists(select 1 from public.geo_execution_items where id=v.item_id and run_id=p_run_id and state='running')then return'{"state":"item_changed"}';end if;
 answer:=public.advance_geo_execution(p_run_id,p_token,v.item_id,v.provider_result,v.error_code);
 perform set_config('p11.geo_service_scope',v.property_id::text,true);
 update public.geo_provider_invocations set applied=true,application_result=answer,applied_at=clock_timestamp()where id=v.id;
 perform public.record_geo_service(v.property_id,v.run_id,v.id,'response_applied',jsonb_build_object('resultSaved',v.state='returned','retryScheduled',coalesce((answer->>'retry_scheduled')::boolean,false)));
 return answer;
end$$;

create function public.claim_geo_site_crawl(p_crawl_id uuid default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;
begin
 perform pg_advisory_xact_lock(401905);
 for c in update public.geo_site_crawls z set status='failed',lease_token=null,lease_until=null,finished_at=clock_timestamp(),error_message='Crawl recovery limit reached or requesting account no longer has access.'where z.operator_request_id is not null and z.status in('queued','running')and(z.lease_until is null or z.lease_until<=statement_timestamp())and(z.claim_count>=3 or not exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where p.id=z.property_id and a.id=z.requested_by and a.role in('admin','manager')))returning*loop
  perform public.record_geo_service(c.property_id,null,null,'crawl_failed',jsonb_build_object('crawlId',c.id,'error',c.error_message));
 end loop;

 if(select count(*)from public.geo_site_crawls where operator_request_id is not null and status='running'and lease_until>statement_timestamp())>=2 then return null;end if;
 select*into c from public.geo_site_crawls z where z.operator_request_id is not null and(p_crawl_id is null or z.id=p_crawl_id)and(p_crawl_id is not null or z.measurement_mode<>'local_fixture')and z.status in('queued','running')and(z.lease_until is null or z.lease_until<=statement_timestamp())and z.claim_count<3
 and exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where p.id=z.property_id and a.id=z.requested_by and a.role in('admin','manager'))
 and not exists(select 1 from public.geo_site_crawls peer where peer.id<>z.id and peer.property_id=z.property_id and peer.status='running'and peer.lease_until>statement_timestamp())
 order by z.created_at,z.id for update skip locked limit 1;
 if not found then return null;end if;
 update public.geo_site_crawls set status='running',lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval'3 minutes',claim_count=claim_count+1,started_at=coalesce(started_at,clock_timestamp()),last_updated_at=clock_timestamp(),finished_at=null,error_message=null where id=c.id returning*into c;
 perform public.record_geo_service(c.property_id,null,null,'crawl_claimed',jsonb_build_object('crawlId',c.id,'claimCount',c.claim_count));return to_jsonb(c);
end$$;
create function public.save_geo_site_crawl(p_crawl_id uuid,p_token uuid,p_kind text,p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare c public.geo_site_crawls;v jsonb;f public.geo_site_findings;before_rows jsonb;after_rows jsonb;changes int:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended((select property_id::text from public.geo_site_crawls where id=p_crawl_id),4));
 select*into c from public.geo_site_crawls where id=p_crawl_id and operator_request_id is not null and lease_token=p_token and lease_until>statement_timestamp()and status='running'for update;
 if not found then return'{"state":"lease_lost"}';end if;
 if jsonb_typeof(p_payload)is distinct from'object'or octet_length(p_payload::text)>16777216 then return'{"state":"invalid_input"}';end if;
 if p_kind='pages'then
  if jsonb_typeof(p_payload->'pages')is distinct from'array'or jsonb_array_length(p_payload->'pages')>50 then return'{"state":"invalid_input"}';end if;
  for v in select value from jsonb_array_elements(p_payload->'pages')loop
   if jsonb_typeof(v)is distinct from'object'or length(coalesce(v->>'url',''))not between 1 and 10000 then raise exception 'Invalid crawl page';end if;
   insert into public.geo_crawl_pages(crawl_id,url,final_url,status_code,redirect_chain,content_type,response_headers,title,meta_description,meta_robots,canonical_url,h1s,h2s,word_count,html_bytes,text_html_ratio,images,internal_links,external_links,structured_data,content,forms,provenance,mixed_content,blocked_resources,page_type,crawl_depth,inlink_count,in_sitemap,blocked_by_robots,fetch_error)select crawl_id,url,final_url,status_code,redirect_chain,content_type,response_headers,title,meta_description,meta_robots,canonical_url,h1s,h2s,word_count,html_bytes,text_html_ratio,images,internal_links,external_links,structured_data,content,forms,provenance,mixed_content,blocked_resources,page_type,crawl_depth,inlink_count,in_sitemap,blocked_by_robots,fetch_error from jsonb_populate_record(null::public.geo_crawl_pages,v||jsonb_build_object('crawl_id',c.id))on conflict(crawl_id,url)do update set url=excluded.url,final_url=excluded.final_url,status_code=excluded.status_code,redirect_chain=excluded.redirect_chain,content_type=excluded.content_type,response_headers=excluded.response_headers,title=excluded.title,meta_description=excluded.meta_description,meta_robots=excluded.meta_robots,canonical_url=excluded.canonical_url,h1s=excluded.h1s,h2s=excluded.h2s,word_count=excluded.word_count,html_bytes=excluded.html_bytes,text_html_ratio=excluded.text_html_ratio,images=excluded.images,internal_links=excluded.internal_links,external_links=excluded.external_links,structured_data=excluded.structured_data,content=excluded.content,forms=excluded.forms,provenance=excluded.provenance,mixed_content=excluded.mixed_content,blocked_resources=excluded.blocked_resources,page_type=excluded.page_type,crawl_depth=excluded.crawl_depth,inlink_count=excluded.inlink_count,in_sitemap=excluded.in_sitemap,blocked_by_robots=excluded.blocked_by_robots,fetch_error=excluded.fetch_error;
  end loop;
  if(select count(*)from public.geo_crawl_pages where crawl_id=c.id)>c.page_cap then raise exception 'Reviewed crawl page limit exceeded';end if;
 elsif p_kind='checkpoint'then
  if jsonb_typeof(p_payload->'crawl_state')is distinct from'object'then return'{"state":"invalid_input"}';end if;
  update public.geo_site_crawls set crawl_state=p_payload->'crawl_state',pages_crawled=(select count(*)from public.geo_crawl_pages where crawl_id=c.id),pages_discovered=greatest(0,coalesce((p_payload->>'pages_discovered')::integer,0))where id=c.id;
  perform public.record_geo_service(c.property_id,null,null,'crawl_checkpoint',jsonb_build_object('crawlId',c.id,'sourceHash',public.knowledge_hash(p_payload),'pages',(select count(*)from public.geo_crawl_pages where crawl_id=c.id)));
 elsif p_kind='completed'then
  if jsonb_typeof(p_payload->'findings')is distinct from'array'or jsonb_array_length(p_payload->'findings')>1000 then return'{"state":"invalid_input"}';end if;
  -- Serialize against operator review. An absent detector result does not prove a previous finding was fixed.
  perform pg_advisory_xact_lock(hashtextextended(c.property_id::text,4));
  select coalesce(jsonb_agg(to_jsonb(z)order by z.id),'[]')into before_rows from public.geo_site_findings z where z.property_id=c.property_id;
  for v in select value from jsonb_array_elements(p_payload->'findings')loop
   insert into public.geo_site_findings(property_id,source_crawl_id,fingerprint,category,detector,severity,title,description,occurrences,affected_urls,affected_url_count,evidence,status,owner)
   values(c.property_id,c.id,v->>'fingerprint',v->>'category',v->>'detector',(v->>'severity')::public.geo_finding_severity_enum,v->>'title',v->>'description',(v->>'occurrences')::integer,v->'affected_urls',(v->>'affected_url_count')::integer,v->'evidence','todo',coalesce(v->>'owner','web_developer'))
   on conflict(property_id,fingerprint)do update set source_crawl_id=excluded.source_crawl_id,category=excluded.category,detector=excluded.detector,severity=excluded.severity,title=excluded.title,description=excluded.description,occurrences=excluded.occurrences,affected_urls=excluded.affected_urls,affected_url_count=excluded.affected_url_count,evidence=excluded.evidence,last_seen_at=clock_timestamp(),updated_at=clock_timestamp(),status=case when geo_site_findings.status='fixed'then'todo'::public.geo_finding_status_enum else geo_site_findings.status end,fixed_at=case when geo_site_findings.status='fixed'then null else geo_site_findings.fixed_at end;
   changes:=changes+1;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(z)order by z.id),'[]')into after_rows from public.geo_site_findings z where z.property_id=c.property_id;
  update public.geo_site_crawls set status='completed',finished_at=clock_timestamp(),lease_until=null,crawl_state=jsonb_build_object('final',true,'page_cap_reached',coalesce(p_payload->'page_cap_reached','false')),pages_crawled=(select count(*)from public.geo_crawl_pages where crawl_id=c.id),pages_discovered=greatest(0,coalesce((p_payload->>'pages_discovered')::integer,0)),robots_summary=p_payload->'robots_summary',sitemap_summary=p_payload->'sitemap_summary',llms_txt_summary=p_payload->'llms_txt_summary'where id=c.id;
  perform public.record_geo_service(c.property_id,null,null,'crawl_completed',jsonb_build_object('crawlId',c.id,'findings',changes,'before',before_rows,'after',after_rows,'coverage',p_payload-'findings','absenceIsVerifiedFix',false));
 elsif p_kind='failed'then
  update public.geo_site_crawls set status='failed',finished_at=clock_timestamp(),lease_until=null,error_message=left(coalesce(p_payload->>'error','Crawl failed'),2000)where id=c.id;
  perform public.record_geo_service(c.property_id,null,null,'crawl_failed',jsonb_build_object('crawlId',c.id,'error',p_payload->>'error'));
 elsif p_kind<>'heartbeat'then return'{"state":"invalid_input"}';end if;
 update public.geo_site_crawls set last_updated_at=clock_timestamp(),lease_until=case when status='running'then clock_timestamp()+interval'3 minutes'else null end where id=c.id;
 return jsonb_build_object('state','saved','crawlId',c.id);
end$$;

create function public.guard_geo_review_source()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_table_name='geo_crawl_pages'then
  if tg_op='DELETE'then
   if exists(select 1 from public.geo_site_crawls c join public.properties p on p.id=c.property_id where c.id=old.crawl_id and c.operator_request_id is not null)then raise exception 'Retain reviewed crawl page evidence';end if;
   return old;
  end if;
  return new;
 end if;
 if tg_op='DELETE'then
  if exists(select 1 from public.properties where id=old.property_id)then raise exception 'Retain audit source evidence';end if;return old;
 end if;
 if current_user='authenticated'then raise exception 'Use a recorded audit decision';end if;
 if tg_op='UPDATE'then
  if new.property_id is distinct from old.property_id then raise exception 'Audit evidence property is immutable';end if;
  if tg_table_name='geo_site_crawls'then
   if old.operator_request_id is not null then
    if(new.seed_url,new.page_cap,new.batch_id,new.requested_by,new.operator_request_id,new.measurement_mode,new.retry_of)is distinct from(old.seed_url,old.page_cap,old.batch_id,old.requested_by,old.operator_request_id,old.measurement_mode,old.retry_of)then raise exception 'Reviewed crawl source is immutable';end if;
   end if;
  end if;
 end if;return new;
end$$;
create trigger geo_crawl_source_guard before update or delete on public.geo_site_crawls for each row execute function public.guard_geo_review_source();
create trigger geo_crawl_page_retention before delete on public.geo_crawl_pages for each row execute function public.guard_geo_review_source();
create trigger geo_finding_review_guard before update or delete on public.geo_site_findings for each row execute function public.guard_geo_review_source();
create trigger geo_recommendation_review_guard before update or delete on public.geo_recommendations for each row execute function public.guard_geo_review_source();

create or replace function public.claim_geo_execution(p_run_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.geo_execution_jobs; token uuid := gen_random_uuid();
begin
  -- Serialize admission, not provider work. At most four workers and one per surface.
  perform pg_advisory_xact_lock(401904);
  update public.geo_execution_jobs expired_job set state='failed',finished_at=now(),lease_until=null,lease_token=null
    where expired_job.state in ('queued','running') and exists(select 1 from public.geo_runs r where r.id=expired_job.run_id and r.status not in ('queued','running'));
  -- Bound crashes before an item can even be claimed, in addition to item retries.
  update public.geo_runs r set status='failed',finished_at=now(),error_message='Execution could not recover after repeated worker interruptions'
    where r.status in ('queued','running') and exists(select 1 from public.geo_execution_jobs expired_job where expired_job.run_id=r.id and expired_job.claim_count>=1000 and (expired_job.lease_until is null or expired_job.lease_until<=now()));
  if (select count(*) from public.geo_execution_jobs where state='running' and lease_until>now()) >= 4 then return null; end if;
  select * into j from public.geo_execution_jobs x
    where (p_run_id is null or x.run_id=p_run_id) and x.state in ('queued','running') and x.available_at<=now()
      and (x.lease_until is null or x.lease_until<=now())
      and exists(select 1 from public.geo_runs r where r.id=x.run_id and r.status in ('queued','running')and not r.stopped_by_operator and r.archived_at is null and(p_run_id is not null or r.measurement_mode<>'local_fixture')and(r.requested_by is null or exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where p.id=r.property_id and a.id=r.requested_by and a.role in('admin','manager'))))
      and not exists(select 1 from public.geo_execution_jobs y where y.surface=x.surface and y.state='running' and y.lease_until>now())
    order by x.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.geo_execution_jobs set state='running',lease_token=token,lease_until=now()+interval '3 minutes',claim_count=claim_count+1 where run_id=j.run_id returning * into j;
  update public.geo_runs set status='running',last_updated_at=now() where id=j.run_id;
  -- A interrupted provider call counts as an attempt; completed items never run again.
  update public.geo_execution_items set state=case when attempts>=3 then 'failed' else 'queued' end,error_code='worker_interrupted'
    where run_id=j.run_id and state='running';
  perform public.record_geo_service(j.property_id,j.run_id,null,'execution_claimed',jsonb_build_object('claimCount',j.claim_count));
  return to_jsonb(j);
end; $$;
create or replace function public.finish_geo_execution(p_run_id uuid,p_token uuid,p_aggregate jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare n integer; done integer; failed integer; final_state text;
begin
 perform 1 from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>now() and state='running' for update;
 if not found then raise exception 'Execution lease lost'; end if;
 select count(*),count(*) filter(where state='completed'),count(*) filter(where state='failed') into n,done,failed from public.geo_execution_items where run_id=p_run_id;
 if done+failed<>n then raise exception 'Unfinished execution items'; end if;
 final_state:=case when done=0 then 'failed' when failed>0 then 'partial' else 'completed' end;
 if done>0 then
   insert into public.geo_scores(run_id,overall_score,visibility_pct,avg_llm_rank,avg_link_rank,avg_sov,breakdown,query_scores)
     values(p_run_id,(p_aggregate->>'overall_score')::numeric,(p_aggregate->>'visibility_pct')::numeric,(p_aggregate->>'avg_llm_rank')::numeric,(p_aggregate->>'avg_link_rank')::numeric,(p_aggregate->>'avg_sov')::numeric,
       coalesce(p_aggregate->'breakdown','{}')||jsonb_build_object('coverage_pct',round(100.0*done/n,1),'expected',n,'succeeded',done,'failed',failed,'measurement_state',final_state),
       (select coalesce(jsonb_agg(score order by ordinal),'[]') from public.geo_execution_items where run_id=p_run_id and state='completed'));
 end if;
 -- Existing status enums/readers stay compatible: incomplete measurements are failed,
 -- while their saved answers and score remain available with explicit coverage.
 update public.geo_runs set status=case when failed=0 then 'completed'::public.geo_run_status_enum else 'failed'::public.geo_run_status_enum end,
   finished_at=now(),progress_pct=100,last_updated_at=now(),
   error_message=case when failed>0 then format('Incomplete measurement: %s of %s executions succeeded; %s failed after bounded retries.',done,n,failed) else null end,
   provider_failure_reason=case when failed>0 then 'partial_measurement' else null end,
   run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('measurement_state',final_state,'expected_executions',n,'successful_executions',done,'failed_executions',failed,'coverage_pct',round(100.0*done/n,1))
   where id=p_run_id and status='running';
 if not found then raise exception 'Run is no longer running'; end if;
 update public.geo_execution_jobs set state=final_state,lease_until=null,lease_token=null,finished_at=now() where run_id=p_run_id;
 perform public.record_geo_service((select property_id from public.geo_runs where id=p_run_id),p_run_id,null,'execution_finished',jsonb_build_object('state',final_state,'expected',n,'succeeded',done,'failed',failed));
 return jsonb_build_object('state',final_state,'succeeded',done,'failed',failed,'expected',n);
end; $$;
create or replace function public.claim_geo_analysis() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.geo_analysis_jobs; crawl uuid;
begin
 perform pg_advisory_xact_lock(401905);
 update public.geo_analysis_jobs a set state='failed',error_code='website_crawl_unavailable'
   where state='queued' and not exists(select 1 from public.geo_runs r where r.batch_id=a.batch_id and r.status in ('queued','running'))
   and (exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id and c.status::text='failed')
        or (a.created_at<now()-interval '1 hour' and not exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id)))
   and not exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id and c.status::text in ('queued','running','completed'));

 update public.geo_analysis_jobs set state='failed',error_code='analysis_retries_exhausted',lease_token=null,lease_until=null
   where state in ('queued','running') and attempts>=3 and (lease_until is null or lease_until<=now());
 if exists(select 1 from public.geo_analysis_jobs where state='running' and lease_until>now()) then return null; end if;
 select * into j from public.geo_analysis_jobs a where not exists(select 1 from public.geo_runs r where r.batch_id=a.batch_id and r.measurement_mode='local_fixture')and state in ('queued','running') and available_at<=now() and (lease_until is null or lease_until<=now())
   and not exists(select 1 from public.geo_runs r where r.batch_id=a.batch_id and r.status in ('queued','running'))
   and exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id and c.property_id=a.property_id and c.status='completed')
   order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 select id into crawl from public.geo_site_crawls where batch_id=j.batch_id and property_id=j.property_id and status='completed' order by finished_at desc limit 1;
 update public.geo_analysis_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where batch_id=j.batch_id returning * into j;
 return to_jsonb(j)||jsonb_build_object('crawl_id',crawl);
end; $$;
revoke all on function public.guard_geo_operator()from public,anon,authenticated;
grant execute on function public.guard_geo_operator()to service_role;
revoke all on function public.geo_operator_context(uuid)from public,anon,authenticated;
grant execute on function public.geo_operator_context(uuid)to service_role;
revoke all on function public.geo_operator_query_valid(jsonb)from public,anon,authenticated;
grant execute on function public.geo_operator_query_valid(jsonb)to service_role;
revoke all on function public.decide_geo_operator(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.decide_geo_operator(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.geo_operator_run_source(uuid)from public,anon,authenticated;
grant execute on function public.geo_operator_run_source(uuid)to service_role;
revoke all on function public.read_geo_operator(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_geo_operator(uuid,uuid,jsonb)to service_role;
revoke all on function public.guard_geo_service()from public,anon,authenticated;
grant execute on function public.guard_geo_service()to service_role;
revoke all on function public.record_geo_service(uuid,uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.record_geo_service(uuid,uuid,uuid,text,jsonb)to service_role;
revoke all on function public.start_geo_provider_invocation(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.start_geo_provider_invocation(uuid,uuid,uuid)to service_role;
revoke all on function public.finish_geo_provider_invocation(uuid,uuid,jsonb,text)from public,anon,authenticated;
grant execute on function public.finish_geo_provider_invocation(uuid,uuid,jsonb,text)to service_role;
revoke all on function public.apply_geo_provider_invocation(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.apply_geo_provider_invocation(uuid,uuid,uuid)to service_role;
revoke all on function public.claim_geo_site_crawl(uuid)from public,anon,authenticated;
grant execute on function public.claim_geo_site_crawl(uuid)to service_role;
revoke all on function public.save_geo_site_crawl(uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.save_geo_site_crawl(uuid,uuid,text,jsonb)to service_role;
revoke all on function public.guard_geo_review_source()from public,anon,authenticated;
grant execute on function public.guard_geo_review_source()to service_role;
notify pgrst,'reload schema';

-- Recheck requesting-account access before each new provider invocation.
create or replace function public.start_geo_provider_invocation(p_run_id uuid,p_token uuid,p_item_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare j public.geo_execution_jobs;i public.geo_execution_items;v public.geo_provider_invocations;organization uuid;
begin
 select*into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>statement_timestamp()and state='running'for update;
 if not found or not exists(select 1 from public.geo_runs where id=p_run_id and status='running'and not stopped_by_operator)then return'{"state":"lease_lost"}';end if;
 if exists(select 1 from public.geo_runs r where r.id=p_run_id and r.requested_by is not null and not exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where p.id=r.property_id and a.id=r.requested_by and a.role in('admin','manager')))then
  update public.geo_execution_jobs set state='failed',lease_token=null,lease_until=null,finished_at=clock_timestamp()where run_id=p_run_id;
  update public.geo_execution_items set state='failed',error_code='authorization_changed'where run_id=p_run_id and state in('queued','running');
  update public.geo_runs set status='failed',finished_at=clock_timestamp(),error_message='The requesting account no longer has audit access.',provider_failure_reason='authorization_changed'where id=p_run_id;
  perform public.record_geo_service(j.property_id,j.run_id,null,'execution_held','{"reason":"authorization_changed"}');
  return'{"state":"authorization_changed"}';
 end if;
 select*into i from public.geo_execution_items where id=p_item_id and run_id=p_run_id and state='running'for update;if not found then return'{"state":"item_changed"}';end if;
 -- An actual retained response is applied before another provider call is allowed.
 select*into v from public.geo_provider_invocations where item_id=i.id and state='returned'and not applied order by started_at,id limit 1;
 if found then return jsonb_build_object('state','retained','invocationId',v.id);end if;
 select*into v from public.geo_provider_invocations where item_id=i.id and attempt=i.attempts;
 if found then return jsonb_build_object('state',case when v.state='started'then'in_progress'else'retained'end,'invocationId',v.id);end if;
 select org_id into organization from public.properties where id=j.property_id;perform set_config('p11.geo_service_scope',j.property_id::text,true);
 insert into public.geo_provider_invocations(property_id,org_id,run_id,item_id,lease_token,attempt,source_snapshot)values(j.property_id,organization,j.run_id,i.id,p_token,i.attempts,jsonb_build_object('job',j.snapshot,'query',i.query_snapshot,'ordinal',i.ordinal))returning*into v;
 perform public.record_geo_service(j.property_id,j.run_id,v.id,'invocation_started',jsonb_build_object('attempt',i.attempts,'measurementMode',j.snapshot#>>'{run,measurement_mode}'));
 return jsonb_build_object('state','claimed','invocationId',v.id);
end$$;
