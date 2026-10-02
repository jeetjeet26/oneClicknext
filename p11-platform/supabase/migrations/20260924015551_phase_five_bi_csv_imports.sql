create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('bi.csv.preview_saved','bi.csv.applied','bi.csv.discarded','bi.csv.request_cancelled','audit.analysis.requested','audit.analysis.retried','audit.analysis.cancelled','audit.analysis.stopped','audit.analysis.discarded','audit.analysis.resumed','audit.analysis.applied','audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
-- Exact original files, deterministic previews and reviewed import decisions.
create table public.bi_csv_imports(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 state text not null check(state in('preview','applied','discarded','cancelled')),original jsonb,original_hash text,preview jsonb,preview_hash text,target_before jsonb,target_hash text,target_after jsonb,parent_id uuid references public.bi_csv_imports(id),created_at timestamptz not null default clock_timestamp(),decided_at timestamptz
);
create table public.bi_csv_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),import_id uuid references public.bi_csv_imports(id)on delete cascade,input jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create index bi_csv_imports_history on public.bi_csv_imports(property_id,created_at desc,id desc);
create index bi_csv_imports_org on public.bi_csv_imports(org_id);
create index bi_csv_imports_actor on public.bi_csv_imports(actor_id);
create index bi_csv_imports_parent on public.bi_csv_imports(parent_id);
create index bi_csv_commands_history on public.bi_csv_commands(property_id,created_at desc,id desc);
create index bi_csv_commands_org on public.bi_csv_commands(org_id);
create index bi_csv_commands_actor on public.bi_csv_commands(actor_id);
create index bi_csv_commands_import on public.bi_csv_commands(import_id);
alter table public.bi_csv_imports enable row level security;
alter table public.bi_csv_commands enable row level security;
revoke all on public.bi_csv_imports,public.bi_csv_commands from anon,authenticated;
grant all on public.bi_csv_imports,public.bi_csv_commands to service_role;

-- Earlier extended rows keep their unknown account and campaign identity.
alter table public.fact_marketing_extended add column source_account_id text,add column currency_code text,add column campaign_id text,add column retained_import_id uuid references public.bi_csv_imports(id);
alter table public.marketing_data_uploads add column retained_import_id uuid references public.bi_csv_imports(id);
create index fact_marketing_extended_import on public.fact_marketing_extended(retained_import_id);
create index marketing_data_uploads_import on public.marketing_data_uploads(retained_import_id);
do $$declare name text;begin
 for name in select conname from pg_constraint where conrelid='public.fact_marketing_extended'::regclass and contype='u'loop execute format('alter table public.fact_marketing_extended drop constraint %I',name);end loop;
end$$;
create unique index fact_marketing_extended_verified_identity on public.fact_marketing_extended(property_id,channel_id,source_account_id,campaign_id,report_type,dimension_key,dimension_value,date_range_start,date_range_end)where retained_import_id is not null;

create function public.guard_bi_csv_records()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then if exists(select 1 from public.properties where id=old.property_id)then raise exception 'Retained import evidence cannot be deleted';end if;return old;end if;
 if current_setting('p11.bi_csv_scope',true)is distinct from new.property_id::text then raise exception 'Recorded CSV decision required';end if;
 if tg_op='UPDATE'then
  if tg_table_name='bi_csv_commands'then raise exception 'Import decisions are immutable';end if;
  if(to_jsonb(new)-array['state','target_after','decided_at'])is distinct from(to_jsonb(old)-array['state','target_after','decided_at'])or old.state<>'preview'then raise exception 'Retained original and preview are immutable';end if;
 end if;return new;
end$$;
create trigger recorded_csv_source before insert or update or delete on public.bi_csv_imports for each row execute function public.guard_bi_csv_records();
create trigger recorded_csv_command before insert or update or delete on public.bi_csv_commands for each row execute function public.guard_bi_csv_records();

create function public.bi_csv_targets(p_property_id uuid,p_preview jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare result jsonb;
begin
 if p_preview->>'kind'='daily'then
  select coalesce(jsonb_agg(to_jsonb(f)order by f.id),'[]')into result from public.fact_marketing_performance f where f.property_id=p_property_id and(f.source_account_id=p_preview->>'sourceAccountId'or f.source_account_id is null)and(lower(btrim(f.channel_id))=p_preview->>'platform'or f.channel_id is null or lower(btrim(f.channel_id))in('unknown','','meta','google','googleads','facebook_ads','instagram_ads'))and exists(select 1 from jsonb_array_elements(p_preview->'rows')r where f.date=(r->>'date')::date and f.campaign_id=r->>'campaign_id');
 else
  select coalesce(jsonb_agg(to_jsonb(f)order by f.id),'[]')into result from public.fact_marketing_extended f where f.property_id=p_property_id and(f.source_account_id=p_preview->>'sourceAccountId'or f.source_account_id is null)and(f.channel_id=p_preview->>'platform'or(f.channel_id='meta'and p_preview->>'platform'='meta_ads'))and f.report_type=p_preview->>'reportType'and exists(select 1 from jsonb_array_elements(p_preview->'rows')r where(f.campaign_id=r->>'campaign_id'or f.campaign_id is null)and(f.dimension_key=r->>'dimension_key'or f.retained_import_id is null)and f.dimension_value=r->>'dimension_value'and(f.date_range_start=(r->>'date_range_start')::date or f.date_range_start is null)and(f.date_range_end=(r->>'date_range_end')::date or f.date_range_end is null));
 end if;return result;
end$$;

create function public.record_bi_csv_action(p_id uuid,p_actor uuid,p_property uuid,p_action text,p_import uuid,p_result jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare result jsonb;
begin
 result:=public.append_shared_action_event(p_id,p_id,p_property,p_actor,'bi',p_action,'server_confirmed','succeeded',jsonb_build_object('importId',p_import),null,null,p_result);
 if result->>'state'not in('recorded','replayed')then raise exception 'Import action was not recorded';end if;
end$$;

create function public.prepare_bi_csv(p_id uuid,p_actor_id uuid,p_property_id uuid,p_original jsonb,p_preview jsonb,p_parent_id uuid default null,p_cancel boolean default false)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.bi_csv_imports;before_value jsonb;result jsonb;row_value jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if not found then return'{"state":"forbidden"}';end if;
 if p_id is null then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,974));select*into r from public.bi_csv_imports where id=p_id;
 if found then
  if(r.property_id,r.actor_id)is distinct from(p_property_id,p_actor_id)then return'{"state":"request_conflict"}';end if;
  if not p_cancel and r.state<>'cancelled'and(r.original,r.parent_id)is distinct from(p_original,p_parent_id)then return'{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','id',p_id,'propertyId',p_property_id,'status',r.state);
 end if;
 if not p_cancel then
  if jsonb_typeof(p_original)is distinct from'object'or jsonb_typeof(p_preview)is distinct from'object'or jsonb_typeof(p_preview->'rows')is distinct from'array'or jsonb_array_length(p_preview->'rows')not between 1 and 5000 or octet_length(p_original::text)>10000000 or octet_length(p_preview::text)>16000000 or coalesce(p_preview->>'kind','')not in('daily','dimension')or coalesce(p_preview->>'platform','')not in('google_ads','meta_ads')or p_preview->>'currencyCode'is distinct from'USD'or coalesce(p_preview->>'sourceAccountId','')!~'^[0-9]{1,30}$'or(p_preview->>'platform'='google_ads'and length(p_preview->>'sourceAccountId')<>10)or length(coalesce(p_preview->>'parserVersion',''))not between 1 and 150 then return'{"state":"invalid_input"}';end if;
  for row_value in select value from jsonb_array_elements(p_preview->'rows')loop
   if length(coalesce(row_value->>'campaign_id',''))not between 1 and 150 or length(coalesce(row_value->>'campaign_name',''))not between 1 and 250 then return'{"state":"invalid_input"}';end if;
   if p_preview->>'kind'='daily'and((row_value->>'spend')::numeric is null or(row_value->>'spend')::numeric is distinct from round((row_value->>'spend')::numeric,2))then return'{"state":"invalid_input"}';end if;
   if p_preview->>'kind'='dimension'and(length(coalesce(row_value->>'dimension_key',''))not between 1 and 500 or length(coalesce(row_value->>'dimension_value',''))not between 1 and 2000 or(row_value->>'date_range_start')::date>(row_value->>'date_range_end')::date)then return'{"state":"invalid_input"}';end if;
  end loop;
  if p_parent_id is not null and not exists(select 1 from public.bi_csv_imports where id=p_parent_id and property_id=p_property_id and org_id=organization and state in('preview','discarded')and original=p_original)then return'{"state":"invalid_parent"}';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,817));before_value:=public.bi_csv_targets(p_property_id,p_preview);
 end if;
 perform set_config('p11.bi_csv_scope',p_property_id::text,true);
 insert into public.bi_csv_imports(id,property_id,org_id,actor_id,state,original,original_hash,preview,preview_hash,target_before,target_hash,parent_id)values(p_id,p_property_id,organization,p_actor_id,case when p_cancel then'cancelled'else'preview'end,case when not p_cancel then p_original end,case when not p_cancel then public.knowledge_hash(p_original)end,case when not p_cancel then p_preview end,case when not p_cancel then public.knowledge_hash(p_preview)end,before_value,case when not p_cancel then public.knowledge_hash(before_value)end,p_parent_id);
 result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'status',case when p_cancel then'cancelled'else'preview'end);
 perform public.record_bi_csv_action(p_id,p_actor_id,p_property_id,case when p_cancel then'bi.csv.request_cancelled'else'bi.csv.preview_saved'end,p_id,jsonb_build_object('status',result->>'status'));
 return result;
end$$;

create function public.decide_bi_csv(p_id uuid,p_actor_id uuid,p_property_id uuid,p_import_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;r public.bi_csv_imports;c public.bi_csv_commands;before_value jsonb;after_value jsonb;result jsonb;op text:=p_input->>'operation';rows_count integer;value jsonb;
begin
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager');if not found then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op not in('apply','discard','cancel')then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,975));select*into c from public.bi_csv_commands where id=p_id;
 if found then
  if(c.property_id,c.actor_id)is distinct from(p_property_id,p_actor_id)then return'{"state":"request_conflict"}';end if;
  if c.input->>'operation'<>'cancel'and op<>'cancel'and(c.import_id,c.input)is distinct from(p_import_id,p_input)then return'{"state":"request_conflict"}';end if;return c.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,817));perform set_config('p11.bi_csv_scope',p_property_id::text,true);
 if op='cancel'then result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'status','cancelled_request');
 else
  select*into r from public.bi_csv_imports where id=p_import_id and property_id=p_property_id and org_id=organization for update;if not found then return'{"state":"not_found"}';end if;
  if r.state<>'preview'then return'{"state":"review_required"}';end if;
  if p_input->>'previewHash'is distinct from r.preview_hash or p_input->>'targetHash'is distinct from r.target_hash or length(btrim(coalesce(p_input->>'reason','')))not between 1 and 2000 then return'{"state":"invalid_input"}';end if;
  if op='apply'then
   if exists(select 1 from public.import_jobs where property_id=p_property_id and status='running')then return'{"state":"import_running"}';end if;
   before_value:=public.bi_csv_targets(p_property_id,r.preview);
   if public.knowledge_hash(before_value)is distinct from r.target_hash then return'{"state":"source_changed"}';end if;
   if exists(select 1 from jsonb_array_elements(before_value)v where v->>'source_account_id'is null or v->>'currency_code'is distinct from'USD'or(r.preview->>'kind'='dimension'and v->>'retained_import_id'is null))then return'{"state":"legacy_review_required"}';end if;
   if r.preview->>'kind'='daily'then
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,campaign_name,impressions,clicks,spend,conversions,raw_source)
    select(v->>'date')::date,p_property_id,r.preview->>'platform',r.preview->>'sourceAccountId','USD',v->>'campaign_id',v->>'campaign_name',(v->>'impressions')::bigint,(v->>'clicks')::bigint,(v->>'spend')::numeric,(v->>'conversions')::numeric,'csv_import:'||r.id::text from jsonb_array_elements(r.preview->'rows')v
    on conflict(date,property_id,channel_id,source_account_id,campaign_id)do update set campaign_name=excluded.campaign_name,impressions=excluded.impressions,clicks=excluded.clicks,spend=excluded.spend,conversions=excluded.conversions,currency_code=excluded.currency_code,raw_source=excluded.raw_source;
   else
    insert into public.fact_marketing_extended(property_id,channel_id,source_account_id,currency_code,campaign_id,campaign_name,report_type,dimension_key,dimension_value,date_range_start,date_range_end,metrics,raw_source,retained_import_id)
    select p_property_id,r.preview->>'platform',r.preview->>'sourceAccountId','USD',v->>'campaign_id',v->>'campaign_name',r.preview->>'reportType',v->>'dimension_key',v->>'dimension_value',(v->>'date_range_start')::date,(v->>'date_range_end')::date,v->'metrics','csv_import:'||r.id::text,r.id from jsonb_array_elements(r.preview->'rows')v
    on conflict(property_id,channel_id,source_account_id,campaign_id,report_type,dimension_key,dimension_value,date_range_start,date_range_end)where retained_import_id is not null do update set campaign_name=excluded.campaign_name,metrics=excluded.metrics,raw_source=excluded.raw_source,retained_import_id=excluded.retained_import_id;
   end if;
   get diagnostics rows_count=row_count;if rows_count<>jsonb_array_length(r.preview->'rows')then raise exception 'Complete import was not confirmed';end if;
   after_value:=public.bi_csv_targets(p_property_id,r.preview);
   insert into public.marketing_data_uploads(property_id,platform,report_type,file_name,date_range_start,date_range_end,rows_imported,uploaded_by,retained_import_id)values(p_property_id,r.preview->>'platform',r.preview->>'reportType',r.original->>'filename',(r.preview->'dateRange'->>'start')::date,(r.preview->'dateRange'->>'end')::date,rows_count,p_actor_id,r.id);
  end if;
  update public.bi_csv_imports set state=case when op='apply'then'applied'else'discarded'end,target_after=after_value,decided_at=clock_timestamp()where id=r.id;
  result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'importId',r.id,'status',case when op='apply'then'applied'else'discarded'end,'rowsApplied',coalesce(rows_count,0));
 end if;
 insert into public.bi_csv_commands(id,property_id,org_id,actor_id,import_id,input,result)values(p_id,p_property_id,organization,p_actor_id,case when op<>'cancel'then p_import_id end,p_input,result);
 perform public.record_bi_csv_action(p_id,p_actor_id,p_property_id,case op when'apply'then'bi.csv.applied'when'discard'then'bi.csv.discarded'else'bi.csv.request_cancelled'end,p_import_id,jsonb_build_object('status',result->>'status','rowsApplied',coalesce(rows_count,0)));
 return result;
end$$;

create function public.read_bi_csv(p_actor_id uuid,p_property_id uuid,p_id uuid default null,p_command_id uuid default null,p_kind text default'history',p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;manager boolean;r public.bi_csv_imports;c public.bi_csv_commands;items jsonb;count_value bigint;hash_value text;
begin
 select p.org_id,u.role in('admin','manager')into organization,manager from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if p_command_id is not null then select*into c from public.bi_csv_commands where id=p_command_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;return c.result;end if;
 if p_offset not between 0 and 1000000 or p_kind not in('history','rows','before','after','decisions','legacy')then return'{"state":"invalid_input"}';end if;
 if p_kind='legacy'then
  if p_id is not null then return'{"state":"invalid_input"}';end if;
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(to_jsonb(u)order by created_at desc,id desc),'[]'))into count_value,hash_value from public.marketing_data_uploads u where property_id=p_property_id and retained_import_id is null;
  if p_hash is not null and p_hash<>hash_value then return'{"state":"history_changed"}';end if;
  select coalesce(jsonb_agg(to_jsonb(z)order by z.created_at desc,z.id desc),'[]')into items from(select id,'legacy'as state,file_name as filename,report_type as kind,platform,rows_imported,date_range_start,date_range_end,uploaded_by,created_at from public.marketing_data_uploads where property_id=p_property_id and retained_import_id is null order by created_at desc,id desc offset p_offset limit 25)z;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'canManage',manager,'items',items,'count',count_value,'hash',hash_value,'offset',p_offset);
 end if;
 if p_id is not null then
  select*into r from public.bi_csv_imports where id=p_id and property_id=p_property_id and org_id=organization;if not found then return'{"state":"not_found"}';end if;
  if p_kind='history'then return jsonb_build_object('state','ready','id',p_id,'propertyId',p_property_id,'canManage',manager,'record',(to_jsonb(r)-array['preview','target_before','target_after'])||jsonb_build_object('preview',r.preview-'rows','rows',jsonb_array_length(r.preview->'rows'),'beforeCount',jsonb_array_length(r.target_before),'afterCount',jsonb_array_length(r.target_after)));end if;
  if p_kind='decisions'then select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]')into items from public.bi_csv_commands x where x.import_id=p_id and x.property_id=p_property_id;
  else items:=case p_kind when'rows'then r.preview->'rows'when'before'then r.target_before else r.target_after end;end if;
  items:=coalesce(items,'[]');hash_value:=public.knowledge_hash(items);count_value:=jsonb_array_length(items);
  if p_hash is not null and p_hash<>hash_value then return'{"state":"history_changed"}';end if;
  select coalesce(jsonb_agg(value order by ordinality),'[]')into items from jsonb_array_elements(items)with ordinality where ordinality>p_offset and ordinality<=p_offset+25;
 else
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,state,decided_at)order by created_at desc,id desc),'[]'))into count_value,hash_value from public.bi_csv_imports where property_id=p_property_id and org_id=organization;
  if p_hash is not null and p_hash<>hash_value then return'{"state":"history_changed"}';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id desc),'[]')into items from(select id,state,original->>'filename'as filename,preview->>'kind'as kind,created_at,decided_at,parent_id from public.bi_csv_imports where property_id=p_property_id and org_id=organization order by created_at desc,id desc offset p_offset limit 25)x;
 end if;
 return jsonb_build_object('state','ready','id',p_id,'propertyId',p_property_id,'canManage',manager,'items',items,'count',count_value,'hash',hash_value,'offset',p_offset);
end$$;

revoke all on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.guard_bi_csv_records(),public.bi_csv_targets(uuid,jsonb),public.record_bi_csv_action(uuid,uuid,uuid,text,uuid,jsonb),public.prepare_bi_csv(uuid,uuid,uuid,jsonb,jsonb,uuid,boolean),public.decide_bi_csv(uuid,uuid,uuid,uuid,jsonb),public.read_bi_csv(uuid,uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.append_shared_action_event(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.guard_bi_csv_records(),public.bi_csv_targets(uuid,jsonb),public.record_bi_csv_action(uuid,uuid,uuid,text,uuid,jsonb),public.prepare_bi_csv(uuid,uuid,uuid,jsonb,jsonb,uuid,boolean),public.decide_bi_csv(uuid,uuid,uuid,uuid,jsonb),public.read_bi_csv(uuid,uuid,uuid,uuid,text,integer,text) to service_role;
notify pgrst,'reload schema';
