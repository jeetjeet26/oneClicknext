create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

-- A query is a reviewed calculation over one retained BI source, never generated SQL.
create function public.bi_query_plan_valid(p_plan jsonb,p_filters jsonb)returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare starts date;ends date;
begin
 if jsonb_typeof(p_plan)is distinct from'object'or not(p_plan?&array['groupBy','startDate','endDate','channel'])or p_plan-array['groupBy','startDate','endDate','channel']<>'{}'then return false;end if;
 if p_plan->>'groupBy'is null or p_plan->>'groupBy'not in('none','day','week','month','channel','campaign')or coalesce(p_plan->>'startDate','')!~'^\d{4}-\d{2}-\d{2}$'or coalesce(p_plan->>'endDate','')!~'^\d{4}-\d{2}-\d{2}$'then return false;end if;
 begin starts:=(p_plan->>'startDate')::date;ends:=(p_plan->>'endDate')::date;exception when others then return false;end;
 if starts::text<>p_plan->>'startDate'or ends::text<>p_plan->>'endDate'or ends<starts or ends-starts>365 or starts<(p_filters->>'startDate')::date or ends>(p_filters->>'endDate')::date then return false;end if;
 if p_plan->'channel'<>'null'then
  if jsonb_typeof(p_plan->'channel')is distinct from'string'or(p_plan->>'channel')!~'^[a-z][a-z0-9_]{0,49}$'or p_filters->'channel'<>'null'and p_plan->>'channel'<>p_filters->>'channel'then return false;end if;
 end if;return true;
end$$;
create table public.bi_queries(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 input jsonb not null,source jsonb not null,source_hash text not null,state text not null check(state in('requested','planning','review','complete','held','cancelled')),revision integer not null default 1,
 plan jsonb,plan_hash text,result jsonb,result_hash text,claim_token uuid,claimed_at timestamptz,model_receipt jsonb,issue text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.bi_query_commands(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.bi_query_events(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),query_id uuid references public.bi_queries(id)on delete cascade,actor_id uuid references public.profiles(id),action text not null,details jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index bi_queries_property on public.bi_queries(property_id,actor_id,created_at desc,id desc);
create index bi_queries_org on public.bi_queries(org_id);
create index bi_queries_actor on public.bi_queries(actor_id);
create index bi_query_commands_property on public.bi_query_commands(property_id,actor_id,created_at desc,id desc);
create index bi_query_commands_org on public.bi_query_commands(org_id);
create index bi_query_commands_actor on public.bi_query_commands(actor_id);
create index bi_query_events_property on public.bi_query_events(property_id,created_at desc,id desc);
create index bi_query_events_org on public.bi_query_events(org_id);
create index bi_query_events_actor on public.bi_query_events(actor_id);
create index bi_query_events_query on public.bi_query_events(query_id,created_at desc,id desc);
alter table public.bi_queries enable row level security;
alter table public.bi_query_commands enable row level security;
alter table public.bi_query_events enable row level security;
revoke all on public.bi_queries,public.bi_query_commands,public.bi_query_events from public,anon,authenticated;
grant all on public.bi_queries,public.bi_query_commands,public.bi_query_events to service_role;
create policy bi_queries_service on public.bi_queries for all to service_role using(true)with check(true);
create policy bi_query_commands_service on public.bi_query_commands for all to service_role using(true)with check(true);
create policy bi_query_events_service on public.bi_query_events for all to service_role using(true)with check(true);
create function public.guard_bi_query()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Query history follows property retention';end if;
 if current_setting('p11.bi_query_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded query decision';end if;
 if tg_op='UPDATE'then
  if tg_table_name<>'bi_queries'then raise exception 'Query history is immutable';end if;
  if(new.id,new.property_id,new.org_id,new.actor_id,new.input,new.source,new.source_hash)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.input,old.source,old.source_hash)then raise exception 'Query source and identity are immutable';end if;
  if old.result is not null and(new.result,new.result_hash)is distinct from(old.result,old.result_hash)then raise exception 'Query results are immutable';end if;
  if old.claim_token is not null and(new.claim_token,new.claimed_at)is distinct from(old.claim_token,old.claimed_at)then raise exception 'Model invocation is immutable';end if;
  if old.model_receipt is not null and new.model_receipt is distinct from old.model_receipt then raise exception 'Model receipt is immutable';end if;
 end if;return new;
end$$;
create trigger bi_queries_guard before insert or update or delete on public.bi_queries for each row execute function public.guard_bi_query();
create trigger bi_query_commands_guard before insert or update or delete on public.bi_query_commands for each row execute function public.guard_bi_query();
create trigger bi_query_events_guard before insert or update or delete on public.bi_query_events for each row execute function public.guard_bi_query();
create function public.bi_query_event(p_id uuid,p_property_id uuid,p_query_id uuid,p_actor_id uuid,p_action text,p_details jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare organization uuid;e jsonb;
begin
 select org_id into organization from public.properties where id=p_property_id;if not found then raise exception 'Property unavailable';end if;
 perform set_config('p11.bi_query_scope',p_property_id::text,true);
 insert into public.bi_query_events(id,property_id,org_id,query_id,actor_id,action,details)values(p_id,p_property_id,organization,p_query_id,p_actor_id,p_action,p_details);
 if p_actor_id is not null then
  e:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi',p_action,'server_confirmed','succeeded',jsonb_build_object('queryId',p_query_id),null,null,p_details,'{}');if e->>'state'not in('recorded','replayed')then raise exception 'Query action unavailable';end if;
 else
  if p_action not in('bi.query.interpretation_started','bi.query.interpretation_recorded','bi.query.interpretation_held')then raise exception 'Unregistered query system action';end if;
  insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(p_id,organization,p_property_id,'bi.query_interpreter','workflow');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(p_id,p_id,organization,p_property_id,'bi.query_interpreter','bi',p_action,'server_confirmed','succeeded',jsonb_build_object('queryId',p_query_id),p_details);
 end if;
end$$;
create function public.decide_bi_query(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb,p_result jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;c public.bi_query_commands;q public.bi_queries;v_source jsonb;v_result jsonb;v_before jsonb;v_after jsonb;v_action text;kind text:=p_input->>'operation';v_query uuid;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,956));select*into c from public.bi_query_commands where id=p_id;
 if found then
  if(c.property_id,c.org_id,c.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if kind='cancel_request'or c.input->>'operation'='cancel_request'then return c.result||'{"state":"replayed"}';end if;
  if c.input<>p_input then return'{"state":"request_conflict"}';end if;return c.result||'{"state":"replayed"}';
 end if;
 perform set_config('p11.bi_query_scope',p_property_id::text,true);
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='bi.query.request_cancelled';v_result:='{"status":"cancelled_request"}';
 elsif kind='request'then
  if p_input-array['operation','mode','question','filters','sourceHash','plan']<>'{}'or p_input->>'mode'is null or p_input->>'mode'not in('manual','assistant')or jsonb_typeof(p_input->'question')is distinct from'string'or length(btrim(p_input->>'question'))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
  v_source:=public.bi_report_source(p_actor_id,p_property_id,p_input->'filters');if v_source->>'state'<>'ready'then return v_source;end if;
  if v_source->>'sourceHash'is distinct from p_input->>'sourceHash'then return'{"state":"source_changed"}';end if;
  if p_input->>'mode'='manual'then if not public.bi_query_plan_valid(p_input->'plan',p_input->'filters')then return'{"state":"invalid_plan"}';end if;elsif p_input?'plan'then return'{"state":"invalid_input"}';end if;
  insert into public.bi_queries(id,property_id,org_id,actor_id,input,source,source_hash,state,plan,plan_hash)values(p_id,p_property_id,organization,p_actor_id,p_input,v_source->'source',v_source->>'sourceHash',case when p_input->>'mode'='manual'then'review'else'requested'end,p_input->'plan',case when p_input?'plan'then public.knowledge_hash(p_input->'plan')end)returning*into q;
  v_query:=q.id;v_action:='bi.query.requested';
 else
  if kind is null or kind not in('revise','execute','stop')or p_input-array['operation','queryId','expectedRevision','plan','planHash']<>'{}'or coalesce(p_input->>'expectedRevision','')!~'^[0-9]{1,9}$'then return'{"state":"invalid_input"}';end if;
  begin v_query:=(p_input->>'queryId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
  select*into q from public.bi_queries where id=v_query and actor_id=p_actor_id and property_id=p_property_id and org_id=organization for update;if not found then return'{"state":"not_found"}';end if;
  if q.revision<>(p_input->>'expectedRevision')::integer then return'{"state":"query_changed"}';end if;
  if q.state in('complete','cancelled')then return'{"state":"closed_query"}';end if;
  v_before:=jsonb_build_object('status',q.state,'revision',q.revision,'plan',q.plan,'planHash',q.plan_hash);
  if kind='revise'then
   if p_input-array['operation','queryId','expectedRevision','plan']<>'{}'or not public.bi_query_plan_valid(p_input->'plan',q.source->'filters')then return'{"state":"invalid_plan"}';end if;
   update public.bi_queries set plan=p_input->'plan',plan_hash=public.knowledge_hash(p_input->'plan'),state='review',issue=null,revision=revision+1,updated_at=clock_timestamp()where id=q.id returning*into q;v_action:='bi.query.plan_revised';
  elsif kind='stop'then
   if p_input-array['operation','queryId','expectedRevision']<>'{}'then return'{"state":"invalid_input"}';end if;
   update public.bi_queries set state='cancelled',revision=revision+1,updated_at=clock_timestamp()where id=q.id returning*into q;v_action:='bi.query.stopped';
  else
   if p_input-array['operation','queryId','expectedRevision','planHash']<>'{}'or q.state<>'review'or q.plan_hash is distinct from p_input->>'planHash'then return'{"state":"query_changed"}';end if;
   if jsonb_typeof(p_result)is distinct from'object'or octet_length(p_result::text)>8388608 or p_result->>'definitionVersion'is distinct from'bi-query-v1'or p_result->>'sourceHash'is distinct from q.source_hash or p_result->>'planHash'is distinct from q.plan_hash or jsonb_typeof(p_result->'rows')is distinct from'array'then return'{"state":"invalid_result"}';end if;
   update public.bi_queries set result=p_result,result_hash=public.knowledge_hash(p_result),state='complete',revision=revision+1,updated_at=clock_timestamp()where id=q.id returning*into q;v_action:='bi.query.executed';
  end if;
 end if;
 if v_query is not null then v_after:=jsonb_build_object('status',q.state,'revision',q.revision,'plan',q.plan,'planHash',q.plan_hash);v_result:=jsonb_build_object('queryId',q.id,'status',q.state,'revision',q.revision,'sourceHash',q.source_hash,'planHash',q.plan_hash,'resultHash',q.result_hash);end if;
 v_result:=coalesce(v_result,'{}')||jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id);
 insert into public.bi_query_commands(id,property_id,org_id,actor_id,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,p_input,v_before,v_after,v_result);
 perform public.bi_query_event(p_id,p_property_id,v_query,p_actor_id,v_action,v_result-'state'-'propertyId'-'id');return v_result;
end$$;
create function public.claim_bi_query(p_id uuid,p_claim_token uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare q public.bi_queries;
begin
 if p_claim_token is null then return'{"state":"invalid_input"}';end if;
 select*into q from public.bi_queries where id=p_id for update;if not found then return'{"state":"not_found"}';end if;
 if q.state<>'requested'or q.claim_token is not null then return'{"state":"not_started"}';end if;
 perform set_config('p11.bi_query_scope',q.property_id::text,true);
 if not exists(select 1 from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=q.property_id and p.org_id=q.org_id and a.id=q.actor_id)then
  update public.bi_queries set state='held',issue='access_changed',revision=revision+1,updated_at=clock_timestamp()where id=q.id;perform public.bi_query_event(gen_random_uuid(),q.property_id,q.id,null,'bi.query.interpretation_held','{"issue":"access_changed"}');return'{"state":"not_started"}';
 end if;
 update public.bi_queries set state='planning',claim_token=p_claim_token,claimed_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()where id=q.id returning*into q;
 perform public.bi_query_event(gen_random_uuid(),q.property_id,q.id,null,'bi.query.interpretation_started',jsonb_build_object('revision',q.revision,'sourceHash',q.source_hash));
 return jsonb_build_object('state','started','id',q.id,'propertyId',q.property_id,'question',q.input->'question','filters',q.source->'filters');
end$$;
create function public.prepare_bi_query(p_id uuid,p_claim_token uuid,p_receipt jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare q public.bi_queries;v_plan jsonb;valid boolean;current_access boolean;usage_item record;
begin
 select*into q from public.bi_queries where id=p_id for update;if not found then return'{"state":"not_found"}';end if;
 if q.claim_token is null or q.claim_token is distinct from p_claim_token then return'{"state":"claim_conflict"}';end if;
 if q.model_receipt is not null then if q.model_receipt<>p_receipt then return'{"state":"request_conflict"}';end if;return jsonb_build_object('state','replayed','id',q.id,'propertyId',q.property_id,'status',q.state);end if;
 if jsonb_typeof(p_receipt)is distinct from'object'or octet_length(p_receipt::text)>32768 or p_receipt-array['plan','raw','rawSha256','rawOmitted','providerId','model','usage','issue']<>'{}'or coalesce(p_receipt->>'issue','')not in('','unsupported','invalid_reply','provider_unknown')then return'{"state":"invalid_input"}';end if;
 if p_receipt?'raw'and jsonb_typeof(p_receipt->'raw')not in('string','null')or p_receipt?'model'and(jsonb_typeof(p_receipt->'model')is distinct from'string'or length(p_receipt->>'model')not between 1 and 120)or p_receipt?'providerId'and(jsonb_typeof(p_receipt->'providerId')not in('string','null')or length(p_receipt->>'providerId')>200)or p_receipt?'rawOmitted'and jsonb_typeof(p_receipt->'rawOmitted')is distinct from'boolean'or p_receipt?'rawSha256'and coalesce(p_receipt->>'rawSha256','')!~'^[a-f0-9]{64}$'then return'{"state":"invalid_input"}';end if;
 if p_receipt?'usage'and p_receipt->'usage'<>'null'then
  if jsonb_typeof(p_receipt->'usage')is distinct from'object'or(p_receipt->'usage')-array['inputTokens','outputTokens','totalTokens']<>'{}'then return'{"state":"invalid_input"}';end if;
  for usage_item in select*from jsonb_each(p_receipt->'usage')loop
   if jsonb_typeof(usage_item.value)is distinct from'number'or usage_item.value::text!~'^[0-9]{1,10}$'then return'{"state":"invalid_input"}';end if;
   if usage_item.value::text::numeric>1000000000 then return'{"state":"invalid_input"}';end if;
  end loop;
 end if;
 v_plan:=p_receipt->'plan';valid:=public.bi_query_plan_valid(v_plan,q.source->'filters')and p_receipt->>'issue'is null;
 select exists(select 1 from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=q.property_id and p.org_id=q.org_id and a.id=q.actor_id)into current_access;
 perform set_config('p11.bi_query_scope',q.property_id::text,true);
 if q.state='planning'then
  update public.bi_queries set model_receipt=p_receipt,plan=case when valid and current_access then v_plan else null end,plan_hash=case when valid and current_access then public.knowledge_hash(v_plan)else null end,state=case when valid and current_access then'review'else'held'end,issue=case when not current_access then'access_changed'when not valid then coalesce(p_receipt->>'issue','invalid_reply')end,revision=revision+1,updated_at=clock_timestamp()where id=q.id returning*into q;
 else update public.bi_queries set model_receipt=p_receipt,updated_at=clock_timestamp()where id=q.id returning*into q;end if;
 perform public.bi_query_event(gen_random_uuid(),q.property_id,q.id,null,'bi.query.interpretation_recorded',jsonb_build_object('status',q.state,'revision',q.revision,'planHash',q.plan_hash,'receiptHash',public.knowledge_hash(p_receipt),'issue',q.issue));
 return jsonb_build_object('state','saved','id',q.id,'propertyId',q.property_id,'status',q.state);
end$$;
create function public.read_bi_queries(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;kind text:=coalesce(p_input->>'kind','list');q public.bi_queries;c public.bi_query_commands;v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_hash text;v_items jsonb;v_count integer;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_offset<0 then return'{"state":"invalid_input"}';end if;
 if kind='command'then
  select*into c from public.bi_query_commands where id=(p_input->>'id')::uuid and actor_id=p_actor_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;return c.result||'{"state":"ready"}';
 elsif kind='list'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,revision)order by created_at desc,id desc),'[]'))into v_count,v_hash from public.bi_queries where actor_id=p_actor_id and property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select jsonb_build_object('id',id,'question',input->'question','status',state,'revision',revision,'createdAt',created_at)value,created_at,id from public.bi_queries where actor_id=p_actor_id and property_id=p_property_id and org_id=organization order by created_at desc,id desc offset v_offset limit 20)x;
 else
  select*into q from public.bi_queries where id=(p_input->>'id')::uuid and actor_id=p_actor_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  if kind='detail'then return jsonb_build_object('state','ready','propertyId',p_property_id,'id',q.id,'query',to_jsonb(q)-'claim_token'-'model_receipt'-'result','result',q.result-'rows','rowCount',coalesce(jsonb_array_length(q.result->'rows'),0),'interpretation',case when q.model_receipt is not null then q.model_receipt-'raw'-'plan'else null end);
  elsif kind='rows'then
   v_count:=coalesce(jsonb_array_length(q.result->'rows'),0);v_hash:=coalesce(q.result_hash,public.knowledge_hash('[]'));select coalesce(jsonb_agg(value order by ordinality),'[]')into v_items from(select*from jsonb_array_elements(coalesce(q.result->'rows','[]'))with ordinality offset v_offset limit 25)x;
  elsif kind='history'then
   select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at,id),'[]'))into v_count,v_hash from public.bi_query_events where query_id=q.id;
   select coalesce(jsonb_agg(value order by created_at,id),'[]')into v_items from(select to_jsonb(e)||jsonb_build_object('before',cmd.before_state,'after',cmd.after_state)value,e.created_at,e.id from public.bi_query_events e left join public.bi_query_commands cmd on cmd.id=e.id where e.query_id=q.id order by e.created_at,e.id offset v_offset limit 20)x;
  else return'{"state":"invalid_input"}';end if;
 end if;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'id',q.id,'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset);
end$$;

revoke all on function public.bi_query_plan_valid(jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.bi_query_plan_valid(jsonb,jsonb)to service_role;
revoke all on function public.guard_bi_query()from public,anon,authenticated;
grant execute on function public.guard_bi_query()to service_role;
revoke all on function public.bi_query_event(uuid,uuid,uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.bi_query_event(uuid,uuid,uuid,uuid,text,jsonb)to service_role;
revoke all on function public.decide_bi_query(uuid,uuid,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.decide_bi_query(uuid,uuid,uuid,jsonb,jsonb)to service_role;
revoke all on function public.claim_bi_query(uuid,uuid)from public,anon,authenticated;
grant execute on function public.claim_bi_query(uuid,uuid)to service_role;
revoke all on function public.prepare_bi_query(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.prepare_bi_query(uuid,uuid,jsonb)to service_role;
revoke all on function public.read_bi_queries(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_bi_queries(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
