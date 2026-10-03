create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('lead.record.created','lead.record.edited','lead.record.status_changed','lead.record.followup_started','lead.record.crm_prepared','lead.record.request_cancelled','pipeline.import.requested','pipeline.import.retry_requested','pipeline.import.stopped','pipeline.import.progress_reviewed','pipeline.import.request_cancelled','bi.alert.review_prepared','bi.alert.reviewed','bi.alert.dismissed','bi.alert.restored','bi.alert.request_cancelled','bi.query.requested','bi.query.plan_revised','bi.query.executed','bi.query.stopped','bi.query.request_cancelled','bi.goal.saved','bi.goal.archived','bi.goal.restored','bi.goal.request_cancelled','bi.schedule.created','bi.schedule.edited','bi.schedule.paused','bi.schedule.resumed','bi.schedule.cancelled','bi.schedule.run_closed','bi.schedule.request_cancelled','bi.report.saved','bi.report.cancelled','bi.export.prepared','bi.export.reported','readiness.built','readiness.approved','readiness.rejected','readiness.withdrawn','readiness.cancelled','neighborhood.saved','neighborhood.approved','neighborhood.rejected','neighborhood.withdrawn','neighborhood.archived','neighborhood.restored','neighborhood.cancelled','legal.saved','legal.approved','legal.rejected','legal.withdrawn','legal.cancelled','checklist.created','checklist.saved','checklist.archived','checklist.restored','checklist.setup_completed','checklist.cancelled','organization.setup.completed','knowledge.web.policy_saved','knowledge.web.requested','knowledge.web.recovered','knowledge.web.stopped','knowledge.web.reviewed','knowledge.web.download_prepared','property.unit.draft_saved','property.unit.approved','property.unit.draft_rejected','property.unit.retired','property.unit.restored','knowledge.file.upload_requested','knowledge.file.upload_stopped','knowledge.file.recovered','knowledge.file.extraction_requested','knowledge.file.extraction_stopped','knowledge.file.extraction_recovered','knowledge.file.reviewed','knowledge.file.download_prepared','knowledge.facts.prepared','knowledge.facts.edited','knowledge.facts.published','knowledge.facts.withdrawn','knowledge.decision.cancelled','knowledge.source.saved','knowledge.search.requested','knowledge.search.stopped','knowledge.search.recovered','knowledge.source.published','knowledge.source.withdrawn','property.created','property.onboarding.completed','property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
-- Human lead changes retain exact reviewed values; public/system writers keep their own delivery paths.
alter table public.leads add column record_revision integer not null default 1;
create table public.lead_record_commands(id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),lead_id uuid references public.leads(id)on delete cascade,input jsonb not null,before_state jsonb,after_state jsonb,result jsonb not null,created_at timestamptz not null default clock_timestamp());
create index lead_record_commands_property on public.lead_record_commands(property_id,created_at desc,id desc);
create index lead_record_commands_org on public.lead_record_commands(org_id);
create index lead_record_commands_actor on public.lead_record_commands(actor_id);
create index lead_record_commands_lead on public.lead_record_commands(lead_id,created_at desc,id desc);
alter table public.lead_record_commands enable row level security;
revoke all on public.lead_record_commands from public,anon,authenticated;
grant all on public.lead_record_commands to service_role;
create policy lead_record_commands_service on public.lead_record_commands for all to service_role using(true)with check(true);
create function public.lead_record_view(p_lead jsonb)returns jsonb language sql immutable security invoker set search_path=''as $$
 select jsonb_build_object('id',p_lead->'id','property_id',p_lead->'property_id','first_name',coalesce(p_lead->>'first_name',''),'last_name',coalesce(p_lead->>'last_name',''),'email',p_lead->'email','phone',p_lead->'phone','source',coalesce(p_lead->>'source','unknown'),'status',p_lead->'status','notes',p_lead->'notes','move_in_date',p_lead->'move_in_date','bedrooms',p_lead->'bedrooms','score',p_lead->'score','score_bucket',p_lead->'score_bucket','created_at',p_lead->'created_at','updated_at',p_lead->'updated_at','last_contacted_at',p_lead->'last_contacted_at','crm_sync_status',p_lead->'crm_sync_status','external_crm_id',p_lead->'external_crm_id','crm_synced_at',p_lead->'crm_synced_at','record_revision',p_lead->'record_revision');
$$;
create function public.lead_record_fields_valid(p_fields jsonb)returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare k text;v text;d date;
begin
 if jsonb_typeof(p_fields)is distinct from'object'or not(p_fields?&array['firstName','lastName','email','phone','source','bedrooms','moveInDate','notes'])or p_fields-array['firstName','lastName','email','phone','source','bedrooms','moveInDate','notes']<>'{}'then return false;end if;
 foreach k in array array['firstName','lastName','email','phone','source','bedrooms','moveInDate','notes']loop
  if jsonb_typeof(p_fields->k)is distinct from'string'then return false;end if;v:=p_fields->>k;
  if length(v)>(case when k='notes'then 8000 when k='email'then 254 when k='phone'then 40 when k='bedrooms'then 40 when k='moveInDate'then 10 else 120 end)then return false;end if;
 end loop;
 if length(btrim(p_fields->>'firstName'))=0 or length(btrim(p_fields->>'lastName'))=0 or length(btrim(p_fields->>'source'))=0 then return false;end if;
 if nullif(btrim(p_fields->>'email'),'')is null and nullif(btrim(p_fields->>'phone'),'')is null then return false;end if;
 if nullif(btrim(p_fields->>'email'),'')is not null and btrim(p_fields->>'email')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then return false;end if;
 if nullif(btrim(p_fields->>'phone'),'')is not null and(btrim(p_fields->>'phone')!~'^[+0-9(). x-]+$'or length(regexp_replace(p_fields->>'phone','[^0-9]','','g'))not between 7 and 20)then return false;end if;
 if p_fields->>'moveInDate'<>''then begin d:=(p_fields->>'moveInDate')::date;if d::text<>p_fields->>'moveInDate'or d<'1900-01-01'or d>'2100-12-31'then return false;end if;exception when others then return false;end;end if;return true;
end$$;
create function public.guard_lead_record()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_table_name='lead_record_commands'then
  if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Lead history follows property retention';end if;
  if tg_op='UPDATE'then raise exception 'Lead decisions are immutable';end if;
  if current_setting('p11.lead_record_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded lead decision';end if;return new;
 end if;
 if tg_op='INSERT'then
  if current_user='authenticated'and current_setting('p11.lead_record_scope',true)is distinct from new.property_id::text then raise exception 'Use a recorded lead decision';end if;new.record_revision:=1;
 else
  if(new.property_id,new.first_name,new.last_name,new.email,new.phone,new.source,new.status,new.notes,new.bedrooms,new.move_in_date,new.last_contacted_at)is distinct from(old.property_id,old.first_name,old.last_name,old.email,old.phone,old.source,old.status,old.notes,old.bedrooms,old.move_in_date,old.last_contacted_at)then
   if current_user='authenticated'and current_setting('p11.lead_record_scope',true)is distinct from old.property_id::text then raise exception 'Use a recorded lead decision';end if;new.record_revision:=old.record_revision+1;
  else new.record_revision:=old.record_revision;end if;
 end if;return new;
end$$;
create trigger lead_record_revision_guard before insert or update on public.leads for each row execute function public.guard_lead_record();
create trigger lead_record_commands_guard before insert or update or delete on public.lead_record_commands for each row execute function public.guard_lead_record();
create function public.lead_followup_context(p_property_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('workflows',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'steps',steps,'updatedAt',updated_at)order by id),'[]'),'hash',public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,name,steps,updated_at)order by id),'[]')))from public.workflow_definitions where property_id=p_property_id and trigger_on='lead_created'and is_active and public.valid_followup_steps(steps);
$$;
create function public.lead_contact_matches(p_property_id uuid,p_lead_id uuid,p_fields jsonb)returns jsonb language sql stable security invoker set search_path=''as $$
 with matches as(select l.id,l.record_revision,l.first_name,l.last_name,l.email,l.phone from public.leads l where l.property_id=p_property_id and(l.id is distinct from p_lead_id)and((nullif(btrim(p_fields->>'email'),'')is not null and lower(btrim(l.email))=lower(btrim(p_fields->>'email')))or(nullif(regexp_replace(p_fields->>'phone','[^0-9]','','g'),'')is not null and regexp_replace(l.phone,'[^0-9]','','g')=regexp_replace(p_fields->>'phone','[^0-9]','','g'))))
 select jsonb_build_object('count',(select count(*)from matches),'hash',public.knowledge_hash(coalesce((select jsonb_agg(to_jsonb(m)order by id)from matches m),'[]')),'items',coalesce((select jsonb_agg(to_jsonb(m)order by id)from(select*from matches order by id limit 20)m),'[]'));
$$;
create function public.decide_lead_record(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;member_role text;c public.lead_record_commands;l public.leads;v_lead uuid;kind text:=p_input->>'operation';v_fields jsonb;v_before jsonb;v_after jsonb;v_result jsonb;v_action text;matches jsonb;context jsonb;wf_ids uuid[];w public.workflow_definitions;enrolled jsonb:='[]';stopped jsonb:='[]';lw public.lead_workflows;r jsonb;crm jsonb;v_status text;
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;
 if not found or member_role is null or member_role not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,961));select*into c from public.lead_record_commands where id=p_id;
 if found then
  if(c.property_id,c.org_id,c.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return'{"state":"not_found"}';end if;
  if c.lead_id is not null and not exists(select 1 from public.leads where id=c.lead_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;
  if kind='cancel_request'or c.input->>'operation'='cancel_request'then return c.result||'{"state":"replayed"}';end if;
  if c.input<>p_input then return'{"state":"request_conflict"}';end if;return c.result||'{"state":"replayed"}';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,11));perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if kind='cancel_request'then
  if p_input-array['operation']<>'{}'then return'{"state":"invalid_input"}';end if;v_action:='lead.record.request_cancelled';v_result:='{"status":"cancelled_request"}';
 else
  if kind not in('create','edit','status','start_followup','prepare_crm')or kind is null then return'{"state":"invalid_input"}';end if;
  if kind<>'create'then
   begin v_lead:=(p_input->>'leadId')::uuid;exception when others then return'{"state":"invalid_input"}';end;
   if coalesce(p_input->>'revision','')!~'^[0-9]{1,9}$'then return'{"state":"invalid_input"}';end if;
   select*into l from public.leads where id=v_lead and property_id=p_property_id for update;if not found then return'{"state":"not_found"}';end if;
   if l.record_revision<>(p_input->>'revision')::integer then return'{"state":"lead_changed"}';end if;v_before:=public.lead_record_view(to_jsonb(l));
  end if;
  if kind in('create','edit')then
   if p_input-array['operation','fields','leadId','revision','duplicateHash','duplicateReason','workflowIds','workflowHash','prepareCrm']<>'{}'or not public.lead_record_fields_valid(p_input->'fields')or jsonb_typeof(p_input->'duplicateReason')is distinct from'string'or length(p_input->>'duplicateReason')>2000 then return'{"state":"invalid_input"}';end if;
   if kind='edit'and(p_input?'workflowIds'or p_input?'workflowHash'or p_input?'prepareCrm')then return'{"state":"invalid_input"}';end if;
   if kind='create'and(p_input?'leadId'or p_input?'revision'or jsonb_typeof(p_input->'prepareCrm')is distinct from'boolean')then return'{"state":"invalid_input"}';end if;
   v_fields:=p_input->'fields';matches:=public.lead_contact_matches(p_property_id,v_lead,v_fields);
   if(matches->>'count')::integer>0 and(p_input->>'duplicateHash'is distinct from matches->>'hash'or length(btrim(p_input->>'duplicateReason'))=0)then return jsonb_build_object('state','contact_conflict','matches',matches);end if;
  end if;
  if kind in('create','start_followup')then
   if kind='start_followup'and(p_input-array['operation','leadId','revision','workflowIds','workflowHash']<>'{}'or l.status in('leased','lost'))then return'{"state":"invalid_input"}';end if;
   if jsonb_typeof(p_input->'workflowIds')is distinct from'array'or jsonb_array_length(p_input->'workflowIds')>10 then return'{"state":"invalid_input"}';end if;
   begin select array_agg(value::uuid order by value)into wf_ids from jsonb_array_elements_text(p_input->'workflowIds');exception when others then return'{"state":"invalid_input"}';end;
   if coalesce(cardinality(wf_ids),0)<>(select count(distinct x)from unnest(wf_ids)x)or(kind='start_followup'and coalesce(cardinality(wf_ids),0)=0)then return'{"state":"invalid_input"}';end if;
   if cardinality(wf_ids)>0 then
    perform 1 from public.workflow_definitions where property_id=p_property_id for share;context:=public.lead_followup_context(p_property_id);
    if p_input->>'workflowHash'is distinct from context->>'hash'or exists(select 1 from unnest(wf_ids)x where not exists(select 1 from jsonb_array_elements(context->'workflows')v where v->>'id'=x::text))then return'{"state":"followup_changed"}';end if;
    if kind='start_followup'and exists(select 1 from public.lead_workflows where lead_id=l.id and status in('active','paused'))then return'{"state":"followup_open"}';end if;
   end if;
  end if;
  if kind='status'then
   if p_input-array['operation','leadId','revision','status','reason']<>'{}'or coalesce(p_input->>'status','')not in('new','contacted','tour_booked','toured','leased','lost')or jsonb_typeof(p_input->'reason')is distinct from'string'or length(p_input->>'reason')>2000 then return'{"state":"invalid_input"}';end if;v_status:=p_input->>'status';
  end if;
  if kind='prepare_crm'and p_input-array['operation','leadId','revision']<>'{}'then return'{"state":"invalid_input"}';end if;
  perform set_config('p11.lead_record_scope',p_property_id::text,true);
  if kind='create'then
   insert into public.leads(id,property_id,first_name,last_name,email,phone,source,status,notes,bedrooms,move_in_date)values(p_id,p_property_id,btrim(v_fields->>'firstName'),btrim(v_fields->>'lastName'),nullif(btrim(v_fields->>'email'),''),nullif(btrim(v_fields->>'phone'),''),btrim(v_fields->>'source'),'new',nullif(btrim(v_fields->>'notes'),''),nullif(btrim(v_fields->>'bedrooms'),''),nullif(v_fields->>'moveInDate','')::date)returning*into l;v_lead:=l.id;v_action:='lead.record.created';
  elsif kind='edit'then
   update public.leads set first_name=btrim(v_fields->>'firstName'),last_name=btrim(v_fields->>'lastName'),email=nullif(btrim(v_fields->>'email'),''),phone=nullif(btrim(v_fields->>'phone'),''),source=btrim(v_fields->>'source'),notes=nullif(btrim(v_fields->>'notes'),''),bedrooms=nullif(btrim(v_fields->>'bedrooms'),''),move_in_date=nullif(v_fields->>'moveInDate','')::date,updated_at=clock_timestamp()where id=l.id returning*into l;v_action:='lead.record.edited';
  elsif kind='status'then
   if v_status in('leased','lost')then
    for lw in select*from public.lead_workflows where lead_id=l.id and status in('active','paused')order by id for update loop
     r:=public.control_lead_workflow(p_property_id,l.id,lw.id,p_actor_id,'stop');if r->>'state'<>'applied'then raise exception 'Follow-up stop could not be confirmed';end if;
     stopped:=stopped||jsonb_build_array(jsonb_build_object('id',lw.id,'beforeStatus',lw.status,'afterStatus','stopped','nextActionAt',lw.next_action_at));
    end loop;
   end if;
   update public.leads set status=v_status,last_contacted_at=case when v_status='contacted'and status is distinct from'contacted'then clock_timestamp()else last_contacted_at end,updated_at=clock_timestamp()where id=l.id returning*into l;v_action:='lead.record.status_changed';
  elsif kind='start_followup'then v_action:='lead.record.followup_started';
  else v_action:='lead.record.crm_prepared';end if;
  if kind in('create','start_followup')and cardinality(wf_ids)>0 then
   for w in select*from public.workflow_definitions where id=any(wf_ids)order by id loop
    insert into public.lead_workflows(lead_id,workflow_id,current_step,status,next_action_at)values(l.id,w.id,0,'active',clock_timestamp()+make_interval(secs=>(greatest(0,coalesce((w.steps->0->>'delay_hours')::numeric,0))*3600)::integer))returning*into lw;
    enrolled:=enrolled||jsonb_build_array(jsonb_build_object('id',lw.id,'definitionId',w.id,'name',w.name,'steps',w.steps,'nextActionAt',lw.next_action_at));
   end loop;
  end if;
  if kind='prepare_crm'or(kind='create'and(p_input->>'prepareCrm')::boolean)then crm:=public.request_crm_handoff(p_property_id,l.id,'lead-record/'||p_id::text,'operator',p_actor_id);end if;
  -- Delivery remains a separate approved/recoverable workflow. This operation does not send.
  select*into l from public.leads where id=l.id;v_after:=jsonb_build_object('lead',public.lead_record_view(to_jsonb(l)),'startedFollowups',enrolled,'stoppedFollowups',stopped,'crmPreparation',crm,'reviewedMatches',case when coalesce((matches->>'count')::integer,0)>0 then matches else null end);
  v_result:=jsonb_build_object('status','saved','lead',public.lead_record_view(to_jsonb(l)),'startedFollowups',jsonb_array_length(enrolled),'stoppedFollowups',jsonb_array_length(stopped),'crmPreparation',crm);
 end if;
 v_result:=v_result||jsonb_build_object('state','saved','propertyId',p_property_id,'id',p_id,'leadId',v_lead);
 perform set_config('p11.lead_record_scope',p_property_id::text,true);
 insert into public.lead_record_commands(id,property_id,org_id,actor_id,lead_id,input,before_state,after_state,result)values(p_id,p_property_id,organization,p_actor_id,v_lead,p_input,v_before,v_after,v_result);
 if public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'tourspark',v_action,'server_confirmed','succeeded',jsonb_build_object('leadId',v_lead),null,null,jsonb_build_object('commandId',p_id,'operation',kind,'startedFollowups',jsonb_array_length(enrolled),'stoppedFollowups',jsonb_array_length(stopped)),'{}')->>'state'not in('recorded','replayed')then raise exception 'Lead action unavailable';end if;return v_result;
end$$;
create function public.read_lead_records(p_actor_id uuid,p_property_id uuid,p_input jsonb)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;member_role text;kind text:=coalesce(p_input->>'kind','list');v_offset integer:=coalesce((p_input->>'offset')::integer,0);v_limit integer:=coalesce((p_input->>'limit')::integer,25);v_page integer:=coalesce((p_input->>'page')::integer,1);v_search text:=btrim(coalesce(p_input->>'search',''));v_status text:=nullif(p_input->>'status','all');v_source text:=nullif(p_input->>'source','all');v_sort text:=coalesce(p_input->>'sortBy','created_at');v_order text:=coalesce(p_input->>'sortOrder','desc');l public.leads;c public.lead_record_commands;v_items jsonb;v_count integer;v_hash text;v_sources jsonb;v_summary jsonb;
begin
 select p.org_id,a.role into organization,member_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return'{"state":"forbidden"}';end if;
 if kind='command'then
  select*into c from public.lead_record_commands where id=(p_input->>'id')::uuid and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;
  if c.lead_id is not null and not exists(select 1 from public.leads where id=c.lead_id and property_id=p_property_id)then return'{"state":"not_found"}';end if;return c.result||'{"state":"ready"}';
 elsif kind='context'then
  return jsonb_build_object('state','ready','propertyId',p_property_id,'followup',public.lead_followup_context(p_property_id),'canManage',coalesce(member_role in('admin','manager'),false));
 elsif kind in('lead','history')then
  select*into l from public.leads where id=(p_input->>'id')::uuid and property_id=p_property_id;if not found then return'{"state":"not_found"}';end if;
  if kind='lead'then return jsonb_build_object('state','ready','propertyId',p_property_id,'lead',public.lead_record_view(to_jsonb(l)),'followup',public.lead_followup_context(p_property_id),'canManage',coalesce(member_role in('admin','manager'),false));end if;
  if v_offset<0 then return'{"state":"invalid_input"}';end if;
  select count(*),public.knowledge_hash(coalesce(jsonb_agg(id order by created_at desc,id desc),'[]'))into v_count,v_hash from public.lead_record_commands where property_id=p_property_id and org_id=organization and lead_id=l.id;
  select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]')into v_items from(select to_jsonb(cmd)||jsonb_build_object('actorName',coalesce(member.full_name,'Team member'))value,cmd.created_at,cmd.id from public.lead_record_commands cmd left join public.profiles member on member.id=cmd.actor_id where cmd.property_id=p_property_id and cmd.org_id=organization and cmd.lead_id=l.id order by cmd.created_at desc,cmd.id desc offset v_offset limit 20)x;
  if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'items',v_items,'count',v_count,'hash',v_hash,'offset',v_offset,'canManage',coalesce(member_role in('admin','manager'),false));
 elsif kind<>'list'then return'{"state":"invalid_input"}';end if;
 if v_page<1 or v_page>1000000 or v_limit not between 1 and 100 or length(v_search)>200 or v_sort not in('created_at','updated_at','first_name','last_name','status','source')or v_order not in('asc','desc')then return'{"state":"invalid_input"}';end if;
 select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,record_revision)order by id),'[]'))into v_count,v_hash from public.leads where property_id=p_property_id and(v_status is null or status=v_status)and(v_source is null or source=v_source)and(v_search=''or position(lower(v_search)in lower(concat_ws(' ',first_name,last_name,email,phone)))>0);
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>v_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(value order by position_n),'[]')into v_items from(select public.lead_record_view(to_jsonb(row))value,row_number()over()position_n from(select*from public.leads where property_id=p_property_id and(v_status is null or status=v_status)and(v_source is null or source=v_source)and(v_search=''or position(lower(v_search)in lower(concat_ws(' ',first_name,last_name,email,phone)))>0)order by
  case when v_order='asc'then case v_sort when'created_at'then created_at::text when'updated_at'then coalesce(updated_at,created_at)::text when'first_name'then lower(first_name)when'last_name'then lower(last_name)when'status'then status else source end end asc nulls last,
  case when v_order='desc'then case v_sort when'created_at'then created_at::text when'updated_at'then coalesce(updated_at,created_at)::text when'first_name'then lower(first_name)when'last_name'then lower(last_name)when'status'then status else source end end desc nulls last,id
  offset(v_page-1)*v_limit limit v_limit)row)x;
 select coalesce(jsonb_agg(source order by source),'[]')into v_sources from(select distinct source from public.leads where property_id=p_property_id and nullif(source,'')is not null)x;
 select coalesce(jsonb_object_agg(status,n),'{}')into v_summary from(select coalesce(status,'unknown')status,count(*)n from public.leads where property_id=p_property_id group by coalesce(status,'unknown'))x;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'leads',v_items,'hash',v_hash,'pagination',jsonb_build_object('page',v_page,'limit',v_limit,'total',v_count,'totalPages',ceil(v_count::numeric/v_limit)),'filters',jsonb_build_object('sources',v_sources,'statuses',jsonb_build_array('new','contacted','tour_booked','toured','leased','lost')),'statusSummary',v_summary,'canManage',coalesce(member_role in('admin','manager'),false));
end$$;

revoke all on function public.lead_record_view(jsonb)from public,anon,authenticated;
grant execute on function public.lead_record_view(jsonb)to service_role;
revoke all on function public.lead_record_fields_valid(jsonb)from public,anon,authenticated;
grant execute on function public.lead_record_fields_valid(jsonb)to service_role;
revoke all on function public.guard_lead_record()from public,anon,authenticated;
grant execute on function public.guard_lead_record()to service_role;
revoke all on function public.lead_followup_context(uuid)from public,anon,authenticated;
grant execute on function public.lead_followup_context(uuid)to service_role;
revoke all on function public.lead_contact_matches(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.lead_contact_matches(uuid,uuid,jsonb)to service_role;
revoke all on function public.decide_lead_record(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.decide_lead_record(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_lead_records(uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.read_lead_records(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';

-- This guard also protects property-only CRM receipts, which have no org_id column.
create or replace function public.protect_shared_action_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'then
  if old.property_id is not null then
   if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
  elsif tg_table_name in('shared_action_events','shared_action_episodes')then
   if not exists(select 1 from public.organizations where id=old.org_id)then return old;end if;
  end if;
 end if;
 raise exception 'Action history is immutable'using errcode='55000';
end$$;
