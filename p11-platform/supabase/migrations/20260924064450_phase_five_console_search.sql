BEGIN;
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.search.saved','console.search.result_selected','console.search.navigation_prepared','console.search.request_cancelled','luma.conversation.taken_over','luma.conversation.released','luma.conversation.replied','luma.conversation.archived','luma.conversation.restored','luma.conversation.reviewed','luma.conversation.export_prepared','luma.conversation.export_reported','luma.conversation.request_cancelled','luma.widget.key_rotated','luma.widget.logo_selected','luma.widget.logo_cleared','luma.widget.installation_prepared','luma.widget.installation_reported','luma.widget.request_cancelled','bi.data.review_saved','bi.data.row_excluded','bi.data.row_restored','bi.data.export_prepared','bi.data.export_reported','bi.data.request_cancelled','bi.csv.preview_saved','bi.csv.applied','bi.csv.discarded','bi.csv.request_cancelled','audit.analysis.requested','audit.analysis.retried','audit.analysis.cancelled','audit.analysis.stopped','audit.analysis.discarded','audit.analysis.resumed','audit.analysis.applied','audit.evaluation.requested','audit.evaluation.cancelled','audit.evaluation.applied','audit.evaluation.discarded','audit.report.requested','audit.report.prepared','audit.report.cancelled','audit.report.reported','audit.report.download_prepared','audit.crawl_stopped','audit.crawl_retry_requested','audit.queries_created','audit.query_edited','audit.queries_archived','audit.queries_restored','audit.finding_reviewed','audit.recommendation_reviewed','audit.runs_requested','audit.run_stopped','audit.run_archived','audit.run_restored','audit.run_retry_requested','audit.run_reviewed','audit.request_cancelled','lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action like 'console.search.%'then
  if p_product<>'platform'or p_evidence<>'server_confirmed'or p_phase<>'succeeded'then raise exception 'Invalid search evidence';end if;
 elsif p_action like 'luma.conversation.%'then
  if p_product<>'lumaleasing'or(p_action='luma.conversation.export_reported'and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action<>'luma.conversation.export_reported'and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid conversation evidence';end if;
 elsif p_action like 'luma.widget.%'then
  if p_product<>'lumaleasing'or(p_action='luma.widget.installation_reported'and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action<>'luma.widget.installation_reported'and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid widget decision evidence';end if;
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
  if p_product<>'bi' or(p_action in('bi.export.reported','bi.data.export_reported')and(p_evidence<>'browser_observed'or p_phase<>'observed'))or(p_action not in('bi.export.reported','bi.data.export_reported')and(p_evidence<>'server_confirmed'or p_phase<>'succeeded'))then raise exception 'Invalid BI report evidence';end if;
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
 origin:=case when p_action like 'console.search.%'then'console'when p_action like 'luma.conversation.%'then'console'when p_action like 'luma.widget.%'then'console'when p_action like 'audit.%'then'console' when p_action like 'bi.%'then'console' when p_action like 'legal.%'then'console'when p_action like 'checklist.%'then'console'when p_action like 'property.unit.%'then'console'when p_action like 'knowledge.%' then 'console' when p_action in('property.setup.saved','property.created','property.onboarding.completed') then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create table public.console_search_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null,input jsonb not null,sources jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.console_search_commands enable row level security;
revoke all on public.console_search_commands from public,anon,authenticated;
grant all on public.console_search_commands to service_role;
create index console_search_history on public.console_search_commands(property_id,actor_id,created_at desc,id desc);
create function public.guard_console_search_command()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
 if tg_op<>'INSERT'then raise exception 'Saved search evidence is immutable';end if;
 if current_setting('p11.console_search_scope',true)is distinct from new.property_id::text or not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=new.property_id and p.org_id=new.org_id and u.id=new.actor_id)then raise exception 'Recorded search scope required';end if;
 return new;
end$$;
create trigger recorded_console_search before insert or update or delete on public.console_search_commands for each row execute function public.guard_console_search_command();

create function public.console_search_source(p_property_id uuid,p_kind text,p_id uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare source jsonb;
begin
 if p_kind='lead'then select jsonb_build_object('id',l.id,'name',btrim(concat_ws(' ',l.first_name,l.last_name)),'email',l.email,'phone',l.phone,'status',l.status,'revision',l.record_revision)into source from public.leads l where l.id=p_id and l.property_id=p_property_id;
 elsif p_kind='property'then select jsonb_build_object('id',p.id,'name',p.name)into source from public.properties p where p.id=p_id and p.id=p_property_id;
 elsif p_kind='material'then select jsonb_build_object('id',m.id,'versionId',v.id,'title',v.title,'content',v.content,'contentHash',v.content_hash,'publication',case when m.active_version_id=v.id then'published'else'not published'end)into source from public.knowledge_materials m join public.knowledge_material_versions v on v.id=m.latest_version_id and v.property_id=m.property_id where m.id=p_id and m.property_id=p_property_id;
 elsif p_kind='document'then select jsonb_build_object('id',d.id,'title',coalesce(nullif(d.metadata->>'title',''),nullif(d.metadata->>'source',''),'Stored knowledge text'),'content',d.content,'groupKey',public.knowledge_document_group(d.metadata,d.id),'createdAt',d.created_at)into source from public.documents d where d.id=p_id and d.property_id=p_property_id;
 elsif p_kind='conversation'then source:=public.luma_conversation_source(p_property_id,p_id);
 end if;
 return source;
end$$;

create function public.decide_console_search(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;saved_command public.console_search_commands;search_command public.console_search_commands;op text:=p_input->>'operation';q text;filter text;items jsonb;item jsonb;source jsonb;current_source jsonb;result jsonb;event jsonb;action text;key text;resource_kind text;resource_id uuid;url text;
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;if organization is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op is null or op not in('search','select','navigate','cancel')or length(p_input::text)>3000 then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,995));select*into saved_command from public.console_search_commands where id=p_id;
 if found then
  if saved_command.property_id<>p_property_id or saved_command.actor_id<>p_actor_id then return'{"state":"not_found"}';end if;
  if saved_command.input->>'operation'='cancel'or op='cancel'then return saved_command.result;end if;
  if saved_command.input<>p_input then return'{"state":"request_conflict"}';end if;return saved_command.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));perform set_config('p11.console_search_scope',p_property_id::text,true);
 if op='cancel'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;
  result:=jsonb_build_object('status','cancelled');action:='request_cancelled';
 elsif op='search'then
  q:=btrim(p_input->>'query');filter:=p_input->>'filter';
  if q is null or length(q)<2 or length(q)>200 or filter not in('all','lead','property','knowledge','conversation')or filter is null or p_input-array['operation','query','filter']<>'{}'then return'{"state":"invalid_input"}';end if;
  -- Literal matching deliberately gives %, _, commas and parentheses no filter syntax.
  with candidates as(
   select 'lead'as kind,l.id from public.leads l where l.property_id=p_property_id and filter in('all','lead')and strpos(lower(concat_ws(' ',l.first_name,l.last_name,l.email,l.phone)),lower(q))>0
   union all select 'property',p.id from public.properties p where p.id=p_property_id and filter in('all','property')and strpos(lower(p.name),lower(q))>0
   union all select 'material',m.id from public.knowledge_materials m join public.knowledge_material_versions v on v.id=m.latest_version_id and v.property_id=m.property_id where m.property_id=p_property_id and filter in('all','knowledge')and strpos(lower(v.title||' '||v.content),lower(q))>0
   union all select 'document',d.id from public.documents d where d.property_id=p_property_id and filter in('all','knowledge')and strpos(lower(coalesce(d.metadata->>'title','')||' '||coalesce(d.metadata->>'source','')||' '||coalesce(d.content,'')),lower(q))>0
   union all select 'conversation',c.id from public.conversations c left join public.leads l on l.id=c.lead_id and l.property_id=c.property_id where c.property_id=p_property_id and filter in('all','conversation')and(strpos(lower(concat_ws(' ',l.first_name,l.last_name,l.email)),lower(q))>0 or exists(select 1 from public.messages m where m.conversation_id=c.id and strpos(lower(coalesce(m.content,'')),lower(q))>0))
  ),bounded as(select*from candidates order by kind,id limit 2001)
  select coalesce(jsonb_agg(jsonb_build_object('key',kind||':'||id,'kind',kind,'id',id)order by kind,id),'[]')into items from bounded;
  if jsonb_array_length(items)>2000 then result:=jsonb_build_object('status','narrow_query','atLeast',2001);items:=null;
  else
   for item in select value from jsonb_array_elements(items)loop
    resource_kind:=item->>'kind';resource_id:=(item->>'id')::uuid;source:=public.console_search_source(p_property_id,resource_kind,resource_id);
    key:=item->>'key';
    items:=jsonb_set(items,array[(select(ordinal-1)::text from jsonb_array_elements(items)with ordinality t(value,ordinal)where value->>'key'=key)],item||jsonb_build_object('source',source,'sourceHash',encode(sha256(convert_to(source::text,'UTF8')),'hex'),'title',case when resource_kind='conversation'then coalesce(nullif(btrim(concat_ws(' ',source->'lead'->>'first_name',source->'lead'->>'last_name')),''),'Conversation')else coalesce(source->>'title',source->>'name')end));
    if octet_length(items::text)>2097152 then exit;end if;
   end loop;
   if octet_length(items::text)>2097152 then result:=jsonb_build_object('status','narrow_query','reason','Matching originals exceed the retained search size; narrow the query or type.');items:=null;
   else result:=jsonb_build_object('status','searched','count',jsonb_array_length(items),'complete',true,'definition','literal-v1');end if;
  end if;
  action:='saved';
 else
  if p_input-array['operation','searchId','key']<>'{}'or length(coalesce(p_input->>'key',''))>60 then return'{"state":"invalid_input"}';end if;
  begin select*into search_command from public.console_search_commands where id=(p_input->>'searchId')::uuid and actor_id=p_actor_id and property_id=p_property_id;exception when invalid_text_representation then return'{"state":"invalid_input"}';end;
  if search_command.result->>'status'is distinct from'searched'then return'{"state":"not_found"}';end if;
  select value into item from jsonb_array_elements(search_command.sources)where value->>'key'=p_input->>'key';if item is null then return'{"state":"not_found"}';end if;
  resource_kind:=item->>'kind';resource_id:=(item->>'id')::uuid;current_source:=public.console_search_source(p_property_id,resource_kind,resource_id);source:=item->'source';
  items:=jsonb_build_array(item);result:=jsonb_build_object('status','selected','key',item->>'key','searchId',search_command.id,'current',current_source is not null and current_source=source,'available',current_source is not null);action:='result_selected';
  if op='navigate'then
   if current_source is null then return'{"state":"not_found"}';end if;
   url:=case resource_kind when'lead'then'/dashboard/leads?lead='||resource_id when'property'then'/dashboard/community'when'material'then'/dashboard/community?knowledgeSource='||resource_id||'&knowledgeVersion='||(source->>'versionId')when'document'then'/dashboard/community?knowledgeGroup='||(source->>'groupKey')when'conversation'then'/dashboard/lumaleasing?tab=conversations&conversation='||resource_id end;
   result:=result||jsonb_build_object('status','navigation_prepared','url',url);action:='navigation_prepared';
  end if;
 end if;
 result:=result||jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'actorId',p_actor_id);
 insert into public.console_search_commands(id,property_id,org_id,actor_id,input,sources,result)values(p_id,p_property_id,organization,p_actor_id,p_input,items,result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'platform','console.search.'||action,'server_confirmed','succeeded',jsonb_build_object('commandId',p_id),null,null,jsonb_build_object('status',result->>'status'));
 if event->>'state'not in('recorded','replayed')then raise exception 'Search action evidence failed';end if;
 return result;
end$$;

create function public.read_console_search(p_actor_id uuid,p_property_id uuid,p_kind text default'history',p_id uuid default null,p_offset integer default 0,p_hash text default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare selected public.console_search_commands;all_items jsonb;items jsonb;hash text;
begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id)then return'{"state":"forbidden"}';end if;
 if p_offset<0 or p_offset>100000 or p_kind not in('history','command','results')then return'{"state":"invalid_input"}';end if;
 if p_kind='history'then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'input',c.input,'status',c.result->>'status','createdAt',c.created_at)order by c.created_at desc,c.id desc),'[]')into all_items from public.console_search_commands c where c.property_id=p_property_id and c.actor_id=p_actor_id;
 else
  select*into selected from public.console_search_commands where id=p_id and property_id=p_property_id and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;
  if p_kind='command'then return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'command',to_jsonb(selected)-'sources','source',case when selected.input->>'operation'in('select','navigate')then selected.sources->0 else null end);end if;
  if selected.result->>'status'is distinct from'searched'then return'{"state":"not_found"}';end if;
  select coalesce(jsonb_agg(value-'source'),'[]')into all_items from jsonb_array_elements(selected.sources);
 end if;
 hash:=encode(sha256(convert_to(all_items::text,'UTF8')),'hex');if p_hash is not null and p_hash<>hash then return'{"state":"source_changed"}';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]')into items from jsonb_array_elements(all_items)with ordinality t(value,ordinal)where ordinal>p_offset and ordinal<=p_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'items',items,'total',jsonb_array_length(all_items),'offset',p_offset,'hash',hash,'complete',true,'search',case when p_kind='results'then jsonb_build_object('id',selected.id,'input',selected.input,'createdAt',selected.created_at)else null end);
end$$;
revoke all on function public.guard_console_search_command(),public.console_search_source(uuid,text,uuid),public.decide_console_search(uuid,uuid,uuid,jsonb),public.read_console_search(uuid,uuid,text,uuid,integer,text)from public,anon,authenticated;
grant execute on function public.console_search_source(uuid,text,uuid),public.decide_console_search(uuid,uuid,uuid,jsonb),public.read_console_search(uuid,uuid,text,uuid,integer,text)to service_role;

COMMIT;
