create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
-- A scalar JSON snapshot avoids the REST row cap and fixes a single read boundary.
create function public.read_reviewflow_insight_source(p_property_id uuid,p_actor_id uuid,p_days integer,p_as_of timestamptz) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare source_data jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if p_days is null or p_days not between 7 and 365 or p_as_of is null or p_as_of>now()+interval '1 minute' then raise exception 'Choose a valid insight window';end if;
 with selected as materialized(
  select r.id,r.source_version,r.rating,r.review_text,r.review_date,r.created_at,r.platform from public.reviews r where r.property_id=p_property_id and r.created_at<=p_as_of and coalesce(r.review_date,r.created_at) between p_as_of-make_interval(days=>p_days) and p_as_of
 ),current_analysis as materialized(
  select a.* from selected r cross join lateral(select a.* from public.review_analyses a where a.review_id=r.id and a.property_id=p_property_id and a.source_version=r.source_version and a.status in('completed','manual_review_required') order by a.analysis_version desc,a.id desc limit 1) a
 ),open_cases as materialized(
  select c.id,c.review_id,c.version,c.status,c.priority,c.issue_domains,c.reopened_count,c.created_at,c.resolved_at from public.reputation_cases c where c.property_id=p_property_id and c.status not in('resolved','dismissed')
 ) select jsonb_build_object('asOf',p_as_of,'windowDays',p_days,
  'reviews',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'source_version',r.source_version,'rating',r.rating,'review_text',r.review_text,'review_date',r.review_date,'created_at',r.created_at,'platform',r.platform,'sentiment',case when a.status='completed' then a.sentiment end,'is_urgent',case when a.status='completed' then a.is_urgent else false end) order by r.id) from selected r left join current_analysis a on a.review_id=r.id),'[]'),
  'analyses',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'review_id',a.review_id,'source_version',a.source_version,'analysis_version',a.analysis_version,'issue_domains',a.issue_domains,'severity',a.severity,'journey_stage',a.journey_stage) order by a.review_id) from current_analysis a where a.status='completed'),'[]'),
  'cases',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from open_cases c),'[]'),
  'coverage',jsonb_build_object('dateFallbackReviews',(select count(*) from selected where review_date is null),'staffReviewAnalyses',(select count(*) from current_analysis where status='manual_review_required'),'openPropertyCases',(select count(*) from open_cases),'storedPropertyReviews',(select count(*) from public.reviews where property_id=p_property_id))) into source_data;
 return jsonb_build_object('state','ready','source',source_data,'sourceHash',public.crm_configuration_hash(source_data));
end$$;

create table public.reviewflow_insight_reports(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 input jsonb not null,source_snapshot jsonb not null,source_hash text not null,result jsonb not null,result_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index reviewflow_insight_history on public.reviewflow_insight_reports(property_id,created_at desc,id desc);
create index reviewflow_insight_org on public.reviewflow_insight_reports(org_id);
create index reviewflow_insight_actor on public.reviewflow_insight_reports(actor_id);
alter table public.reviewflow_insight_reports enable row level security;
revoke all on public.reviewflow_insight_reports from public,anon,authenticated;
grant all on public.reviewflow_insight_reports to service_role;
create policy reviewflow_insight_service on public.reviewflow_insight_reports for all to service_role using(true) with check(true);
create function public.guard_reviewflow_insight_report() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;raise exception 'Saved insight evidence is immutable';
end$$;
create trigger reviewflow_insight_report_guard before update or delete on public.reviewflow_insight_reports for each row execute function public.guard_reviewflow_insight_report();

create function public.save_reviewflow_insight_report(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare decision jsonb;source_result jsonb;source_data jsonb;organization uuid;begin
 decision:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,'insights.saved',p_input);if decision->>'state'<>'new' then return decision;end if;
 if(p_input-'windowDays'-'asOf'-'sourceHash'-'reason')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 or coalesce(p_input->>'sourceHash','')!~'^[a-f0-9]{64}$' then raise exception 'Review the exact report source and reason';end if;
 source_result:=public.read_reviewflow_insight_source(p_property_id,p_actor_id,(p_input->>'windowDays')::integer,(p_input->>'asOf')::timestamptz);
 if source_result->>'state'<>'ready' then return source_result;end if;
 if source_result->>'sourceHash' is distinct from p_input->>'sourceHash' then return '{"state":"stale_source"}';end if;source_data:=source_result->'source';
 if jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>262144 or p_result->>'insightsVersion' is distinct from 'reviewflow-insights-v2' or(p_result->>'windowDays')::integer is distinct from(source_data->>'windowDays')::integer or(p_result->>'totalReviews')::integer is distinct from jsonb_array_length(source_data->'reviews') or(p_result->>'classifiedReviews')::integer is distinct from jsonb_array_length(source_data->'analyses') then raise exception 'The report must match its reviewed source';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.reviewflow_insight_reports(id,property_id,org_id,actor_id,input,source_snapshot,source_hash,result,result_hash) values(p_id,p_property_id,organization,p_actor_id,p_input,source_data,p_input->>'sourceHash',p_result,public.crm_configuration_hash(p_result));
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,'insights.saved',p_input,null,jsonb_build_object('reportId',p_id,'sourceHash',p_input->>'sourceHash','windowDays',p_input->'windowDays'),jsonb_build_object('reportId',p_id,'totalReviews',p_result->'totalReviews','classifiedReviews',p_result->'classifiedReviews','insightsVersion',p_result->>'insightsVersion','interventionStarted',false),'{}');
end$$;

-- Literal full-property search; invoker rights retain the reviews table's tenant RLS.
create function public.search_reviewflow_reviews(p_property_id uuid,p_query text) returns setof public.reviews language plpgsql stable security invoker set search_path='' as $$begin
 if p_property_id is null or length(coalesce(p_query,'')) not between 1 and 200 then raise exception 'Choose a property and search text of 1–200 characters';end if;
 return query select r.* from public.reviews r where r.property_id=p_property_id and(strpos(lower(coalesce(r.review_text,'')),lower(p_query))>0 or strpos(lower(coalesce(r.reviewer_name,'')),lower(p_query))>0);
end$$;

revoke all on function public.read_reviewflow_insight_source(uuid,uuid,integer,timestamptz),public.guard_reviewflow_insight_report(),public.save_reviewflow_insight_report(uuid,uuid,uuid,jsonb,jsonb),public.search_reviewflow_reviews(uuid,text) from public,anon,authenticated;
grant execute on function public.read_reviewflow_insight_source(uuid,uuid,integer,timestamptz),public.guard_reviewflow_insight_report(),public.save_reviewflow_insight_report(uuid,uuid,uuid,jsonb,jsonb),public.search_reviewflow_reviews(uuid,text) to service_role;
notify pgrst,'reload schema';

grant execute on function public.search_reviewflow_reviews(uuid,text) to authenticated;
