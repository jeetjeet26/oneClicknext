create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

create table public.bi_reports(
 id uuid primary key,report_sequence bigint generated always as identity unique,
 property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 state text not null check(state in('saved','cancelled')),label text,filters jsonb,source jsonb,source_hash text,
 created_at timestamptz not null default clock_timestamp(),
 check((state='cancelled'and source is null and source_hash is null)or(state='saved'and source is not null and source_hash~'^[a-f0-9]{64}$'and length(label)between 1 and 120))
);
create index bi_report_property on public.bi_reports(property_id,report_sequence desc);
create index bi_report_org on public.bi_reports(org_id);
create index bi_report_actor on public.bi_reports(actor_id);
create table public.bi_report_exports(
 id uuid primary key,report_id uuid not null references public.bi_reports(id)on delete cascade,
 property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 format text not null check(format in('csv','pdf')),source_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index bi_export_report on public.bi_report_exports(report_id,created_at desc,id desc);
create index bi_export_property on public.bi_report_exports(property_id);
create index bi_export_org on public.bi_report_exports(org_id);
create index bi_export_actor on public.bi_report_exports(actor_id);
create table public.bi_export_observations(
 id uuid primary key references public.bi_report_exports(id)on delete cascade,
 property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 outcome text not null check(outcome in('download_started','download_failed')),created_at timestamptz not null default clock_timestamp()
);
create index bi_export_observation_property on public.bi_export_observations(property_id);
create index bi_export_observation_org on public.bi_export_observations(org_id);
create index bi_export_observation_actor on public.bi_export_observations(actor_id);
alter table public.bi_reports enable row level security;
alter table public.bi_report_exports enable row level security;
alter table public.bi_export_observations enable row level security;
revoke all on public.bi_reports,public.bi_report_exports,public.bi_export_observations from public,anon,authenticated;
grant all on public.bi_reports,public.bi_report_exports,public.bi_export_observations to service_role;
create policy bi_reports_service on public.bi_reports for all to service_role using(true)with check(true);
create policy bi_exports_service on public.bi_report_exports for all to service_role using(true)with check(true);
create policy bi_export_observations_service on public.bi_export_observations for all to service_role using(true)with check(true);
create function public.guard_bi_report_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='UPDATE'then raise exception 'Saved BI evidence is immutable';end if;
 if tg_op='DELETE'then
  if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  raise exception 'Saved BI evidence follows property retention';
 end if;
 if current_setting('p11.bi_scope',true)is distinct from new.property_id::text or not exists(select 1 from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=new.property_id and p.org_id=new.org_id and a.id=new.actor_id)then raise exception 'Use a scoped BI decision';end if;
 return new;
end$$;
create trigger bi_report_guard before insert or update or delete on public.bi_reports for each row execute function public.guard_bi_report_history();
create trigger bi_export_guard before insert or update or delete on public.bi_report_exports for each row execute function public.guard_bi_report_history();
create trigger bi_export_observation_guard before insert or update or delete on public.bi_export_observations for each row execute function public.guard_bi_report_history();

create function public.bi_report_source(p_actor_id uuid,p_property_id uuid,p_filters jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare property_name text;starts date;ends date;prior_start date;prior_end date;channel text;channels text[];account text;current_rows jsonb;prior_rows jsonb:='[]';result jsonb;
begin
 select p.name into property_name from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found then return '{"state":"forbidden"}';end if;
 if jsonb_typeof(p_filters)is distinct from'object'or p_filters-array['startDate','endDate','compare','channel','account']<>'{}'or jsonb_typeof(p_filters->'compare')is distinct from'boolean'or coalesce(p_filters->>'startDate','')!~'^\d{4}-\d{2}-\d{2}$'or coalesce(p_filters->>'endDate','')!~'^\d{4}-\d{2}-\d{2}$'then return '{"state":"invalid_filters"}';end if;
 begin starts:=(p_filters->>'startDate')::date;ends:=(p_filters->>'endDate')::date;exception when others then return '{"state":"invalid_filters"}';end;
 if ends<starts or ends-starts>365 then return '{"state":"invalid_filters"}';end if;
 channel:=p_filters->>'channel';account:=p_filters->>'account';
 if(channel is not null and(channel!~'^[a-z][a-z0-9_]{0,49}$'or jsonb_typeof(p_filters->'channel')<>'string'))or(account is not null and(length(account)>100 or jsonb_typeof(p_filters->'account')<>'string'))then return '{"state":"invalid_filters"}';end if;
 channels:=case channel when'unknown'then null when'google_ads'then array['google_ads','google','googleads']when'meta_ads'then array['meta_ads','meta','facebook_ads','instagram_ads']when'tiktok_ads'then array['tiktok_ads','tiktok']when'linkedin_ads'then array['linkedin_ads','linkedin']when'bing_ads'then array['bing_ads','bing','microsoft_ads']else case when channel is not null then array[channel]end end;
 select coalesce(jsonb_agg(row-'raw_source'order by row->>'date',row->>'id'),'[]')into current_rows from jsonb_array_elements(public.read_marketing_facts(p_property_id,starts,ends,channels,null,account)->'rows')row where channel is distinct from'unknown'or coalesce(btrim(row->>'channel_id'),'')='';
 if p_filters->'compare'='true'then
  prior_end:=starts-1;prior_start:=prior_end-(ends-starts);
  select coalesce(jsonb_agg(row-'raw_source'order by row->>'date',row->>'id'),'[]')into prior_rows from jsonb_array_elements(public.read_marketing_facts(p_property_id,prior_start,prior_end,channels,null,account)->'rows')row where channel is distinct from'unknown'or coalesce(btrim(row->>'channel_id'),'')='';
 end if;
 result:=jsonb_build_object('version','bi-v1','propertyId',p_property_id,'propertyName',property_name,'filters',p_filters,'currentRows',current_rows,'previousRows',prior_rows,'previousPeriod',case when prior_start is not null then jsonb_build_object('start',prior_start,'end',prior_end)end);
 return jsonb_build_object('state','ready','propertyId',p_property_id,'source',result,'sourceHash',public.knowledge_hash(result));
end$$;

create function public.save_bi_report(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.bi_reports;s jsonb;e jsonb;v_label text;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,947));
 select *into r from public.bi_reports where id=p_id;
 if found then
  if(r.property_id,r.org_id,r.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return '{"state":"not_found"}';end if;
  if r.state='cancelled'then return jsonb_build_object('state','replayed','propertyId',p_property_id,'id',r.id,'status','cancelled');end if;
  if(r.filters,r.label,r.source_hash)is distinct from(p_input->'filters',btrim(p_input->>'label'),p_input->>'sourceHash')then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','propertyId',p_property_id,'id',r.id,'status',r.state);
 end if;
 v_label:=btrim(p_input->>'label');if jsonb_typeof(p_input)is distinct from'object'or p_input-array['filters','label','sourceHash']<>'{}'or coalesce(length(v_label),0)not between 1 and 120 or coalesce(p_input->>'sourceHash','')!~'^[a-f0-9]{64}$'then return '{"state":"invalid_input"}';end if;
 s:=public.bi_report_source(p_actor_id,p_property_id,p_input->'filters');if s->>'state'<>'ready'then return s;end if;
 if s->>'sourceHash'is distinct from p_input->>'sourceHash'then return '{"state":"source_changed"}';end if;
 perform set_config('p11.bi_scope',p_property_id::text,true);
 insert into public.bi_reports(id,property_id,org_id,actor_id,state,label,filters,source,source_hash)values(p_id,p_property_id,organization,p_actor_id,'saved',v_label,p_input->'filters',s->'source',s->>'sourceHash');
 e:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi','bi.report.saved','server_confirmed','succeeded',jsonb_build_object('reportId',p_id,'sourceHash',s->>'sourceHash'),null,null,jsonb_build_object('status','saved','definitionVersion','bi-v1'),'{}');if e->>'state'not in('recorded','replayed')then raise exception 'BI report evidence unavailable';end if;
 return jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id,'status','saved');
end$$;

create function public.cancel_bi_report(p_id uuid,p_actor_id uuid,p_property_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.bi_reports;e jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,947));select *into r from public.bi_reports where id=p_id;
 if found then
  if(r.property_id,r.org_id,r.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','replayed','propertyId',p_property_id,'id',p_id,'status',r.state);
 end if;
 perform set_config('p11.bi_scope',p_property_id::text,true);insert into public.bi_reports(id,property_id,org_id,actor_id,state)values(p_id,p_property_id,organization,p_actor_id,'cancelled');
 e:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi','bi.report.cancelled','server_confirmed','succeeded',jsonb_build_object('reportId',p_id),null,null,'{"status":"cancelled"}','{}');if e->>'state'not in('recorded','replayed')then raise exception 'BI cancellation evidence unavailable';end if;
 return jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id,'status','cancelled');
end$$;

create function public.prepare_bi_export(p_id uuid,p_actor_id uuid,p_property_id uuid,p_report_id uuid,p_format text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.bi_reports;x public.bi_report_exports;e jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_format not in('csv','pdf')or p_format is null then return '{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,948));select *into x from public.bi_report_exports where id=p_id;
 if found then
  if(x.actor_id,x.org_id,x.property_id)is distinct from(p_actor_id,organization,p_property_id)then return '{"state":"not_found"}';end if;
  if(x.report_id,x.format)is distinct from(p_report_id,p_format)then return '{"state":"request_conflict"}';end if;
 else
  select *into r from public.bi_reports where id=p_report_id and property_id=p_property_id and org_id=organization and state='saved';if not found then return '{"state":"not_found"}';end if;
  perform set_config('p11.bi_scope',p_property_id::text,true);insert into public.bi_report_exports(id,report_id,property_id,org_id,actor_id,format,source_hash)values(p_id,r.id,p_property_id,organization,p_actor_id,p_format,r.source_hash)returning*into x;
  e:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'bi','bi.export.prepared','server_confirmed','succeeded',jsonb_build_object('reportId',r.id,'format',p_format,'sourceHash',r.source_hash),null,null,'{"status":"prepared"}','{}');if e->>'state'not in('recorded','replayed')then raise exception 'BI export evidence unavailable';end if;
 end if;
 select *into r from public.bi_reports where id=x.report_id and property_id=p_property_id and org_id=organization and state='saved';
 return jsonb_build_object('state','prepared','propertyId',p_property_id,'id',x.id,'reportId',r.id,'format',x.format,'sourceHash',x.source_hash,'source',r.source,'label',r.label,'savedAt',r.created_at,'outcome',(select outcome from public.bi_export_observations where id=x.id));
end$$;

create function public.report_bi_export(p_id uuid,p_actor_id uuid,p_property_id uuid,p_outcome text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;x public.bi_report_exports;o public.bi_export_observations;e jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_outcome is null or p_outcome not in('download_started','download_failed')then return '{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,948));select *into x from public.bi_report_exports where id=p_id and actor_id=p_actor_id and org_id=organization and property_id=p_property_id;if not found then return '{"state":"not_found"}';end if;
 select*into o from public.bi_export_observations where id=p_id;if found then
  if o.outcome<>p_outcome then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','propertyId',p_property_id,'id',p_id,'status',o.outcome);
 end if;
 perform set_config('p11.bi_scope',p_property_id::text,true);insert into public.bi_export_observations(id,property_id,org_id,actor_id,outcome)values(p_id,p_property_id,organization,p_actor_id,p_outcome);
 e:=public.append_shared_action_event(gen_random_uuid(),p_id,p_property_id,p_actor_id,'bi','bi.export.reported','browser_observed','observed',jsonb_build_object('exportId',p_id,'reportId',x.report_id),null,null,jsonb_build_object('outcome',p_outcome),'{}');if e->>'state'not in('recorded','replayed')then raise exception 'BI browser observation unavailable';end if;
 return jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id,'status',p_outcome);
end$$;

create function public.read_bi_reports(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;v_kind text:=coalesce(p_input->>'kind','history');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_hash text;v_count integer;v_items jsonb;r public.bi_reports;x public.bi_report_exports;
begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if v_offset<0 then return '{"state":"invalid_input"}';end if;
 if v_kind='detail'then
  select*into r from public.bi_reports where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization;if not found then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'id',r.id,'status',r.state,'actorId',r.actor_id,'label',r.label,'source',r.source,'sourceHash',r.source_hash,'savedAt',r.created_at);
 elsif v_kind='export'then
  select*into x from public.bi_report_exports where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;if not found then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'id',x.id,'reportId',x.report_id,'format',x.format,'sourceHash',x.source_hash,'outcome',(select outcome from public.bi_export_observations where id=x.id));
 elsif v_kind='history'then
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,state)order by report_sequence),'[]'))into v_count,v_hash from public.bi_reports where property_id=p_property_id and org_id=organization;
  if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return '{"state":"history_changed"}';end if;
  select coalesce(jsonb_agg(value order by seq desc),'[]')into v_items from(select br.report_sequence seq,jsonb_build_object('id',br.id,'status',br.state,'label',br.label,'filters',br.filters,'savedAt',br.created_at,'actorName',a.full_name)value from public.bi_reports br left join public.profiles a on a.id=br.actor_id where br.property_id=p_property_id and br.org_id=organization order by br.report_sequence desc offset v_offset limit 20)q;
 elsif v_kind='exports'then
  select*into r from public.bi_reports where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization;if not found then return '{"state":"not_found"}';end if;
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(e.id,o.outcome)order by e.created_at,e.id),'[]'))into v_count,v_hash from public.bi_report_exports e left join public.bi_export_observations o on o.id=e.id where e.report_id=r.id;
  if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return '{"state":"history_changed"}';end if;
  select coalesce(jsonb_agg(value order by created desc,id desc),'[]')into v_items from(select e.id,e.created_at created,jsonb_build_object('id',e.id,'format',e.format,'createdAt',e.created_at,'actorName',a.full_name,'outcome',o.outcome)value from public.bi_report_exports e left join public.bi_export_observations o on o.id=e.id left join public.profiles a on a.id=e.actor_id where e.report_id=r.id order by e.created_at desc,e.id desc offset v_offset limit 20)q;
 else return '{"state":"invalid_input"}';end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'items',v_items,'total',v_count,'pageHash',v_hash);
end$$;

revoke all on function public.guard_bi_report_history()from public,anon,authenticated;
grant execute on function public.guard_bi_report_history()to service_role;
revoke all on function public.bi_report_source(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.bi_report_source(uuid,uuid,jsonb)to service_role;
revoke all on function public.save_bi_report(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.save_bi_report(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.cancel_bi_report(uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.cancel_bi_report(uuid,uuid,uuid)to service_role;
revoke all on function public.prepare_bi_export(uuid,uuid,uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.prepare_bi_export(uuid,uuid,uuid,uuid,text)to service_role;
revoke all on function public.report_bi_export(uuid,uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.report_bi_export(uuid,uuid,uuid,text)to service_role;
revoke all on function public.read_bi_reports(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_bi_reports(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
