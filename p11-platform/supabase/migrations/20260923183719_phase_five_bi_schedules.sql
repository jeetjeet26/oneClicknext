create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

-- New schedules are explicit, property scoped and paused until reviewed.
-- Legacy reports are retained for review and are never selected by the new worker.
revoke insert,update,delete on public.scheduled_reports from public,anon,authenticated;

create function public.bi_schedule_config(p_config jsonb)returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare recipient text;
begin
 if jsonb_typeof(p_config)is distinct from'object'or p_config-array['name','frequency','weekday','monthday','hour','window','comparison','campaigns','recipients']<>'{}'or not(p_config?&array['name','frequency','weekday','monthday','hour','window','comparison','campaigns','recipients'])then return false;end if;
 if jsonb_typeof(p_config->'frequency')is distinct from'string'or jsonb_typeof(p_config->'window')is distinct from'string'or jsonb_typeof(p_config->'hour')is distinct from'number'or jsonb_typeof(p_config->'name')is distinct from'string'or length(btrim(p_config->>'name'))not between 1 and 120 or p_config->>'name'~'[\r\n]'or p_config->>'frequency'not in('daily','weekly','monthly')or p_config->>'window'not in('previous_period','last_7_days','last_30_days','month_to_date')or jsonb_typeof(p_config->'comparison')is distinct from'boolean'or jsonb_typeof(p_config->'campaigns')is distinct from'boolean'or(p_config->>'hour')!~'^([0-9]|1[0-9]|2[0-3])$'then return false;end if;
 if p_config->>'frequency'='weekly'then if jsonb_typeof(p_config->'weekday')is distinct from'number'or(p_config->>'weekday')!~'^[0-6]$'or p_config->'weekday'='null'then return false;end if;elsif p_config->'weekday'<>'null'then return false;end if;
 if p_config->>'frequency'='monthly'then if jsonb_typeof(p_config->'monthday')is distinct from'number'or(p_config->>'monthday')!~'^([1-9]|1[0-9]|2[0-8])$'or p_config->'monthday'='null'then return false;end if;elsif p_config->'monthday'<>'null'then return false;end if;
 if jsonb_typeof(p_config->'recipients')is distinct from'array'then return false;end if;
 if jsonb_array_length(p_config->'recipients')not between 1 and 10 then return false;end if;
 if exists(select 1 from jsonb_array_elements(p_config->'recipients')v where jsonb_typeof(v)is distinct from'string')then return false;end if;
 for recipient in select jsonb_array_elements_text(p_config->'recipients')loop
  if length(recipient)>254 or recipient is distinct from lower(btrim(recipient))or recipient!~'^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'then return false;end if;
 end loop;
 return (select count(*)=count(distinct value)from jsonb_array_elements(p_config->'recipients'));
end$$;
create function public.bi_schedule_next(p_config jsonb,p_after timestamptz)returns timestamptz language plpgsql immutable security invoker set search_path=''as $$
declare utc timestamp:=p_after at time zone'UTC';candidate timestamp;
begin
 if not public.bi_schedule_config(p_config)or p_after is null then raise exception 'Invalid schedule';end if;
 candidate:=date_trunc('day',utc)+make_interval(hours=>(p_config->>'hour')::integer);
 if p_config->>'frequency'='daily'then if candidate<=utc then candidate:=candidate+interval'1 day';end if;
 elsif p_config->>'frequency'='weekly'then candidate:=candidate+make_interval(days=>((p_config->>'weekday')::integer-extract(dow from utc)::integer+7)%7);if candidate<=utc then candidate:=candidate+interval'7 days';end if;
 else candidate:=date_trunc('month',utc)+make_interval(days=>(p_config->>'monthday')::integer-1,hours=>(p_config->>'hour')::integer);if candidate<=utc then candidate:=candidate+interval'1 month';end if;end if;
 return candidate at time zone'UTC';
end$$;
create function public.bi_schedule_filters(p_config jsonb,p_occurrence timestamptz)returns jsonb language plpgsql immutable security invoker set search_path=''as $$
declare day date:=(p_occurrence at time zone'UTC')::date;starts date;ends date:=day-1;
begin
 if not public.bi_schedule_config(p_config)or p_occurrence is null then raise exception 'Invalid schedule';end if;
 case p_config->>'window'
 when'last_7_days'then starts:=day-7;
 when'last_30_days'then starts:=day-30;
 when'month_to_date'then starts:=date_trunc('month',day)::date;if starts>ends then return null;end if;
 else case p_config->>'frequency'when'daily'then starts:=ends;when'weekly'then ends:=date_trunc('week',day)::date-1;starts:=ends-6;else ends:=date_trunc('month',day)::date-1;starts:=date_trunc('month',ends)::date;end case;
 end case;
 return jsonb_build_object('startDate',starts,'endDate',ends,'compare',p_config->'comparison','channel',null,'account',null);
end$$;

create table public.bi_schedules(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 authorized_by uuid not null references public.profiles(id),config jsonb not null check(public.bi_schedule_config(config)),revision integer not null default 1,
 state text not null check(state in('paused','active','held','cancelled')),next_run_at timestamptz,last_accepted_at timestamptz,
 hold_reason text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.bi_schedule_commands(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 input jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.bi_schedule_runs(
 id uuid primary key,schedule_id uuid not null references public.bi_schedules(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 authorized_by uuid not null references public.profiles(id),schedule_revision integer not null,occurrence_at timestamptz not null,config jsonb not null,
 source jsonb,source_hash text,payload jsonb,payload_hash text,state text not null check(state in('open','accepted','held','closed','empty')),
 issue text,created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,unique(schedule_id,occurrence_at)
);
create table public.bi_schedule_deliveries(
 id uuid primary key,run_id uuid not null references public.bi_schedule_runs(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 recipient text not null,state text not null default'pending'check(state in('pending','in_flight','accepted','unknown','skipped')),
 claim_token uuid,attempted_at timestamptz,provider_id text,closed boolean not null default false,updated_at timestamptz not null default clock_timestamp(),unique(run_id,recipient)
);
create table public.bi_schedule_events(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 schedule_id uuid references public.bi_schedules(id)on delete cascade,run_id uuid references public.bi_schedule_runs(id)on delete cascade,
 actor_id uuid references public.profiles(id),action text not null,details jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index bi_schedules_due on public.bi_schedules(next_run_at,id)where state='active';
create index bi_schedules_property on public.bi_schedules(property_id,created_at desc,id desc);
create index bi_schedules_author on public.bi_schedules(authorized_by);
create index bi_commands_property on public.bi_schedule_commands(property_id,created_at desc);
create index bi_commands_actor on public.bi_schedule_commands(actor_id);
create index bi_runs_schedule on public.bi_schedule_runs(schedule_id,created_at desc,id desc);
create index bi_runs_property on public.bi_schedule_runs(property_id);
create index bi_runs_author on public.bi_schedule_runs(authorized_by);
create index bi_deliveries_property on public.bi_schedule_deliveries(property_id);
create index bi_events_property on public.bi_schedule_events(property_id,created_at desc,id desc);
create index bi_events_schedule on public.bi_schedule_events(schedule_id);
create index bi_events_run on public.bi_schedule_events(run_id);
create index bi_events_actor on public.bi_schedule_events(actor_id);

create function public.guard_bi_schedule_records()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Schedule history follows property retention';end if;
 if current_setting('p11.bi_schedule_scope',true)is distinct from new.property_id::text then raise exception 'Use a scoped report schedule operation';end if;
 if tg_op='UPDATE'then
  if tg_table_name in('bi_schedule_commands','bi_schedule_events')then raise exception 'Schedule decisions are immutable';end if;
  if(new.id,new.property_id,new.org_id)is distinct from(old.id,old.property_id,old.org_id)then raise exception 'Schedule scope is immutable';end if;
  if tg_table_name='bi_schedule_runs'then
   if(new.schedule_id,new.authorized_by,new.schedule_revision,new.occurrence_at,new.config,new.source,new.source_hash)is distinct from(old.schedule_id,old.authorized_by,old.schedule_revision,old.occurrence_at,old.config,old.source,old.source_hash)then raise exception 'Scheduled report source is immutable';end if;
   if old.payload is not null and(new.payload,new.payload_hash)is distinct from(old.payload,old.payload_hash)then raise exception 'Prepared message is immutable';end if;
  end if;
  if tg_table_name='bi_schedule_deliveries'then
   if(new.run_id,new.recipient)is distinct from(old.run_id,old.recipient)or old.claim_token is not null and(new.claim_token,new.attempted_at)is distinct from(old.claim_token,old.attempted_at)or old.provider_id is not null and new.provider_id is distinct from old.provider_id then raise exception 'Delivery identity is immutable';end if;
  end if;
 end if;
 return new;
end$$;

create function public.bi_schedule_event(p_id uuid,p_property_id uuid,p_schedule_id uuid,p_run_id uuid,p_actor_id uuid,p_action text,p_details jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare organization uuid;e jsonb;
begin
 select org_id into organization from public.properties where id=p_property_id;if not found then raise exception 'Property unavailable';end if;
 perform set_config('p11.bi_schedule_scope',p_property_id::text,true);
 insert into public.bi_schedule_events(id,property_id,org_id,schedule_id,run_id,actor_id,action,details)values(p_id,p_property_id,organization,p_schedule_id,p_run_id,p_actor_id,p_action,p_details);
 if p_actor_id is not null then
  e:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi',p_action,'server_confirmed','succeeded',jsonb_build_object('scheduleId',p_schedule_id,'runId',p_run_id),null,null,p_details,'{}');if e->>'state'not in('recorded','replayed')then raise exception 'Schedule action unavailable';end if;
 else
  if p_action not in('bi.schedule.claimed','bi.schedule.held','bi.schedule.empty','bi.delivery.started','bi.delivery.reported','bi.schedule.finished')then raise exception 'Unregistered scheduled report system action';end if;
  insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(p_id,organization,p_property_id,'bi.scheduler','workflow');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(p_id,p_id,organization,p_property_id,'bi.scheduler','bi',p_action,'server_confirmed','succeeded',jsonb_build_object('scheduleId',p_schedule_id,'runId',p_run_id),p_details);
 end if;
end$$;

create function public.decide_bi_schedule(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;prior public.bi_schedule_commands;s public.bi_schedules;r public.bi_schedule_runs;kind text:=p_input->>'operation';v_result jsonb;v_action text;v_schedule uuid;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id and a.role in('admin','manager');if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,950));select*into prior from public.bi_schedule_commands where id=p_id;
 if found then
  if(prior.property_id,prior.org_id,prior.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if prior.input->>'operation'='cancel_request'or kind='cancel_request'then return prior.result||'{"state":"replayed"}';end if;
  if prior.input<>p_input then return'{"state":"request_conflict"}';end if;return prior.result||'{"state":"replayed"}';
 end if;
 perform set_config('p11.bi_schedule_scope',p_property_id::text,true);
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='bi.schedule.request_cancelled';v_result:=jsonb_build_object('status','cancelled_request');
 elsif kind='create'then
  if p_input-array['operation','config']<>'{}'or not coalesce(public.bi_schedule_config(p_input->'config'),false)then return'{"state":"invalid_input"}';end if;
  insert into public.bi_schedules(id,property_id,org_id,authorized_by,config,state)values(p_id,p_property_id,organization,p_actor_id,p_input->'config','paused')returning*into s;v_schedule:=s.id;v_action:='bi.schedule.created';
 else
  if kind not in('edit','pause','resume','cancel','close_run')or kind is null or p_input-array['operation','scheduleId','expectedRevision','config']<>'{}'then return'{"state":"invalid_input"}';end if;
  select*into s from public.bi_schedules where id=(p_input->>'scheduleId')::uuid and property_id=p_property_id and org_id=organization for update;if not found then return'{"state":"not_found"}';end if;
  if s.revision is distinct from(p_input->>'expectedRevision')::integer then return'{"state":"schedule_changed"}';end if;
  if s.state='cancelled'then return'{"state":"closed_schedule"}';end if;v_schedule:=s.id;
  if kind in('edit','resume')and exists(select 1 from public.bi_schedule_runs where schedule_id=s.id and state in('open','held'))then return'{"state":"open_run"}';end if;
  if kind='edit'then
   if not coalesce(public.bi_schedule_config(p_input->'config'),false)then return'{"state":"invalid_input"}';end if;
   update public.bi_schedules set config=p_input->'config',authorized_by=p_actor_id,state='paused',next_run_at=null,hold_reason=null,revision=revision+1,updated_at=clock_timestamp()where id=s.id returning*into s;v_action:='bi.schedule.edited';
  elsif kind='resume'then
   if s.state='active'then return'{"state":"schedule_changed"}';end if;
   update public.bi_schedules set state='active',authorized_by=p_actor_id,next_run_at=public.bi_schedule_next(config,clock_timestamp()),hold_reason=null,revision=revision+1,updated_at=clock_timestamp()where id=s.id returning*into s;v_action:='bi.schedule.resumed';
  else
   -- Pause/cancel fences every recipient not yet started. An already started send may still be accepted.
   for r in select*from public.bi_schedule_runs where schedule_id=s.id and state in('open','held')for update loop
    update public.bi_schedule_deliveries set state=case when state='pending'then'skipped'when state='in_flight'then'unknown'else state end,closed=true,updated_at=clock_timestamp()where run_id=r.id and not closed;
    update public.bi_schedule_runs set state='closed',issue='operator_closed',finished_at=clock_timestamp()where id=r.id;
   end loop;
   update public.bi_schedules set state=case when kind='cancel'then'cancelled'else'paused'end,next_run_at=null,hold_reason=null,revision=revision+1,updated_at=clock_timestamp()where id=s.id returning*into s;
   v_action:=case kind when'pause'then'bi.schedule.paused'when'cancel'then'bi.schedule.cancelled'else'bi.schedule.run_closed'end;
  end if;
 end if;
 if s.id is not null then v_result:=jsonb_build_object('scheduleId',s.id,'status',s.state,'revision',s.revision,'nextRunAt',s.next_run_at,'configHash',public.knowledge_hash(s.config));end if;
 v_result:=v_result||jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id);
 insert into public.bi_schedule_commands(id,property_id,org_id,actor_id,input,result)values(p_id,p_property_id,organization,p_actor_id,p_input,v_result);
 perform public.bi_schedule_event(p_id,p_property_id,v_schedule,null,p_actor_id,v_action,v_result-'state'-'propertyId'-'id');return v_result;
end$$;

create function public.claim_bi_schedule(p_id uuid,p_schedule_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare s public.bi_schedules;r public.bi_schedule_runs;filters jsonb;source_result jsonb;recipient text;reason text;
begin
 if p_id is null then return'{"state":"invalid_input"}';end if;
 select*into s from public.bi_schedules where id=p_schedule_id for update;if not found then return'{"state":"not_found"}';end if;
 -- No claim replay grants delivery authority. Lost claim responses remain held for operator review.
 if exists(select 1 from public.bi_schedule_runs where id=p_id)then return'{"state":"already_claimed"}';end if;
 if s.state<>'active'or s.next_run_at is null or s.next_run_at>clock_timestamp()then return'{"state":"not_due"}';end if;
 if exists(select 1 from public.bi_schedule_runs where schedule_id=s.id and state in('open','held'))then return'{"state":"open_run"}';end if;
 perform set_config('p11.bi_schedule_scope',s.property_id::text,true);
 if not exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where a.id=s.authorized_by and a.role in('admin','manager')and p.id=s.property_id and p.org_id=s.org_id)then reason:='authorization_changed';
 elsif s.next_run_at<clock_timestamp()-interval'24 hours'then reason:='missed_run';end if;
 if reason is not null then
  update public.bi_schedules set state='held',hold_reason=reason,revision=revision+1,updated_at=clock_timestamp()where id=s.id;
  perform public.bi_schedule_event(gen_random_uuid(),s.property_id,s.id,null,null,'bi.schedule.held',jsonb_build_object('reason',reason));return jsonb_build_object('state','held','reason',reason);
 end if;
 filters:=public.bi_schedule_filters(s.config,s.next_run_at);
 if filters is not null then
  begin source_result:=public.bi_report_source(s.authorized_by,s.property_id,filters);exception when others then source_result:='{"state":"source_unavailable"}';end;
  if source_result->>'state'<>'ready'then
   update public.bi_schedules set state='held',hold_reason='source_unavailable',revision=revision+1,updated_at=clock_timestamp()where id=s.id;
   perform public.bi_schedule_event(gen_random_uuid(),s.property_id,s.id,null,null,'bi.schedule.held','{"reason":"source_unavailable"}');return'{"state":"held","reason":"source_unavailable"}';
  end if;
 end if;
 insert into public.bi_schedule_runs(id,schedule_id,property_id,org_id,authorized_by,schedule_revision,occurrence_at,config,source,source_hash,state,issue,finished_at)
 values(p_id,s.id,s.property_id,s.org_id,s.authorized_by,s.revision,s.next_run_at,s.config,source_result->'source',source_result->>'sourceHash',case when filters is null then'empty'else'open'end,case when filters is null then'no_completed_dates'end,case when filters is null then clock_timestamp()end)returning*into r;
 if filters is null then
  update public.bi_schedules set next_run_at=public.bi_schedule_next(config,clock_timestamp()),revision=revision+1,updated_at=clock_timestamp()where id=s.id;
  perform public.bi_schedule_event(gen_random_uuid(),s.property_id,s.id,r.id,null,'bi.schedule.empty','{"reason":"no_completed_dates","providerCalled":false}');return jsonb_build_object('state','empty','id',r.id);
 end if;
 for recipient in select jsonb_array_elements_text(s.config->'recipients')loop insert into public.bi_schedule_deliveries(id,run_id,property_id,org_id,recipient)values(gen_random_uuid(),r.id,s.property_id,s.org_id,recipient);end loop;
 update public.bi_schedules set state='held',hold_reason='run_in_progress',revision=revision+1,updated_at=clock_timestamp()where id=s.id;
 perform public.bi_schedule_event(gen_random_uuid(),s.property_id,s.id,r.id,null,'bi.schedule.claimed',jsonb_build_object('sourceHash',r.source_hash,'occurrenceAt',r.occurrence_at,'authorizationRevision',r.schedule_revision));
 return jsonb_build_object('state','claimed','id',r.id,'propertyId',r.property_id,'source',r.source,'sourceHash',r.source_hash,'config',r.config,'occurrenceAt',r.occurrence_at,'createdAt',r.created_at);
end$$;

create function public.prepare_bi_schedule_run(p_id uuid,p_payload jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.bi_schedule_runs;s public.bi_schedules;
begin
 select*into r from public.bi_schedule_runs where id=p_id;if not found then return'{"state":"not_found"}';end if;
 select*into s from public.bi_schedules where id=r.schedule_id for update;select*into r from public.bi_schedule_runs where id=p_id for update;
 if r.state<>'open'or s.state<>'held'or s.hold_reason<>'run_in_progress'then return'{"state":"closed_run"}';end if;
 if jsonb_typeof(p_payload)is distinct from'object'or p_payload-array['from','subject','html']<>'{}'or not(p_payload?&array['from','subject','html'])or jsonb_typeof(p_payload->'from')is distinct from'string'or length(p_payload->>'from')not between 3 and 320 or p_payload->>'from'~'[\r\n]'or jsonb_typeof(p_payload->'subject')is distinct from'string'or length(p_payload->>'subject')not between 1 and 200 or p_payload->>'subject'~'[\r\n]'or jsonb_typeof(p_payload->'html')is distinct from'string'or octet_length(p_payload->>'html')not between 1 and 524288 then return'{"state":"invalid_input"}';end if;
 if r.payload is not null and r.payload<>p_payload then return'{"state":"request_conflict"}';end if;
 perform set_config('p11.bi_schedule_scope',r.property_id::text,true);if r.payload is null then update public.bi_schedule_runs set payload=p_payload,payload_hash=public.knowledge_hash(p_payload)where id=r.id;end if;
 return jsonb_build_object('state','prepared','id',r.id,'deliveries',(select jsonb_agg(jsonb_build_object('id',id,'recipient',recipient)order by recipient)from public.bi_schedule_deliveries where run_id=r.id));
end$$;

create function public.start_bi_schedule_delivery(p_id uuid,p_claim_token uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare d public.bi_schedule_deliveries;r public.bi_schedule_runs;s public.bi_schedules;
begin
 select*into d from public.bi_schedule_deliveries where id=p_id;if not found then return'{"state":"not_found"}';end if;
 select*into r from public.bi_schedule_runs where id=d.run_id;select*into s from public.bi_schedules where id=r.schedule_id for update;select*into r from public.bi_schedule_runs where id=d.run_id for update;select*into d from public.bi_schedule_deliveries where id=p_id for update;
 if p_claim_token is null or d.state<>'pending'or d.closed or r.state<>'open'or r.payload is null or s.state<>'held'or s.hold_reason<>'run_in_progress'or s.revision<>r.schedule_revision+1 or r.created_at<clock_timestamp()-interval'15 minutes'then return'{"state":"not_started"}';end if;
 if not exists(select 1 from public.profiles a join public.properties p on p.org_id=a.org_id where a.id=r.authorized_by and a.role in('admin','manager')and p.id=r.property_id and p.org_id=r.org_id)then return'{"state":"forbidden"}';end if;
 perform set_config('p11.bi_schedule_scope',r.property_id::text,true);update public.bi_schedule_deliveries set state='in_flight',claim_token=p_claim_token,attempted_at=clock_timestamp(),updated_at=clock_timestamp()where id=d.id;
 perform public.bi_schedule_event(gen_random_uuid(),r.property_id,s.id,r.id,null,'bi.delivery.started',jsonb_build_object('deliveryId',d.id,'payloadHash',r.payload_hash,'recipientHash',public.knowledge_hash(to_jsonb(d.recipient))));
 return jsonb_build_object('state','started','id',d.id,'recipient',d.recipient,'payload',r.payload,'idempotencyKey','bi-report-'||d.id::text);
end$$;

create function public.finish_bi_schedule_delivery(p_id uuid,p_claim_token uuid,p_provider_id text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare d public.bi_schedule_deliveries;r public.bi_schedule_runs;s public.bi_schedules;outcome text;
begin
 select*into d from public.bi_schedule_deliveries where id=p_id;if not found then return'{"state":"not_found"}';end if;
 select*into r from public.bi_schedule_runs where id=d.run_id;select*into s from public.bi_schedules where id=r.schedule_id for update;select*into d from public.bi_schedule_deliveries where id=p_id for update;
 if d.claim_token is distinct from p_claim_token or p_claim_token is null then return'{"state":"claim_conflict"}';end if;
 if p_provider_id is not null and(p_provider_id!~'^[A-Za-z0-9_-]{1,200}$')then return'{"state":"invalid_input"}';end if;
 if d.provider_id is not null then if d.provider_id is distinct from p_provider_id then return'{"state":"request_conflict"}';end if;return jsonb_build_object('state','replayed','id',d.id,'status','accepted');end if;
 if d.state not in('in_flight','unknown')then return'{"state":"claim_conflict"}';end if;
 if d.state='unknown'and p_provider_id is null then return jsonb_build_object('state','replayed','id',d.id,'status','unknown');end if;
 outcome:=case when p_provider_id is null then'unknown'else'accepted'end;
 perform set_config('p11.bi_schedule_scope',r.property_id::text,true);update public.bi_schedule_deliveries set state=outcome,provider_id=p_provider_id,closed=true,updated_at=clock_timestamp()where id=d.id;
 perform public.bi_schedule_event(gen_random_uuid(),r.property_id,s.id,r.id,null,'bi.delivery.reported',jsonb_build_object('deliveryId',d.id,'status',outcome,'providerId',p_provider_id,'delivered',false));
 return jsonb_build_object('state','saved','id',d.id,'status',outcome);
end$$;

create function public.finish_bi_schedule_run(p_id uuid,p_issue text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.bi_schedule_runs;s public.bi_schedules;accepted boolean;
begin
 select*into r from public.bi_schedule_runs where id=p_id;if not found then return'{"state":"not_found"}';end if;select*into s from public.bi_schedules where id=r.schedule_id for update;select*into r from public.bi_schedule_runs where id=p_id for update;
 if r.state<>'open'then return jsonb_build_object('state','replayed','id',r.id,'status',r.state);end if;
 if p_issue is not null and p_issue not in('render_failed','preparation_failed','delivery_unconfirmed','recording_unconfirmed','interrupted')then return'{"state":"invalid_input"}';end if;
 select count(*)>0 and bool_and(state='accepted')into accepted from public.bi_schedule_deliveries where run_id=r.id;
 perform set_config('p11.bi_schedule_scope',r.property_id::text,true);
 update public.bi_schedule_runs set state=case when accepted then'accepted'else'held'end,issue=case when accepted then null else coalesce(p_issue,'delivery_unconfirmed')end,finished_at=clock_timestamp()where id=r.id;
 if s.state='held'and s.hold_reason='run_in_progress'and s.revision=r.schedule_revision+1 then
  update public.bi_schedules set state=case when accepted then'active'else'held'end,hold_reason=case when accepted then null else coalesce(p_issue,'delivery_unconfirmed')end,next_run_at=case when accepted then public.bi_schedule_next(config,clock_timestamp())else next_run_at end,last_accepted_at=case when accepted then clock_timestamp()else last_accepted_at end,revision=revision+1,updated_at=clock_timestamp()where id=s.id;
 end if;
 perform public.bi_schedule_event(gen_random_uuid(),r.property_id,s.id,r.id,null,'bi.schedule.finished',jsonb_build_object('status',case when accepted then'accepted'else'held'end,'delivered',false));return jsonb_build_object('state','saved','id',r.id,'status',case when accepted then'accepted'else'held'end);
end$$;

create function public.read_bi_schedules(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;v_role text;kind text:=coalesce(p_input->>'kind','list');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_id uuid:=(p_input->>'id')::uuid;v_hash text;v_count integer;v_items jsonb;v_extra jsonb:='{}';s public.bi_schedules;r public.bi_schedule_runs;c public.bi_schedule_commands;
begin
 select p.org_id,a.role into organization,v_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_offset<0 then return'{"state":"invalid_input"}';end if;
 if kind='command'then
  select*into c from public.bi_schedule_commands where id=v_id and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return c.result||jsonb_build_object('state','ready','actorId',p_actor_id);
 elsif kind='run'then
  select*into r from public.bi_schedule_runs where id=v_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'id',r.id,'run',to_jsonb(r)-'payload','deliveries',(select coalesce(jsonb_agg(to_jsonb(d)-'claim_token'order by d.recipient),'[]')from public.bi_schedule_deliveries d where run_id=r.id));
 elsif kind='list'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,revision)order by created_at,id),'[]'))into v_count,v_hash from public.bi_schedules where property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(bs)value,bs.created_at,bs.id from public.bi_schedules bs where bs.property_id=p_property_id and bs.org_id=organization order by bs.created_at desc,bs.id desc offset v_offset limit 20)q;
 elsif kind in('detail','events')then
  select*into s from public.bi_schedules where id=v_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;v_extra:=jsonb_build_object('schedule',to_jsonb(s));
  if kind='detail'then
   select count(*),public.knowledge_hash(coalesce(jsonb_agg(to_jsonb(x)order by created_at,id),'[]'))into v_count,v_hash from(select id,state,issue,created_at,finished_at from public.bi_schedule_runs where schedule_id=s.id)x;
   select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(br)-'source'-'payload'value,br.created_at,br.id from public.bi_schedule_runs br where br.schedule_id=s.id order by br.created_at desc,br.id desc offset v_offset limit 20)q;
  else
   select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at,id),'[]'))into v_count,v_hash from public.bi_schedule_events where schedule_id=s.id;
   select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(be)value,be.created_at,be.id from public.bi_schedule_events be where be.schedule_id=s.id order by be.created_at desc,be.id desc offset v_offset limit 20)q;
  end if;
 elsif kind='legacy'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(to_jsonb(x)order by created_at,id),'[]'))into v_count,v_hash from(select id,updated_at,created_at from public.scheduled_reports where org_id=organization and(property_id=p_property_id or property_id is null))x;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(bs)value,bs.created_at,bs.id from public.scheduled_reports bs where bs.org_id=organization and(bs.property_id=p_property_id or bs.property_id is null)order by bs.created_at desc,bs.id desc offset v_offset limit 20)q;
 elsif kind='legacy_detail'then
  if not exists(select 1 from public.scheduled_reports where id=v_id and org_id=organization and(property_id=p_property_id or property_id is null))then return'{"state":"not_found"}';end if;
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(to_jsonb(x)order by created_at,id),'[]'))into v_count,v_hash from(select id,status,updated_at,created_at from public.report_send_history where scheduled_report_id=v_id)x;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(h)value,h.created_at,h.id from public.report_send_history h where h.scheduled_report_id=v_id order by h.created_at desc,h.id desc offset v_offset limit 20)q;
 else return'{"state":"invalid_input"}';end if;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 return v_extra||jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canManage',v_role in('admin','manager'),'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset);
end$$;

create function public.preview_bi_schedule(p_actor_id uuid,p_property_id uuid,p_config jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
begin
 if not exists(select 1 from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id)then return'{"state":"forbidden"}';end if;
 if not coalesce(public.bi_schedule_config(p_config),false)then return'{"state":"invalid_input"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'filters',public.bi_schedule_filters(p_config,statement_timestamp()),'nextRunAt',public.bi_schedule_next(p_config,statement_timestamp()));
end$$;

create index bi_schedules_org on public.bi_schedules(org_id);
alter table public.bi_schedules enable row level security;
revoke all on public.bi_schedules from public,anon,authenticated;
grant all on public.bi_schedules to service_role;
create policy bi_schedules_service on public.bi_schedules for all to service_role using(true)with check(true);
create trigger bi_schedules_guard before insert or update or delete on public.bi_schedules for each row execute function public.guard_bi_schedule_records();
create index bi_schedule_commands_org on public.bi_schedule_commands(org_id);
alter table public.bi_schedule_commands enable row level security;
revoke all on public.bi_schedule_commands from public,anon,authenticated;
grant all on public.bi_schedule_commands to service_role;
create policy bi_schedule_commands_service on public.bi_schedule_commands for all to service_role using(true)with check(true);
create trigger bi_schedule_commands_guard before insert or update or delete on public.bi_schedule_commands for each row execute function public.guard_bi_schedule_records();
create index bi_schedule_runs_org on public.bi_schedule_runs(org_id);
alter table public.bi_schedule_runs enable row level security;
revoke all on public.bi_schedule_runs from public,anon,authenticated;
grant all on public.bi_schedule_runs to service_role;
create policy bi_schedule_runs_service on public.bi_schedule_runs for all to service_role using(true)with check(true);
create trigger bi_schedule_runs_guard before insert or update or delete on public.bi_schedule_runs for each row execute function public.guard_bi_schedule_records();
create index bi_schedule_deliveries_org on public.bi_schedule_deliveries(org_id);
alter table public.bi_schedule_deliveries enable row level security;
revoke all on public.bi_schedule_deliveries from public,anon,authenticated;
grant all on public.bi_schedule_deliveries to service_role;
create policy bi_schedule_deliveries_service on public.bi_schedule_deliveries for all to service_role using(true)with check(true);
create trigger bi_schedule_deliveries_guard before insert or update or delete on public.bi_schedule_deliveries for each row execute function public.guard_bi_schedule_records();
create index bi_schedule_events_org on public.bi_schedule_events(org_id);
alter table public.bi_schedule_events enable row level security;
revoke all on public.bi_schedule_events from public,anon,authenticated;
grant all on public.bi_schedule_events to service_role;
create policy bi_schedule_events_service on public.bi_schedule_events for all to service_role using(true)with check(true);
create trigger bi_schedule_events_guard before insert or update or delete on public.bi_schedule_events for each row execute function public.guard_bi_schedule_records();
revoke all on function public.bi_schedule_config(jsonb)from public,anon,authenticated;
grant execute on function public.bi_schedule_config(jsonb)to service_role;
revoke all on function public.bi_schedule_next(jsonb,timestamptz)from public,anon,authenticated;
grant execute on function public.bi_schedule_next(jsonb,timestamptz)to service_role;
revoke all on function public.bi_schedule_filters(jsonb,timestamptz)from public,anon,authenticated;
grant execute on function public.bi_schedule_filters(jsonb,timestamptz)to service_role;
revoke all on function public.guard_bi_schedule_records()from public,anon,authenticated;
grant execute on function public.guard_bi_schedule_records()to service_role;
revoke all on function public.bi_schedule_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)from public,anon,authenticated;
grant execute on function public.bi_schedule_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)to service_role;
revoke all on function public.decide_bi_schedule(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.decide_bi_schedule(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.claim_bi_schedule(uuid,uuid)from public,anon,authenticated;
grant execute on function public.claim_bi_schedule(uuid,uuid)to service_role;
revoke all on function public.prepare_bi_schedule_run(uuid,jsonb)from public,anon,authenticated;
grant execute on function public.prepare_bi_schedule_run(uuid,jsonb)to service_role;
revoke all on function public.start_bi_schedule_delivery(uuid,uuid)from public,anon,authenticated;
grant execute on function public.start_bi_schedule_delivery(uuid,uuid)to service_role;
revoke all on function public.finish_bi_schedule_delivery(uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.finish_bi_schedule_delivery(uuid,uuid,text)to service_role;
revoke all on function public.finish_bi_schedule_run(uuid,text)from public,anon,authenticated;
grant execute on function public.finish_bi_schedule_run(uuid,text)to service_role;
revoke all on function public.read_bi_schedules(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_bi_schedules(uuid,uuid,jsonb)to service_role;
revoke all on function public.preview_bi_schedule(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.preview_bi_schedule(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
