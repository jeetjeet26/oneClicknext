create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create table public.lead_note_records(
 id uuid primary key references public.lead_activities(id)on delete cascade,lead_id uuid not null references public.leads(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),author_id uuid references public.profiles(id),
 source_type text not null check(source_type in('recorded','legacy')),original_activity jsonb not null,content text not null,state text not null check(state in('active','withdrawn')),version integer not null default 1,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create index lead_note_lead on public.lead_note_records(lead_id);
create index lead_note_property on public.lead_note_records(property_id);
create index lead_note_org on public.lead_note_records(org_id);
create index lead_note_author on public.lead_note_records(author_id);
create table public.lead_note_decisions(
 id uuid primary key,decision_sequence bigint generated always as identity unique,note_id uuid not null references public.lead_note_records(id)on delete cascade,lead_id uuid not null references public.leads(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),action text not null,input jsonb not null,input_hash text not null,before_state jsonb,after_state jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index lead_note_decision_note on public.lead_note_decisions(note_id,decision_sequence desc);
create index lead_note_decision_lead on public.lead_note_decisions(lead_id);
create index lead_note_decision_property on public.lead_note_decisions(property_id);
create index lead_note_decision_org on public.lead_note_decisions(org_id);
create index lead_note_decision_actor on public.lead_note_decisions(actor_id);
alter table public.lead_note_records enable row level security;
alter table public.lead_note_decisions enable row level security;
revoke all on public.lead_note_records,public.lead_note_decisions,public.lead_activities from public,anon,authenticated;
grant all on public.lead_note_records,public.lead_note_decisions,public.lead_activities to service_role;
create policy lead_note_service on public.lead_note_records for all to service_role using(true)with check(true);
create policy lead_note_decision_service on public.lead_note_decisions for all to service_role using(true)with check(true);
revoke all on sequence public.lead_note_decisions_decision_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.lead_note_decisions_decision_sequence_seq to service_role;
create function public.guard_lead_note_record()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'then if not exists(select 1 from public.leads where id=old.lead_id)or not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Withdraw the note to retain its history';end if;
 if(new.id,new.lead_id,new.property_id,new.org_id,new.author_id,new.source_type,new.original_activity,new.created_at)is distinct from(old.id,old.lead_id,old.property_id,old.org_id,old.author_id,old.source_type,old.original_activity,old.created_at)then raise exception 'Original note identity and evidence are retained';end if;
 new.version:=old.version+1;new.updated_at:=clock_timestamp();return new;
end$$;
create trigger lead_note_record_guard before update or delete on public.lead_note_records for each row execute function public.guard_lead_note_record();
create function public.guard_lead_note_decision()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'and(not exists(select 1 from public.leads where id=old.lead_id)or not exists(select 1 from public.properties where id=old.property_id))then return old;end if;raise exception 'Note decisions are retained';end$$;
create trigger lead_note_decision_guard before update or delete on public.lead_note_decisions for each row execute function public.guard_lead_note_decision();
create function public.guard_tracked_lead_activity()returns trigger language plpgsql security invoker set search_path=''as $$declare note public.lead_note_records;begin
 if not exists(select 1 from public.leads where id=old.lead_id)then if tg_op='DELETE'then return old;end if;return new;end if;
 select *into note from public.lead_note_records where id=old.id;if not found then if tg_op='DELETE'then return old;end if;return new;end if;
 if not exists(select 1 from public.properties where id=note.property_id)then if tg_op='DELETE'then return old;end if;return new;end if;
 if tg_op='DELETE'then raise exception 'Withdraw the recorded note';end if;
 if(new.id,new.lead_id,new.type,new.created_by,new.created_at)is distinct from(old.id,old.lead_id,old.type,old.created_by,old.created_at)or new.description is distinct from(case when note.state='withdrawn'then 'Note withdrawn'else note.content end)or new.metadata is distinct from jsonb_build_object('noteRecordId',note.id,'noteVersion',note.version,'noteState',note.state)then raise exception 'Use the recorded note decision workflow';end if;return new;
end$$;
create trigger tracked_lead_activity_guard before update or delete on public.lead_activities for each row execute function public.guard_tracked_lead_activity();
create function public.save_lead_note(p_id uuid,p_property_id uuid,p_lead_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;actor_role text;prior public.lead_note_decisions;activity public.lead_activities;note public.lead_note_records;note_id uuid;kind text;before_state jsonb;v_after jsonb;v_result jsonb;event jsonb;begin
 select p.org_id,a.role into organization,actor_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 perform 1 from public.leads where id=p_lead_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from 'object'or octet_length(p_input::text)>100000 or length(trim(coalesce(p_input->>'reason','')))not between 3 and 2000 then raise exception 'Review the note and reason';end if;
 kind:=case p_input->>'action'when 'add'then 'lead.note.created'when 'correct'then 'lead.note.corrected'when 'withdraw'then 'lead.note.withdrawn'when 'restore'then 'lead.note.restored'end;if kind is null then raise exception 'Only recorded note decisions are accepted';end if;
 select *into prior from public.lead_note_decisions where id=p_id;if found then
  if(prior.property_id,prior.lead_id,prior.org_id,prior.actor_id,prior.action,prior.input_hash)is distinct from(p_property_id,p_lead_id,organization,p_actor_id,kind,public.crm_configuration_hash(p_input))then return '{"state":"request_conflict"}';end if;
  return prior.result||'{"state":"replayed"}';end if;
 if kind in('lead.note.created','lead.note.corrected')and(jsonb_typeof(p_input->'content')is distinct from 'string'or length(trim(p_input->>'content'))not between 1 and 16000)then raise exception 'Use a note between 1 and 16000 characters';end if;
 if kind='lead.note.created'then
  if(p_input-array['action','content','reason'])<>'{}'then raise exception 'Only note content and a reason may be saved';end if;
  note_id:=p_id;
  insert into public.lead_activities(id,lead_id,type,description,created_by,metadata)values(note_id,p_lead_id,'note',p_input->>'content',p_actor_id,jsonb_build_object('noteRecordId',note_id,'noteVersion',1,'noteState','active'))returning *into activity;
  insert into public.lead_note_records(id,lead_id,property_id,org_id,author_id,source_type,original_activity,content,state)values(note_id,p_lead_id,p_property_id,organization,p_actor_id,'recorded',to_jsonb(activity),p_input->>'content','active')returning *into note;
 else
  if(p_input-(case when kind='lead.note.corrected'then array['action','noteId','expectedVersion','sourceHash','content','reason']else array['action','noteId','expectedVersion','sourceHash','reason']end))<>'{}'then raise exception 'Review only this exact note decision';end if;
  note_id:=(p_input->>'noteId')::uuid;
  select *into activity from public.lead_activities where id=note_id and lead_id=p_lead_id for update;if not found then return '{"state":"not_found"}';end if;
  if activity.type<>'note'then return '{"state":"note_required"}';end if;
  select *into note from public.lead_note_records where id=note_id for update;
  if found and(note.property_id,note.org_id,note.lead_id)is distinct from(p_property_id,organization,p_lead_id)then return '{"state":"source_property_changed"}';end if;
  if activity.created_by is distinct from p_actor_id and coalesce(actor_role,'')not in('admin','manager')then return '{"state":"author_required"}';end if;
  if coalesce(note.version,0)is distinct from(p_input->>'expectedVersion')::integer or public.crm_configuration_hash(to_jsonb(activity))is distinct from p_input->>'sourceHash'then return '{"state":"stale_note"}';end if;
  if(kind in('lead.note.corrected','lead.note.withdrawn')and coalesce(note.state,'active')<>'active')or(kind='lead.note.restored'and coalesce(note.state,'active')<>'withdrawn')then return '{"state":"state_changed"}';end if;
  if note.id is null then
   insert into public.lead_note_records(id,lead_id,property_id,org_id,author_id,source_type,original_activity,content,state,version)values(note_id,p_lead_id,p_property_id,organization,activity.created_by,'legacy',to_jsonb(activity),activity.description,'active',0)returning *into note;
  end if;
  before_state:=jsonb_build_object('note',to_jsonb(note),'activity',to_jsonb(activity));
  update public.lead_note_records set content=case when kind='lead.note.corrected'then p_input->>'content'else content end,state=case when kind='lead.note.withdrawn'then 'withdrawn'else 'active'end where id=note.id returning *into note;
  update public.lead_activities set description=case when note.state='withdrawn'then 'Note withdrawn'else note.content end,metadata=jsonb_build_object('noteRecordId',note.id,'noteVersion',note.version,'noteState',note.state)where id=note.id returning *into activity;
 end if;
 v_after:=jsonb_build_object('note',to_jsonb(note),'activity',to_jsonb(activity));v_result:=jsonb_build_object('noteId',note.id,'version',note.version,'noteState',note.state,'sourceHash',public.crm_configuration_hash(to_jsonb(activity)),'externalDelivery',false);
 insert into public.lead_note_decisions(id,note_id,lead_id,property_id,org_id,actor_id,action,input,input_hash,before_state,after_state,result)values(p_id,note.id,p_lead_id,p_property_id,organization,p_actor_id,kind,p_input,public.crm_configuration_hash(p_input),before_state,v_after,v_result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'tourspark',kind,'server_confirmed','succeeded',jsonb_build_object('leadId',p_lead_id,'noteId',note.id,'inputHash',public.crm_configuration_hash(p_input)),case when before_state is not null then jsonb_build_object('version',before_state->'note'->'version','stateHash',public.crm_configuration_hash(before_state))end,jsonb_build_object('version',note.version,'stateHash',public.crm_configuration_hash(v_after)),v_result);
 if event->>'state'not in('recorded','replayed')then raise exception 'The note action could not be recorded';end if;
 return v_result||'{"state":"saved"}';
end$$;
create function public.read_lead_activity(p_property_id uuid,p_lead_id uuid,p_actor_id uuid,p_cursor uuid default null,p_note_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;actor_role text;anchor_id uuid;anchor_date timestamptz;anchor_sequence bigint;v_rows jsonb;v_counts jsonb;begin
 select p.org_id,a.role into organization,actor_role from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id)then return '{"state":"not_found"}';end if;
 if p_note_id is not null then
  if not exists(select 1 from public.lead_note_records where id=p_note_id and lead_id=p_lead_id and property_id=p_property_id and org_id=organization)then return '{"state":"not_found"}';end if;
  if p_cursor is not null then select d.decision_sequence into anchor_sequence from public.lead_note_decisions d where d.id=p_cursor and d.note_id=p_note_id and d.lead_id=p_lead_id and d.property_id=p_property_id and d.org_id=organization;if not found then return '{"state":"cursor_changed"}';end if;end if;
  select coalesce(jsonb_agg(x.value order by x.decision_sequence desc),'[]')into v_rows from(select d.decision_sequence,jsonb_build_object('id',d.id,'action',d.action,'reason',d.input->>'reason','beforeContent',d.before_state->'note'->>'content','afterContent',d.after_state->'note'->>'content','beforeState',d.before_state->'note'->>'state','afterState',d.after_state->'note'->>'state','version',d.after_state->'note'->'version','sourceType',d.after_state->'note'->>'source_type','createdAt',d.created_at,'actorName',a.full_name)value from public.lead_note_decisions d left join public.profiles a on a.id=d.actor_id where d.note_id=p_note_id and d.lead_id=p_lead_id and d.property_id=p_property_id and d.org_id=organization and(p_cursor is null or d.decision_sequence<anchor_sequence)order by d.decision_sequence desc limit 21)x;
  return jsonb_build_object('state','ready','history',case when jsonb_array_length(v_rows)>20 then v_rows-20 else v_rows end,'nextCursor',case when jsonb_array_length(v_rows)>20 then v_rows->19->>'id'end);
 end if;
 if p_cursor is not null then select a.id,a.created_at into anchor_id,anchor_date from public.lead_activities a where a.id=p_cursor and a.lead_id=p_lead_id;if not found then return '{"state":"cursor_changed"}';end if;end if;
 with all_rows as materialized(
  select a.*,n.property_id note_property,n.org_id note_org,n.version note_version,n.state note_state,n.source_type note_source,n.updated_at note_updated,actor.full_name actor_name
  from public.lead_activities a left join public.lead_note_records n on n.id=a.id left join public.profiles actor on actor.id=a.created_by where a.lead_id=p_lead_id
 ),page as(
  select a.id,a.created_at,jsonb_build_object('id',a.id,'type',a.type,'description',case when a.note_property is not null and(a.note_property,a.note_org)is distinct from(p_property_id,organization)then null else a.description end,'createdAt',a.created_at,'actorName',case when a.note_property is null or(a.note_property,a.note_org)=(p_property_id,organization)then a.actor_name end,'version',coalesce(a.note_version,0),'noteState',case when a.note_property is not null and(a.note_property,a.note_org)is distinct from(p_property_id,organization)then 'held'else coalesce(a.note_state,'active')end,'provenance',case when a.note_property is not null and(a.note_property,a.note_org)is distinct from(p_property_id,organization)then 'earlier_property'when a.note_version is not null then a.note_source when a.type='note'then 'earlier_note'else 'activity_record'end,'updatedAt',a.note_updated,'sourceHash',case when a.type='note'and(a.note_property is null or(a.note_property,a.note_org)=(p_property_id,organization))then public.crm_configuration_hash(to_jsonb(a)-array['note_property','note_org','note_version','note_state','note_source','note_updated','actor_name'])end,'canEdit',a.type='note'and(coalesce(a.created_by=p_actor_id,false)or coalesce(actor_role,'')in('admin','manager'))and(a.note_property is null or(a.note_property,a.note_org)=(p_property_id,organization)))value
  from all_rows a where p_cursor is null or(coalesce(a.created_at,'-infinity'::timestamptz),a.id)<(coalesce(anchor_date,'-infinity'::timestamptz),anchor_id)order by a.created_at desc nulls last,a.id desc limit 21
 )select(select coalesce(jsonb_agg(value order by created_at desc nulls last,id desc),'[]')from page),(select jsonb_build_object('all',count(*),'notes',count(*)filter(where type='note'),'withdrawn',count(*)filter(where note_state='withdrawn'and(note_property,note_org)=(p_property_id,organization)))from all_rows)into v_rows,v_counts;
 return jsonb_build_object('state','ready','activities',case when jsonb_array_length(v_rows)>20 then v_rows-20 else v_rows end,'nextCursor',case when jsonb_array_length(v_rows)>20 then v_rows->19->>'id'end,'counts',v_counts);
end$$;
revoke all on function public.guard_lead_note_record(),public.guard_lead_note_decision(),public.guard_tracked_lead_activity(),public.save_lead_note(uuid,uuid,uuid,uuid,jsonb),public.read_lead_activity(uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.guard_lead_note_record(),public.guard_lead_note_decision(),public.guard_tracked_lead_activity(),public.save_lead_note(uuid,uuid,uuid,uuid,jsonb),public.read_lead_activity(uuid,uuid,uuid,uuid,uuid)to service_role;

-- Authenticated console lead intake retains its existing duplicate-note window via a scoped server operation.
create function public.record_lead_return_note(p_property_id uuid,p_lead_id uuid,p_actor_id uuid,p_content text)returns jsonb language plpgsql security invoker set search_path=''as $$declare prior public.lead_note_decisions;begin
 if not exists(select 1 from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id)then return '{"state":"forbidden"}';end if;
 perform 1 from public.leads where id=p_lead_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 select d.*into prior from public.lead_note_decisions d join public.lead_note_records n on n.id=d.note_id where d.property_id=p_property_id and d.lead_id=p_lead_id and d.actor_id=p_actor_id and d.action='lead.note.created'and d.input->>'reason'='Record repeated console lead submission'and d.input->>'content'=p_content and n.state='active'and n.content=p_content and d.created_at>now()-interval '5 minutes'order by d.decision_sequence desc limit 1;
 if found then return prior.result||'{"state":"replayed"}';end if;
 return public.save_lead_note(gen_random_uuid(),p_property_id,p_lead_id,p_actor_id,jsonb_build_object('action','add','content',p_content,'reason','Record repeated console lead submission'));
end$$;
revoke all on function public.record_lead_return_note(uuid,uuid,uuid,text)from public,anon,authenticated;
grant execute on function public.record_lead_return_note(uuid,uuid,uuid,text)to service_role;
