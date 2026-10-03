create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
-- Recorded import decisions reuse the existing leased, checkpointed importer.
alter table public.import_jobs add column control_version integer,add column requested_actor_id uuid references public.profiles(id),add column requested_org_id uuid references public.organizations(id),add column request_input jsonb,add column reference_at timestamptz,add column retry_of uuid references public.import_jobs(id),add column revision integer not null default 1;
create index import_jobs_requested_actor on public.import_jobs(requested_actor_id);
create index import_jobs_requested_org on public.import_jobs(requested_org_id);
create index import_jobs_retry on public.import_jobs(retry_of);
create index import_jobs_property_history on public.import_jobs(property_id,created_at desc,id desc);
create table public.pipeline_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),job_id uuid references public.import_jobs(id)on delete cascade,input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create table public.pipeline_events(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),job_id uuid references public.import_jobs(id)on delete cascade,actor_id uuid references public.profiles(id),action text not null,before_state jsonb,after_state jsonb,created_at timestamptz not null default clock_timestamp());
create index pipeline_commands_property on public.pipeline_commands(property_id,created_at desc,id desc);
create index pipeline_commands_org on public.pipeline_commands(org_id);
create index pipeline_commands_actor on public.pipeline_commands(actor_id);
create index pipeline_commands_job on public.pipeline_commands(job_id);
create index pipeline_events_property on public.pipeline_events(property_id,created_at desc,id desc);
create index pipeline_events_org on public.pipeline_events(org_id);
create index pipeline_events_actor on public.pipeline_events(actor_id);
create index pipeline_events_job on public.pipeline_events(job_id,created_at desc,id desc);
alter table public.pipeline_commands enable row level security;alter table public.pipeline_events enable row level security;
revoke all on public.pipeline_commands,public.pipeline_events from public,anon,authenticated;
grant all on public.pipeline_commands,public.pipeline_events to service_role;
create policy pipeline_commands_service on public.pipeline_commands for all to service_role using(true)with check(true);
create policy pipeline_events_service on public.pipeline_events for all to service_role using(true)with check(true);
create function public.pipeline_job_view(p_job jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$
 select p_job-array['lease_token','request_input'];
$$;
create function public.pipeline_accounts_view(p_accounts jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$
 select coalesce(jsonb_agg((a-'records')||jsonb_build_object('reportRows',case when jsonb_typeof(a->'records')='array'then jsonb_array_length(a->'records')else null end,'reportHash',case when jsonb_typeof(a->'records')='array'then public.knowledge_hash(a->'records')else null end)order by a->>'connection_id'),'[]')from jsonb_array_elements(coalesce(p_accounts,'[]'))a;
$$;
create function public.guard_pipeline_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Import history follows property retention';end if;
 if tg_op='UPDATE'then raise exception 'Import decisions and events are immutable';end if;
 if current_setting('p11.pipeline_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded import operation';end if;return new;
end$$;
create trigger pipeline_commands_guard before insert or update or delete on public.pipeline_commands for each row execute function public.guard_pipeline_history();
create trigger pipeline_events_guard before insert or update or delete on public.pipeline_events for each row execute function public.guard_pipeline_history();
create function public.pipeline_event(p_id uuid,p_property_id uuid,p_job_id uuid,p_actor_id uuid,p_action text,p_before jsonb,p_after jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare organization uuid;r jsonb;
begin
 select org_id into organization from public.properties where id=p_property_id;if not found then raise exception 'Property unavailable';end if;
 perform set_config('p11.pipeline_scope',p_property_id::text,true);
 insert into public.pipeline_events(id,property_id,org_id,job_id,actor_id,action,before_state,after_state)values(p_id,p_property_id,organization,p_job_id,p_actor_id,p_action,p_before,p_after);
 if p_actor_id is not null then
  r:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'pipelines',p_action,'server_confirmed','succeeded',jsonb_build_object('jobId',p_job_id),null,null,jsonb_build_object('eventId',p_id),'{}');if r->>'state'not in('recorded','replayed')then raise exception 'Import action unavailable';end if;
 else
  if p_action not in('pipeline.import.queued','pipeline.import.started','pipeline.import.progress','pipeline.import.report_saved','pipeline.import.account_progress','pipeline.import.finished')then raise exception 'Unknown importer event';end if;
  insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(p_id,organization,p_property_id,'pipelines.import_worker','workflow');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(p_id,p_id,organization,p_property_id,'pipelines.import_worker','pipelines',p_action,'server_confirmed','succeeded',jsonb_build_object('jobId',p_job_id),jsonb_build_object('eventId',p_id));
 end if;
end$$;
create function public.guard_pipeline_job()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='INSERT'then
  if current_user not in('postgres','service_role')then raise exception 'Use a recorded import request';end if;
  if new.recovery_version=1 then
   new.control_version:=1;new.reference_at:=coalesce(new.reference_at,new.created_at,clock_timestamp());
   select org_id into new.requested_org_id from public.properties where id=new.property_id;
   if new.requested_actor_id is not null and current_setting('p11.pipeline_decision',true)is distinct from new.property_id::text then raise exception 'Use a recorded import request';end if;
  end if;return new;
 end if;
 if old.control_version=1 then
  if current_setting('p11.pipeline_decision',true)is distinct from old.property_id::text and current_setting('p11.pipeline_worker',true)is distinct from old.id::text then raise exception 'Use a recorded decision or owned importer lease';end if;
  if(new.id,new.property_id,new.channels,new.date_range,new.connection_ids,new.requested_actor_id,new.requested_org_id,new.request_input,new.reference_at,new.retry_of,new.control_version,new.recovery_version)is distinct from(old.id,old.property_id,old.channels,old.date_range,old.connection_ids,old.requested_actor_id,old.requested_org_id,old.request_input,old.reference_at,old.retry_of,old.control_version,old.recovery_version)then raise exception 'Import source and request are immutable';end if;
  if old.status in('complete','partial','failed','cancelled')and new is distinct from old then raise exception 'Completed import is immutable; request a linked retry';end if;
 end if;
 if(new.status,new.records_imported,new.current_step,new.error_message,new.attempts,new.campaigns_found)is distinct from(old.status,old.records_imported,old.current_step,old.error_message,old.attempts,old.campaigns_found)then new.revision:=old.revision+1;else new.revision:=old.revision;end if;return new;
end$$;
create trigger pipeline_job_guard before insert or update on public.import_jobs for each row execute function public.guard_pipeline_job();
create function public.record_pipeline_worker()returns trigger language plpgsql security invoker set search_path=''as $$
declare j public.import_jobs;v_before jsonb;v_after jsonb;v_action text;
begin
 if tg_table_name='import_jobs'then
  j:=new;if j.control_version is distinct from 1 then return new;end if;
  if tg_op='INSERT'then
   -- Freeze account identity at acceptance, before a worker can select a newer account.
   insert into public.marketing_import_checkpoints(job_id,accounts)select new.id,coalesce(jsonb_agg(jsonb_build_object('connection_id',id,'platform',platform,'account_id',account_id,'records',null,'offset',0,'done',false,'error',null)order by id),'[]')from public.ad_account_connections where property_id=new.property_id and is_active and platform=any(new.channels)and(new.connection_ids is null or id=any(new.connection_ids));
   v_action:='pipeline.import.queued';
  else
   if new.revision=old.revision then return new;end if;v_before:=public.pipeline_job_view(to_jsonb(old));v_action:=case when new.status in('complete','partial','failed','cancelled')then'pipeline.import.finished'when new.attempts>old.attempts then'pipeline.import.started'else'pipeline.import.progress'end;
  end if;
  if current_setting('p11.pipeline_decision',true)=new.property_id::text then return new;end if;
  v_after:=public.pipeline_job_view(to_jsonb(new));
 else
  select*into j from public.import_jobs where id=new.job_id;if not found or j.control_version is distinct from 1 then return new;end if;
  if new.accounts=old.accounts then return new;end if;
  v_before:=public.pipeline_accounts_view(old.accounts);v_after:=public.pipeline_accounts_view(new.accounts);
  v_action:=case when exists(select 1 from jsonb_array_elements(new.accounts)n join jsonb_array_elements(old.accounts)o on n->>'connection_id'=o->>'connection_id'where n->'records'is distinct from o->'records')then'pipeline.import.report_saved'else'pipeline.import.account_progress'end;
 end if;
 perform public.pipeline_event(gen_random_uuid(),j.property_id,j.id,null,v_action,v_before,v_after);return new;
end$$;
create trigger pipeline_job_record after insert or update on public.import_jobs for each row execute function public.record_pipeline_worker();
create trigger pipeline_checkpoint_record after update on public.marketing_import_checkpoints for each row execute function public.record_pipeline_worker();
create function public.decide_pipeline(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;c public.pipeline_commands;j public.import_jobs;v_job uuid;v_before jsonb;v_after jsonb;v_result jsonb;v_action text;kind text:=p_input->>'operation';ids uuid[];channels text[];reference_time timestamptz:=clock_timestamp();v_retry uuid;v_range text;accounts jsonb;
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found or member_role is null or member_role not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,960));select*into c from public.pipeline_commands where id=p_id;
 if found then
  if(c.property_id,c.org_id,c.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if kind='cancel_request'or c.input->>'operation'='cancel_request'then return c.result||'{"state":"replayed"}';end if;
  if c.input<>p_input then return'{"state":"request_conflict"}';end if;return c.result||'{"state":"replayed"}';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,817));
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='pipeline.import.request_cancelled';v_result:='{"status":"cancelled_request"}';
 else
  if kind not in('start','retry','stop','review')or kind is null then return'{"state":"invalid_input"}';end if;
  if kind='start'then
   if p_input-array['operation','connectionIds','dateRange','connectionsHash']<>'{}'or jsonb_typeof(p_input->'connectionIds')is distinct from'array'or jsonb_array_length(p_input->'connectionIds')not between 1 and 100 or coalesce(p_input->>'dateRange','')not in('TODAY','YESTERDAY','LAST_7_DAYS','LAST_14_DAYS','LAST_30_DAYS','THIS_MONTH','LAST_MONTH')then return'{"state":"invalid_input"}';end if;
   begin select array_agg(value::uuid order by value)into ids from jsonb_array_elements_text(p_input->'connectionIds');exception when others then return'{"state":"invalid_input"}';end;
   if cardinality(ids)<>(select count(distinct x)from unnest(ids)x)then return'{"state":"invalid_input"}';end if;v_range:=p_input->>'dateRange';
   perform 1 from public.ad_account_connections where property_id=p_property_id for share;
   if coalesce(p_input->>'connectionsHash','')is distinct from public.knowledge_hash(coalesce((select jsonb_agg(jsonb_build_array(ac.id,ac.platform,ac.account_id,ac.is_active,ac.account_name)order by ac.id)from public.ad_account_connections ac where ac.property_id=p_property_id),'[]'))then return'{"state":"accounts_changed"}';end if;
  else
   if p_input-array['operation','jobId','revision','note']<>'{}'or coalesce(p_input->>'revision','')!~'^[0-9]{1,9}$'or jsonb_typeof(p_input->'note')is distinct from'string'or length(p_input->>'note')>2000 then return'{"state":"invalid_input"}';end if;
   begin v_job:=(p_input->>'jobId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
   select*into j from public.import_jobs where id=v_job and property_id=p_property_id and(requested_org_id is null or requested_org_id=organization)for update;if not found then return'{"state":"not_found"}';end if;
   if j.revision<>(p_input->>'revision')::integer then return'{"state":"job_changed"}';end if;
   v_before:=public.pipeline_job_view(to_jsonb(j));
   if kind='retry'then
    if j.control_version is distinct from 1 or j.status not in('failed','partial','cancelled')then return'{"state":"retry_unavailable"}';end if;
    ids:=j.connection_ids;if ids is null then select array_agg((a->>'connection_id')::uuid order by a->>'connection_id')into ids from public.marketing_import_checkpoints cp,jsonb_array_elements(cp.accounts)a where cp.job_id=j.id;end if;
    reference_time:=j.reference_at;v_retry:=j.id;v_range:=j.date_range;
   elsif kind='stop'then
    if j.recovery_version is distinct from 1 or j.status not in('pending','running')then return'{"state":"stop_unavailable"}';end if;
   end if;
  end if;
  if kind in('start','retry')then
   if exists(select 1 from public.import_jobs where property_id=p_property_id and status in('pending','running'))then return'{"state":"open_import"}';end if;
   if ids is null or cardinality(ids)=0 or exists(select 1 from unnest(ids)x where not exists(select 1 from public.ad_account_connections a where a.id=x and a.property_id=p_property_id and a.is_active and a.platform in('google_ads','meta_ads')))then return'{"state":"accounts_changed"}';end if;
   -- A retry cannot silently bind a renamed/replaced source connection.
   if v_retry is not null and exists(select 1 from public.marketing_import_checkpoints cp,jsonb_array_elements(cp.accounts)a where cp.job_id=v_retry and not exists(select 1 from public.ad_account_connections ac where ac.id=(a->>'connection_id')::uuid and ac.property_id=p_property_id and ac.is_active and ac.account_id=a->>'account_id'and ac.platform=a->>'platform'))then return'{"state":"accounts_changed"}';end if;
   select array_agg(distinct platform order by platform)into channels from public.ad_account_connections where id=any(ids);
   perform set_config('p11.pipeline_decision',p_property_id::text,true);
   insert into public.import_jobs(id,property_id,channels,connection_ids,date_range,status,recovery_version,progress_pct,current_step,requested_actor_id,request_input,reference_at,retry_of)values(p_id,p_property_id,channels,ids,v_range,'pending',1,0,'Queued; waiting for the import worker',p_actor_id,p_input,reference_time,v_retry)returning*into j;
   v_job:=j.id;v_after:=public.pipeline_job_view(to_jsonb(j));v_action:=case when kind='start'then'pipeline.import.requested'else'pipeline.import.retry_requested'end;v_result:=jsonb_build_object('status','pending','revision',j.revision);
  elsif kind='stop'then
   perform set_config('p11.pipeline_decision',p_property_id::text,true);
   update public.import_jobs set status='cancelled',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null,current_step='Stopped; confirmed saved records are retained'where id=j.id returning*into j;
   v_after:=public.pipeline_job_view(to_jsonb(j));v_action:='pipeline.import.stopped';v_result:=jsonb_build_object('status','cancelled','revision',j.revision,'recordsImported',j.records_imported);
  else
   select public.pipeline_accounts_view(cp.accounts)into accounts from public.marketing_import_checkpoints cp where cp.job_id=j.id;
   v_after:=jsonb_build_object('job',v_before,'accounts',coalesce(accounts,'[]'),'checkpointAvailable',accounts is not null,'note',p_input->>'note','reviewedAt',clock_timestamp());v_action:='pipeline.import.progress_reviewed';v_result:=jsonb_build_object('status','reviewed','revision',j.revision);
  end if;
 end if;
 v_result:=v_result||jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id,'jobId',v_job);
 perform set_config('p11.pipeline_scope',p_property_id::text,true);
 insert into public.pipeline_commands(id,property_id,org_id,actor_id,job_id,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,v_job,p_input,v_before,v_after,v_result);
 perform public.pipeline_event(p_id,p_property_id,v_job,p_actor_id,v_action,v_before,v_after);
 return v_result;
end$$;
create function public.read_pipelines(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;member_role text;kind text:=coalesce(p_input->>'kind','list');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_job uuid;v_items jsonb;v_count integer;v_hash text;connections jsonb;j public.import_jobs;c public.pipeline_commands;accounts jsonb;v_hold text;
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_offset<0 then return'{"state":"invalid_input"}';end if;
 if kind='command'then
  select*into c from public.pipeline_commands where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return c.result||'{"state":"ready"}';
 elsif kind='list'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,revision)order by created_at desc,id desc),'[]'))into v_count,v_hash from public.import_jobs where property_id=p_property_id and(requested_org_id is null or requested_org_id=organization);
  select coalesce(jsonb_agg(public.pipeline_job_view(to_jsonb(row))order by row.created_at desc,row.id desc),'[]')into v_items from(select*from public.import_jobs where property_id=p_property_id and(requested_org_id is null or requested_org_id=organization)order by created_at desc,id desc offset v_offset limit 20)row;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'platform',platform,'accountId',account_id,'name',account_name,'active',is_active,'lastSyncedAt',last_synced_at,'lastError',last_error)order by platform,account_name,id),'[]')into connections from public.ad_account_connections where property_id=p_property_id;
 elsif kind='job'or kind='history'then
  v_job:=(p_input->>'id')::uuid;select*into j from public.import_jobs where id=v_job and property_id=p_property_id and(requested_org_id is null or requested_org_id=organization);if not found then return'{"state":"not_found"}';end if;
  if kind='job'then
   select public.pipeline_accounts_view(cp.accounts)into accounts from public.marketing_import_checkpoints cp where cp.job_id=j.id;
   if j.status in('pending','running')and j.control_version=1 then
    if j.requested_actor_id is not null and not exists(select 1 from public.profiles member where member.id=j.requested_actor_id and member.org_id=organization and member.role in('admin','manager'))then v_hold:='The requester no longer has import permission. Stop this job before creating a new authorized request.';
    elsif exists(select 1 from public.marketing_import_checkpoints cp,jsonb_array_elements(cp.accounts)a where cp.job_id=j.id and not exists(select 1 from public.ad_account_connections ac where ac.id=(a->>'connection_id')::uuid and ac.property_id=p_property_id and ac.is_active and ac.platform=a->>'platform'and ac.account_id=a->>'account_id'))then v_hold:='A source connection changed or is inactive. Stop this job and review the current accounts before requesting another import.';end if;
   end if;
   return jsonb_build_object('workerHold',v_hold,'state','ready','propertyId',p_property_id,'job',public.pipeline_job_view(to_jsonb(j)),'accounts',coalesce(accounts,'[]'),'checkpointAvailable',accounts is not null,'canManage',coalesce(member_role in('admin','manager'),false));
  end if;
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at desc,id desc),'[]'))into v_count,v_hash from public.pipeline_events where property_id=p_property_id and org_id=organization and job_id=v_job;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(evt)||jsonb_build_object('actorName',case when evt.actor_id is null then'Import worker'else coalesce(member.full_name,'Team member')end,'note',cmd.input->>'note')value,evt.created_at,evt.id from public.pipeline_events evt left join public.profiles member on member.id=evt.actor_id left join public.pipeline_commands cmd on cmd.id=evt.id where evt.property_id=p_property_id and evt.org_id=organization and evt.job_id=v_job order by evt.created_at desc,evt.id desc offset v_offset limit 20)x;
 else return'{"state":"invalid_input"}';end if;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset,'connections',connections,'connectionsHash',public.knowledge_hash(coalesce((select jsonb_agg(jsonb_build_array(ac.id,ac.platform,ac.account_id,ac.is_active,ac.account_name)order by ac.id)from public.ad_account_connections ac where ac.property_id=p_property_id),'[]')),'canManage',coalesce(member_role in('admin','manager'),false));
end$$;

create or replace function public.claim_marketing_import(p_job_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.import_jobs; plan jsonb;
begin
  if p_token is null then raise exception 'Worker token required'; end if;
  select * into j from public.import_jobs where id=p_job_id;
  if not found then return null;end if;
  perform pg_advisory_xact_lock(hashtextextended(j.property_id::text,817));
  select * into j from public.import_jobs where id=p_job_id for update;
  if not found or j.recovery_version is distinct from 1 or j.status not in ('pending','running') then return null; end if;
  if j.control_version=1 and not exists(select 1 from public.properties p where p.id=j.property_id and p.org_id=j.requested_org_id and(j.requested_actor_id is null or exists(select 1 from public.profiles a where a.id=j.requested_actor_id and a.org_id=p.org_id and a.role in('admin','manager'))))then return null;end if;
  if j.status='running' and (j.lease_expires_at is null or j.lease_expires_at>clock_timestamp()) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(j.property_id::text, 817));
  if exists(select 1 from public.import_jobs where property_id=j.property_id and id<>j.id and status='running') then return null; end if;
  if j.control_version=1 and exists(select 1 from public.marketing_import_checkpoints cp,jsonb_array_elements(cp.accounts)a where cp.job_id=j.id and not exists(select 1 from public.ad_account_connections ac where ac.id=(a->>'connection_id')::uuid and ac.property_id=j.property_id and ac.is_active and ac.platform=a->>'platform'and ac.account_id=a->>'account_id'))then return null;end if;
  perform set_config('p11.pipeline_worker',j.id::text,true);
  if j.attempts>=5 then
    update public.import_jobs set status=case when records_imported>0 then 'partial' else 'failed' end,
      completed_at=clock_timestamp(),current_step='Import requires review',lease_token=null,lease_expires_at=null,
      error_message='Import stopped after repeated worker interruptions. Review stored data before starting another import.' where id=j.id;
    return null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('connection_id',id,'platform',platform,'account_id',account_id,'records',null,'offset',0,'done',false,'error',null) order by id),'[]'::jsonb)
    into plan from public.ad_account_connections where property_id=j.property_id and is_active and platform=any(j.channels) and (j.connection_ids is null or id=any(j.connection_ids));
  insert into public.marketing_import_checkpoints(job_id,accounts) values(j.id,plan) on conflict(job_id) do nothing;
  update public.import_jobs set status='running',started_at=coalesce(started_at,clock_timestamp()),
    lease_token=p_token,lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1,
    current_step=case when attempts>0 then 'Resuming saved import' else 'Preparing account reports' end
    where id=j.id returning * into j;
  select accounts into plan from public.marketing_import_checkpoints where job_id=j.id;
  return jsonb_build_object('job',to_jsonb(j),'accounts',plan);
end;
$$;
create or replace function public.assert_marketing_import_lease(p_job_id uuid,p_token uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.import_jobs where id=p_job_id and status='running' and recovery_version=1
    and (control_version is distinct from 1 or exists(select 1 from public.properties p where p.id=import_jobs.property_id and p.org_id=import_jobs.requested_org_id and(import_jobs.requested_actor_id is null or exists(select 1 from public.profiles a where a.id=import_jobs.requested_actor_id and a.org_id=p.org_id and a.role in('admin','manager')))))
    and lease_token=p_token and lease_expires_at>clock_timestamp() for update;
  if not found then raise exception 'Import worker no longer owns this job' using errcode='55000'; end if;
  perform set_config('p11.pipeline_worker',p_job_id::text,true);
end;
$$;
revoke all on function public.pipeline_job_view(jsonb)from public,anon,authenticated;
grant execute on function public.pipeline_job_view(jsonb)to service_role;
revoke all on function public.pipeline_accounts_view(jsonb)from public,anon,authenticated;
grant execute on function public.pipeline_accounts_view(jsonb)to service_role;
revoke all on function public.guard_pipeline_history()from public,anon,authenticated;
grant execute on function public.guard_pipeline_history()to service_role;
revoke all on function public.pipeline_event(uuid,uuid,uuid,uuid,text,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.pipeline_event(uuid,uuid,uuid,uuid,text,jsonb,jsonb)to service_role;
revoke all on function public.guard_pipeline_job()from public,anon,authenticated;
grant execute on function public.guard_pipeline_job()to service_role;
revoke all on function public.record_pipeline_worker()from public,anon,authenticated;
grant execute on function public.record_pipeline_worker()to service_role;
revoke all on function public.decide_pipeline(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.decide_pipeline(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_pipelines(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_pipelines(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
