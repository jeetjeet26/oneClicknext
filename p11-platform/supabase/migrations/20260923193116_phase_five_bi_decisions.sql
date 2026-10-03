create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

-- Goals retain current compatibility rows and immutable native decisions.
alter table public.metric_goals drop constraint metric_goals_goal_type_check;
alter table public.metric_goals add constraint metric_goals_goal_type_check check(goal_type in('daily','weekly','monthly','quarterly','yearly'));
alter table public.metric_goals add column revision integer not null default 0;
revoke insert,update,delete on public.metric_goals from public,anon,authenticated;
create table public.bi_control_commands(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 operation text not null,input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index bi_control_commands_property on public.bi_control_commands(property_id,created_at desc,id desc);
create index bi_control_commands_org on public.bi_control_commands(org_id);
create index bi_control_commands_actor on public.bi_control_commands(actor_id);
alter table public.bi_control_commands enable row level security;
revoke all on public.bi_control_commands from public,anon,authenticated;
grant all on public.bi_control_commands to service_role;
create policy bi_control_commands_service on public.bi_control_commands for all to service_role using(true)with check(true);
create function public.guard_bi_control()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'BI history follows property retention';end if;
 if current_setting('p11.bi_control_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded BI decision';end if;
 if tg_op='UPDATE'then
  if tg_table_name='bi_control_commands'then raise exception 'BI decisions are immutable';end if;
  if(new.id,new.property_id)is distinct from(old.id,old.property_id)then raise exception 'BI scope is immutable';end if;
 end if;return new;
end$$;
create trigger bi_control_guard before insert or update or delete on public.bi_control_commands for each row execute function public.guard_bi_control();
create trigger bi_goal_control_guard before insert or update or delete on public.metric_goals for each row execute function public.guard_bi_control();

create function public.decide_bi_goal(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;c public.bi_control_commands;g public.metric_goals;v_before jsonb;v_after jsonb;v_result jsonb;v_action text;kind text:=p_input->>'operation';v_target numeric;v_threshold numeric;v_metric text;v_period text;v_id uuid;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id and a.role in('admin','manager');if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,954));select*into c from public.bi_control_commands where id=p_id;
 if found then
  if(c.property_id,c.org_id,c.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if kind='cancel_request'or c.operation='cancel_request'then return c.result||'{"state":"replayed"}';end if;
  if c.input<>p_input then return'{"state":"request_conflict"}';end if;return c.result||'{"state":"replayed"}';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,955));perform set_config('p11.bi_control_scope',p_property_id::text,true);
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='bi.goal.request_cancelled';v_result:='{"status":"cancelled_request"}';
 else
  if kind is null or kind not in('save','archive','restore')or p_input-array['operation','goalId','expectedRevision','metric','period','target','direction','threshold']<>'{}'then return'{"state":"invalid_input"}';end if;
  begin v_id:=(p_input->>'goalId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
  if v_id is null or coalesce(p_input->>'expectedRevision','')!~'^[0-9]{1,9}$'then return'{"state":"invalid_input"}';end if;
  select*into g from public.metric_goals where id=v_id;
  if found then
   if g.property_id<>p_property_id then return'{"state":"not_found"}';end if;
   if g.revision<>(p_input->>'expectedRevision')::integer then return'{"state":"goal_changed"}';end if;v_before:=to_jsonb(g);
  elsif kind<>'save'or(p_input->>'expectedRevision')::integer<>0 then return'{"state":"not_found"}';end if;
  if kind='save'then
   v_metric:=p_input->>'metric';v_period:=p_input->>'period';
   if v_metric is null or v_metric not in('spend','impressions','clicks','conversions','ctr','cpa')or v_period is null or v_period not in('daily','weekly','monthly','quarterly','yearly')or p_input->>'direction'is null or p_input->>'direction'not in('at_least','at_most')or jsonb_typeof(p_input->'target')is distinct from'number'or jsonb_typeof(p_input->'threshold')is distinct from'number'then return'{"state":"invalid_input"}';end if;
   v_target:=(p_input->>'target')::numeric;v_threshold:=(p_input->>'threshold')::numeric;
   if v_target<=0 or v_target>1000000000000 or v_threshold<1 or v_threshold>100 or v_threshold<>trunc(v_threshold)or(v_metric='ctr'and v_target>100)or(v_metric in('clicks','impressions')and v_target<>trunc(v_target))then return'{"state":"invalid_input"}';end if;
   if g.id is not null and(g.metric_key,g.goal_type)is distinct from(v_metric,v_period)then return'{"state":"goal_changed"}';end if;
   if exists(select 1 from public.metric_goals where property_id=p_property_id and metric_key=v_metric and goal_type=v_period and id<>v_id)then return'{"state":"duplicate_goal"}';end if;
   if g.id is null then insert into public.metric_goals(id,property_id,metric_key,goal_type,target_value,is_inverse,alert_threshold_percent,is_active,created_by,revision)values(v_id,p_property_id,v_metric,v_period,v_target,p_input->>'direction'='at_most',v_threshold,true,p_actor_id,1)returning*into g;
   else if not g.is_active then return'{"state":"archived_goal"}';end if;update public.metric_goals set target_value=v_target,is_inverse=p_input->>'direction'='at_most',alert_threshold_percent=v_threshold,revision=revision+1 where id=g.id returning*into g;end if;
   v_action:='bi.goal.saved';
  else
   if p_input-array['operation','goalId','expectedRevision']<>'{}'then return'{"state":"invalid_input"}';end if;
   if g.is_active=(kind='restore')then return'{"state":"goal_changed"}';end if;
   update public.metric_goals set is_active=kind='restore',revision=revision+1 where id=g.id returning*into g;v_action:=case when kind='restore'then'bi.goal.restored'else'bi.goal.archived'end;
  end if;
  v_after:=to_jsonb(g);v_result:=jsonb_build_object('goalId',g.id,'status',case when g.is_active then'active'else'archived'end,'revision',g.revision);
 end if;
 v_result:=v_result||jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id);
 insert into public.bi_control_commands(id,property_id,org_id,actor_id,operation,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,kind,p_input,v_before,v_after,v_result);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi',v_action,'server_confirmed','succeeded',jsonb_build_object('goalId',g.id),v_before,v_after,v_result-'state'-'propertyId'-'id','{}')->>'state'not in('recorded','replayed')then raise exception 'Goal evidence unavailable';end if;
 return v_result;
end$$;

create function public.read_bi_goals(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;v_role text;v_kind text:=coalesce(p_input->>'kind','goals');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_hash text;v_count integer;v_items jsonb;c public.bi_control_commands;
begin
 select p.org_id,a.role into organization,v_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_offset<0 then return'{"state":"invalid_input"}';end if;
 if v_kind='command'then
  select*into c from public.bi_control_commands where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return c.result||'{"state":"ready"}';
 elsif v_kind='goals'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,revision)order by metric_key,goal_type),'[]'))into v_count,v_hash from public.metric_goals where property_id=p_property_id;
  select coalesce(jsonb_agg(value order by metric_key,goal_type),'[]')into v_items from(select to_jsonb(g)value,g.metric_key,g.goal_type from public.metric_goals g where g.property_id=p_property_id order by g.metric_key,g.goal_type offset v_offset limit 20)q;
 elsif v_kind='history'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at,id),'[]'))into v_count,v_hash from public.bi_control_commands where property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(b)value,b.created_at,b.id from public.bi_control_commands b where b.property_id=p_property_id and b.org_id=organization order by created_at desc,id desc offset v_offset limit 20)q;
 else return'{"state":"invalid_input"}';end if;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',v_role in('admin','manager'),'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset);
end$$;

revoke all on function public.guard_bi_control()from public,anon,authenticated;
grant execute on function public.guard_bi_control()to service_role;
revoke all on function public.decide_bi_goal(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.decide_bi_goal(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_bi_goals(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_bi_goals(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
