create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

-- Fixed-rule marketing change review is advisory, never a business outcome reward.
create function public.bi_alert_payload_valid(p_payload jsonb)returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare a jsonb;
begin
 if jsonb_typeof(p_payload)is distinct from'object'or p_payload->>'definitionVersion'is distinct from'bi-alert-v1'or jsonb_typeof(p_payload->'coverage')is distinct from'object'or jsonb_typeof(p_payload->'definitions')is distinct from'object'or jsonb_typeof(p_payload->'alerts')is distinct from'array'or octet_length(p_payload::text)>1048576 then return false;end if;
 if p_payload-array['definitionVersion','sourceHash','definitions','coverage','alerts']<>'{}'or p_payload#>'{definitions,thresholds}'is distinct from'{"spend":50,"impressions":40,"clicks":40,"conversions":60}'::jsonb or p_payload#>>'{definitions,minimumDailyDates}'is distinct from'7'or jsonb_typeof(p_payload#>'{coverage,dailyEligible}')is distinct from'boolean'or jsonb_typeof(p_payload#>'{coverage,periodEligible}')is distinct from'boolean'then return false;end if;
 if jsonb_array_length(p_payload->'alerts')>2000 then return false;end if;
 if(select count(*)<>count(distinct value->>'key')from jsonb_array_elements(p_payload->'alerts'))then return false;end if;
 for a in select*from jsonb_array_elements(p_payload->'alerts')loop
  if jsonb_typeof(a)is distinct from'object'or not(a?&array['key','metric','kind','date','value','baseline','percent','threshold'])or a-array['key','metric','kind','date','value','baseline','percent','threshold']<>'{}'or coalesce(a->>'metric','')not in('spend','impressions','clicks','conversions')or coalesce(a->>'kind','')not in('daily','period')or length(coalesce(a->>'key',''))not between 1 and 80 then return false;end if;
  if a->>'kind'='daily'then
   if coalesce(a->>'date','')!~'^\d{4}-\d{2}-\d{2}$'or a->>'key'is distinct from'daily:'||(a->>'metric')||':'||(a->>'date')then return false;end if;
   begin if(a->>'date')::date::text<>a->>'date'then return false;end if;exception when others then return false;end;
  elsif a->'date'<>'null'or a->>'key'is distinct from'period:'||(a->>'metric')then return false;end if;
  if jsonb_typeof(a->'value')is distinct from'number'or jsonb_typeof(a->'baseline')is distinct from'number'or jsonb_typeof(a->'percent')is distinct from'number'or jsonb_typeof(a->'threshold')is distinct from'number'then return false;end if;
  if(a->>'value')::numeric<0 or(a->>'baseline')::numeric<=0 or(a->>'threshold')::numeric<>(case a->>'metric'when'spend'then 50 when'conversions'then 60 else 40 end)then return false;end if;
  if abs(((a->>'value')::numeric-(a->>'baseline')::numeric)/(a->>'baseline')::numeric*100-(a->>'percent')::numeric)>greatest(1,abs((a->>'percent')::numeric))*0.000000001 or abs((a->>'percent')::numeric)+0.000000001<(a->>'threshold')::numeric then return false;end if;
  if a->>'kind'='daily'and p_payload#>>'{coverage,dailyEligible}'<>'true'or a->>'kind'='period'and p_payload#>>'{coverage,periodEligible}'<>'true'then return false;end if;
 end loop;return true;
end$$;
create table public.bi_alert_sets(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),input jsonb not null,source jsonb not null,source_hash text not null,derived jsonb not null check(public.bi_alert_payload_valid(derived)),derived_hash text not null,definition_version text not null default'bi-alert-v1'check(definition_version='bi-alert-v1'),created_at timestamptz not null default clock_timestamp(),unique(property_id,source_hash,definition_version)
);
create table public.bi_alert_items(
 set_id uuid not null references public.bi_alert_sets(id)on delete cascade,item_key text not null,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),alert jsonb not null,alert_hash text not null,state text not null default'open'check(state in('open','reviewed','dismissed')),revision integer not null default 1,last_actor_id uuid references public.profiles(id),note text,updated_at timestamptz not null default clock_timestamp(),primary key(set_id,item_key)
);
create table public.bi_alert_commands(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),set_id uuid references public.bi_alert_sets(id)on delete cascade,input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index bi_alert_sets_property on public.bi_alert_sets(property_id,created_at desc,id desc);
create index bi_alert_sets_org on public.bi_alert_sets(org_id);
create index bi_alert_sets_actor on public.bi_alert_sets(actor_id);
create index bi_alert_items_property on public.bi_alert_items(property_id);
create index bi_alert_items_org on public.bi_alert_items(org_id);
create index bi_alert_items_actor on public.bi_alert_items(last_actor_id);
create index bi_alert_commands_property on public.bi_alert_commands(property_id,created_at desc,id desc);
create index bi_alert_commands_org on public.bi_alert_commands(org_id);
create index bi_alert_commands_actor on public.bi_alert_commands(actor_id);
create index bi_alert_commands_set on public.bi_alert_commands(set_id,created_at desc,id desc);
alter table public.bi_alert_sets enable row level security;
alter table public.bi_alert_items enable row level security;
alter table public.bi_alert_commands enable row level security;
revoke all on public.bi_alert_sets,public.bi_alert_items,public.bi_alert_commands from public,anon,authenticated;
grant all on public.bi_alert_sets,public.bi_alert_items,public.bi_alert_commands to service_role;
create policy bi_alert_sets_service on public.bi_alert_sets for all to service_role using(true)with check(true);
create policy bi_alert_items_service on public.bi_alert_items for all to service_role using(true)with check(true);
create policy bi_alert_commands_service on public.bi_alert_commands for all to service_role using(true)with check(true);
create function public.guard_bi_alert()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Alert history follows property retention';end if;
 if current_setting('p11.bi_alert_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded alert decision';end if;
 if tg_op='UPDATE'then
  if tg_table_name<>'bi_alert_items'then raise exception 'Alert review history is immutable';end if;
  if(new.set_id,new.item_key,new.property_id,new.org_id,new.alert,new.alert_hash)is distinct from(old.set_id,old.item_key,old.property_id,old.org_id,old.alert,old.alert_hash)then raise exception 'Alert evidence is immutable';end if;
 end if;return new;
end$$;
create trigger bi_alert_sets_guard before insert or update or delete on public.bi_alert_sets for each row execute function public.guard_bi_alert();
create trigger bi_alert_items_guard before insert or update or delete on public.bi_alert_items for each row execute function public.guard_bi_alert();
create trigger bi_alert_commands_guard before insert or update or delete on public.bi_alert_commands for each row execute function public.guard_bi_alert();
create function public.decide_bi_alert(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb,p_derived jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;v_role text;c public.bi_alert_commands;s public.bi_alert_sets;v_source jsonb;v_result jsonb;v_action text;v_set uuid;kind text:=p_input->>'operation';choice jsonb;i public.bi_alert_items;v_before jsonb:='[]';v_after jsonb:='[]';v_state text;item_count integer:=0;
begin
 select p.org_id,a.role into organization,v_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_role is null or v_role not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,958));select*into c from public.bi_alert_commands where id=p_id;
 if found then
  if(c.property_id,c.org_id,c.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if kind='cancel_request'or c.input->>'operation'='cancel_request'then return c.result||'{"state":"replayed"}';end if;
  if c.input<>p_input then return'{"state":"request_conflict"}';end if;return c.result||'{"state":"replayed"}';
 end if;
 perform set_config('p11.bi_alert_scope',p_property_id::text,true);
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='bi.alert.request_cancelled';v_result:='{"status":"cancelled_request"}';
 elsif kind='prepare'then
  if p_input-array['operation','filters','sourceHash']<>'{}'then return'{"state":"invalid_input"}';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,959));
  select*into s from public.bi_alert_sets where property_id=p_property_id and org_id=organization and source_hash=p_input->>'sourceHash'and definition_version='bi-alert-v1';
  if not found then
   v_source:=public.bi_report_source(p_actor_id,p_property_id,p_input->'filters');if v_source->>'state'<>'ready'then return v_source;end if;
   if v_source->>'sourceHash'is distinct from p_input->>'sourceHash'then return'{"state":"source_changed"}';end if;
   if p_derived is null then return'{"state":"needs_derivation"}';end if;
   if not public.bi_alert_payload_valid(p_derived)or p_derived->>'sourceHash'is distinct from p_input->>'sourceHash'then return'{"state":"invalid_result"}';end if;
   if exists(select 1 from jsonb_array_elements(p_derived->'alerts')a where a->>'kind'='daily'and((a->>'date')::date<(p_input#>>'{filters,startDate}')::date or(a->>'date')::date>(p_input#>>'{filters,endDate}')::date))then return'{"state":"invalid_result"}';end if;
   insert into public.bi_alert_sets(id,property_id,org_id,actor_id,input,source,source_hash,derived,derived_hash)values(p_id,p_property_id,organization,p_actor_id,p_input,v_source->'source',v_source->>'sourceHash',p_derived,public.knowledge_hash(p_derived))returning*into s;
   for choice in select*from jsonb_array_elements(p_derived->'alerts')loop
    insert into public.bi_alert_items(set_id,item_key,property_id,org_id,alert,alert_hash)values(s.id,choice->>'key',p_property_id,organization,choice,public.knowledge_hash(choice));
   end loop;
  elsif s.input->'filters'is distinct from p_input->'filters'then return'{"state":"request_conflict"}';end if;
  v_set:=s.id;v_action:='bi.alert.review_prepared';v_result:=jsonb_build_object('status','ready','count',jsonb_array_length(s.derived->'alerts'),'sourceHash',s.source_hash,'derivedHash',s.derived_hash);
 else
  if kind is null or kind not in('review','dismiss','restore')or p_input-array['operation','setId','items','note']<>'{}'or jsonb_typeof(p_input->'items')is distinct from'array'or jsonb_typeof(p_input->'note')is distinct from'string'or length(p_input->>'note')>2000 then return'{"state":"invalid_input"}';end if;
  if jsonb_array_length(p_input->'items')not between 1 and 50 or(select count(*)<>count(distinct value->>'key')from jsonb_array_elements(p_input->'items'))then return'{"state":"invalid_input"}';end if;
  begin v_set:=(p_input->>'setId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
  select*into s from public.bi_alert_sets where id=v_set and property_id=p_property_id and org_id=organization for update;if not found then return'{"state":"not_found"}';end if;
  -- Verify the entire selection before changing any item.
  for choice in select*from jsonb_array_elements(p_input->'items')loop
   if jsonb_typeof(choice)is distinct from'object'or choice-array['key','revision']<>'{}'or coalesce(choice->>'revision','')!~'^[0-9]{1,9}$'then return'{"state":"invalid_input"}';end if;
   select*into i from public.bi_alert_items where set_id=s.id and item_key=choice->>'key';if not found then return'{"state":"not_found"}';end if;
   if i.revision<>(choice->>'revision')::integer then return'{"state":"alert_changed"}';end if;v_before:=v_before||jsonb_build_array(jsonb_build_object('key',i.item_key,'revision',i.revision,'state',i.state,'note',i.note));
  end loop;
  v_state:=case kind when'review'then'reviewed'when'dismiss'then'dismissed'else'open'end;
  for choice in select*from jsonb_array_elements(p_input->'items')loop
   update public.bi_alert_items set state=v_state,revision=revision+1,last_actor_id=p_actor_id,note=nullif(btrim(p_input->>'note'),''),updated_at=clock_timestamp()where set_id=s.id and item_key=choice->>'key'returning*into i;
   v_after:=v_after||jsonb_build_array(jsonb_build_object('key',i.item_key,'revision',i.revision,'state',i.state,'note',i.note));item_count:=item_count+1;
  end loop;
  v_action:=case kind when'review'then'bi.alert.reviewed'when'dismiss'then'bi.alert.dismissed'else'bi.alert.restored'end;v_result:=jsonb_build_object('status',v_state,'count',item_count,'sourceHash',s.source_hash,'derivedHash',s.derived_hash);
 end if;
 v_result:=v_result||jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id,'setId',v_set);
 insert into public.bi_alert_commands(id,property_id,org_id,actor_id,set_id,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,v_set,p_input,v_before,v_after,v_result);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi',v_action,'server_confirmed','succeeded',jsonb_build_object('setId',v_set),null,null,v_result-'state'-'propertyId'-'id','{}')->>'state'not in('recorded','replayed')then raise exception 'Alert action unavailable';end if;return v_result;
end$$;
create function public.read_bi_alerts(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;v_role text;kind text:=coalesce(p_input->>'kind','list');v_offset integer:=coalesce((p_input->>'offset')::integer,0);s public.bi_alert_sets;c public.bi_alert_commands;v_items jsonb;v_count integer;v_hash text;v_counts jsonb;bucket text:=coalesce(p_input->>'bucket','all');
begin
 select p.org_id,a.role into organization,v_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if v_offset<0 or bucket not in('all','open','reviewed','dismissed')then return'{"state":"invalid_input"}';end if;
 if kind='command'then
  select*into c from public.bi_alert_commands where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return c.result||'{"state":"ready"}';
 elsif kind='list'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at desc,id desc),'[]'))into v_count,v_hash from public.bi_alert_sets where property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select jsonb_build_object('id',id,'sourceHash',source_hash,'filters',input->'filters','count',jsonb_array_length(derived->'alerts'),'createdAt',created_at)value,created_at,id from public.bi_alert_sets where property_id=p_property_id and org_id=organization order by created_at desc,id desc offset v_offset limit 20)x;
 else
  select*into s from public.bi_alert_sets where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  if kind='items'then
   select jsonb_build_object('all',count(*),'open',count(*)filter(where state='open'),'reviewed',count(*)filter(where state='reviewed'),'dismissed',count(*)filter(where state='dismissed')),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(item_key,revision)order by item_key),'[]'))into v_counts,v_hash from public.bi_alert_items where set_id=s.id;
   select count(*)into v_count from public.bi_alert_items where set_id=s.id and(bucket='all'or state=bucket);
   select coalesce(jsonb_agg(value order by item_key),'[]')into v_items from(select to_jsonb(a)value,a.item_key from public.bi_alert_items a where a.set_id=s.id and(bucket='all'or a.state=bucket)order by item_key offset v_offset limit 20)x;
  elsif kind='history'then
   select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at,id),'[]'))into v_count,v_hash from public.bi_alert_commands where set_id=s.id;
   select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(cmd)||jsonb_build_object('actorName',coalesce(nullif(btrim(member.full_name),''),'Team member'))value,cmd.created_at,cmd.id from public.bi_alert_commands cmd left join public.profiles member on member.id=cmd.actor_id where cmd.set_id=s.id order by cmd.created_at desc,cmd.id desc offset v_offset limit 20)x;
  else return'{"state":"invalid_input"}';end if;
 end if;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'id',s.id,'canManage',v_role in('admin','manager'),'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset,'counts',v_counts,'set',case when s.id is not null then jsonb_build_object('id',s.id,'sourceHash',s.source_hash,'filters',s.input->'filters','createdAt',s.created_at,'definition',s.derived-'alerts')else null end);
end$$;

revoke all on function public.bi_alert_payload_valid(jsonb)from public,anon,authenticated;
grant execute on function public.bi_alert_payload_valid(jsonb)to service_role;
revoke all on function public.guard_bi_alert()from public,anon,authenticated;
grant execute on function public.guard_bi_alert()to service_role;
revoke all on function public.decide_bi_alert(uuid,uuid,uuid,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.decide_bi_alert(uuid,uuid,uuid,jsonb,jsonb)to service_role;
revoke all on function public.read_bi_alerts(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_bi_alerts(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
