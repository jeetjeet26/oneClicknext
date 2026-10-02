create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 origin:=case when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
alter table public.reputation_cases add column version integer not null default 1;
alter table public.review_tickets add column version integer not null default 1;
create index reviewflow_ticket_history on public.review_tickets(property_id,created_at desc,id desc);
create index reviewflow_case_history on public.reputation_case_events(case_id,created_at desc,id desc);

create function public.guard_reviewflow_case_version() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' then
  if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
  raise exception 'Case and ticket history must be retained';
 end if;
 if tg_op='UPDATE' then
  if(new.id,new.property_id,new.review_id,new.created_at) is distinct from(old.id,old.property_id,old.review_id,old.created_at) then raise exception 'Case and ticket identity cannot change';end if;
  new.version:=old.version+1;
 else new.version:=1;end if;
 if not exists(select 1 from public.reviews where id=new.review_id and property_id=new.property_id) then raise exception 'Review scope does not match';end if;
 new.updated_at:=clock_timestamp();return new;
end$$;
create trigger reviewflow_case_version before insert or update or delete on public.reputation_cases for each row execute function public.guard_reviewflow_case_version();
create trigger reviewflow_ticket_version before insert or update or delete on public.review_tickets for each row execute function public.guard_reviewflow_case_version();
create trigger reviewflow_case_event_immutable before update or delete on public.reputation_case_events for each row execute function public.guard_reviewflow_evidence();
revoke insert,update,delete on public.reputation_cases,public.review_tickets from public,anon,authenticated;

create function public.decide_reviewflow_case(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare decision text:=p_input->>'action';kind text;result jsonb;review public.reviews;prior public.reputation_cases;saved public.reputation_cases;ticket public.review_tickets;saved_ticket public.review_tickets;owner uuid;before_state jsonb;after_state jsonb;event_payload jsonb;next_status text;
begin
 if coalesce(decision,'') not in('create','update','resolve','dismiss','reopen','note','ticket.create','ticket.update','ticket.reopen') then raise exception 'Choose a supported case decision';end if;
 kind:=case decision when 'create' then 'case.created' when 'update' then 'case.updated' when 'resolve' then 'case.resolved' when 'dismiss' then 'case.dismissed' when 'reopen' then 'case.reopened' when 'note' then 'case.note_added' when 'ticket.create' then 'ticket.created' when 'ticket.update' then 'ticket.updated' else 'ticket.reopened' end;
 result:=public.reviewflow_command_start(p_id,p_property_id,p_actor_id,kind,p_input);if result->>'state'<>'new' then return result;end if;
 if(p_input-'action'-'reviewId'-'sourceVersion'-'caseId'-'expectedVersion'-'reason'-'status'-'priority'-'ownerId'-'slaDueAt'-'remediationState'-'resolutionNotes'-'note'-'ticketId'-'expectedTicketVersion'-'title'-'description')<>'{}'::jsonb or length(trim(coalesce(p_input->>'reason',''))) not between 3 and 2000 then raise exception 'Review this decision and give its reason';end if;
 select * into review from public.reviews where id=(p_input->>'reviewId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if review.source_version is distinct from(p_input->>'sourceVersion')::integer then return '{"state":"stale_source"}';end if;
 select * into prior from public.reputation_cases where review_id=review.id and property_id=p_property_id for update;
 if decision='create' then
  if found then return '{"state":"case_exists"}';end if;
  insert into public.reputation_cases(review_id,property_id,status,priority,sla_due_at) values(review.id,p_property_id,'open','medium',clock_timestamp()+interval '72 hours') returning * into saved;
  before_state:='{}';
 else
  if not found or prior.id is distinct from(p_input->>'caseId')::uuid then return '{"state":"not_found"}';end if;
  if prior.version is distinct from(p_input->>'expectedVersion')::integer then return '{"state":"stale_case"}';end if;
  if prior.status in('resolved','dismissed') and decision not in('reopen','note') then return '{"state":"case_closed"}';end if;
  if decision='reopen' and prior.status not in('resolved','dismissed') then return '{"state":"already_open"}';end if;
  before_state:=jsonb_build_object('caseId',prior.id,'version',prior.version,'status',prior.status,'priority',prior.priority,'ownerId',prior.owner_profile_id,'slaDueAt',prior.sla_due_at,'remediationState',prior.remediation_state);
  if p_input?'ownerId' then
   owner:=(p_input->>'ownerId')::uuid;
   if owner is not null and not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=owner and p.id=p_property_id) then return '{"state":"assignee_unavailable"}';end if;
  end if;
  if decision='update' then
   if p_input?'status' and coalesce(p_input->>'status','') not in('open','triaged','remediation') then raise exception 'Response approval and closure require their own reviewed decisions';end if;
   if p_input?'priority' and coalesce(p_input->>'priority','') not in('low','medium','high','urgent') then raise exception 'Invalid case priority';end if;
   if p_input?'remediationState' and coalesce(p_input->>'remediationState','') not in('none','recommended','in_progress','completed') then raise exception 'Invalid remediation state';end if;
   update public.reputation_cases set status=coalesce(p_input->>'status',status),priority=coalesce(p_input->>'priority',priority),owner_profile_id=case when p_input?'ownerId' then owner else owner_profile_id end,sla_due_at=case when p_input?'slaDueAt' then(p_input->>'slaDueAt')::timestamptz else sla_due_at end,remediation_state=coalesce(p_input->>'remediationState',remediation_state),last_activity_at=clock_timestamp() where id=prior.id returning * into saved;
  elsif decision in('resolve','dismiss') then
   if length(trim(coalesce(p_input->>'resolutionNotes',''))) not between 3 and 4000 then raise exception 'Record the actual resolution or dismissal evidence';end if;
   if exists(select 1 from public.review_tickets where review_id=review.id and property_id=p_property_id and status not in('resolved','closed')) then return '{"state":"open_tickets"}';end if;
   update public.reputation_cases set status=case decision when 'resolve' then 'resolved' else 'dismissed' end,resolution_notes=p_input->>'resolutionNotes',resolved_at=clock_timestamp(),remediation_state=case decision when 'resolve' then 'completed' else remediation_state end,last_activity_at=clock_timestamp() where id=prior.id returning * into saved;
  elsif decision='reopen' then
   update public.reputation_cases set status='triaged',resolved_at=null,resolution_notes=null,reopened_count=reopened_count+1,remediation_state='recommended',sla_due_at=clock_timestamp()+make_interval(hours=>case prior.priority when 'urgent' then 4 when 'high' then 24 when 'medium' then 72 else 168 end),last_activity_at=clock_timestamp() where id=prior.id returning * into saved;
  elsif decision='note' then
   if length(trim(coalesce(p_input->>'note',''))) not between 3 and 4000 then raise exception 'Enter the case note';end if;
   update public.reputation_cases set last_activity_at=clock_timestamp() where id=prior.id returning * into saved;
  else
   if decision='ticket.create' then
    if length(trim(coalesce(p_input->>'title',''))) not between 3 and 200 or length(coalesce(p_input->>'description',''))>4000 or coalesce(p_input->>'priority','') not in('low','medium','high','urgent') then raise exception 'Enter a bounded ticket title, details and priority';end if;
    insert into public.review_tickets(property_id,review_id,title,description,priority,status,assigned_to) values(p_property_id,review.id,trim(p_input->>'title'),p_input->>'description',p_input->>'priority','open',owner) returning * into saved_ticket;
   else
    select * into ticket from public.review_tickets where id=(p_input->>'ticketId')::uuid and property_id=p_property_id and review_id=review.id for update;
    if not found then return '{"state":"not_found"}';end if;
    if ticket.version is distinct from(p_input->>'expectedTicketVersion')::integer then return '{"state":"stale_ticket"}';end if;
    if decision='ticket.reopen' then
     if ticket.status not in('resolved','closed') then return '{"state":"already_open"}';end if;
     next_status:='open';
    else
     if ticket.status in('resolved','closed') then return '{"state":"ticket_closed"}';end if;
     next_status:=coalesce(p_input->>'status',ticket.status);
     if next_status not in('open','in_progress','resolved','closed') then raise exception 'Invalid ticket status';end if;
     if next_status in('resolved','closed') and length(trim(coalesce(p_input->>'resolutionNotes',''))) not between 3 and 4000 then raise exception 'Record ticket resolution evidence';end if;
    end if;
    if p_input?'priority' and coalesce(p_input->>'priority','') not in('low','medium','high','urgent') then raise exception 'Invalid ticket priority';end if;
    if p_input?'title' and length(trim(coalesce(p_input->>'title',''))) not between 3 and 200 then raise exception 'Invalid ticket title';end if;
    if length(coalesce(p_input->>'description',''))>4000 then raise exception 'Ticket details exceed the limit';end if;
    update public.review_tickets set status=next_status,title=coalesce(p_input->>'title',title),description=case when p_input?'description' then p_input->>'description' else description end,priority=coalesce(p_input->>'priority',priority),assigned_to=case when p_input?'ownerId' then owner else assigned_to end,resolution_notes=case when next_status in('resolved','closed') then p_input->>'resolutionNotes' when decision='ticket.reopen' then null else resolution_notes end,resolved_at=case when next_status in('resolved','closed') then clock_timestamp() when decision='ticket.reopen' then null else resolved_at end where id=ticket.id returning * into saved_ticket;
    before_state:=before_state||jsonb_build_object('ticketId',ticket.id,'ticketVersion',ticket.version,'ticketStatus',ticket.status,'ticketPriority',ticket.priority,'ticketOwnerId',ticket.assigned_to);
   end if;
   update public.reputation_cases set source_ticket_id=coalesce(source_ticket_id,saved_ticket.id),status=case when saved_ticket.status='in_progress' then 'remediation' else status end,remediation_state=case when saved_ticket.status='in_progress' then 'in_progress' else remediation_state end,last_activity_at=clock_timestamp() where id=prior.id returning * into saved;
  end if;
 end if;
 after_state:=jsonb_build_object('caseId',saved.id,'version',saved.version,'status',saved.status,'priority',saved.priority,'ownerId',saved.owner_profile_id,'slaDueAt',saved.sla_due_at,'remediationState',saved.remediation_state);
 if saved_ticket.id is not null then after_state:=after_state||jsonb_build_object('ticketId',saved_ticket.id,'ticketVersion',saved_ticket.version,'ticketStatus',saved_ticket.status,'ticketPriority',saved_ticket.priority,'ticketOwnerId',saved_ticket.assigned_to);end if;
 event_payload:=jsonb_build_object('requestId',p_id,'sourceVersion',review.source_version,'reason',p_input->>'reason','before',before_state,'after',after_state,'caseBefore',case when prior.id is null then null else to_jsonb(prior) end,'caseAfter',to_jsonb(saved),'ticketBefore',case when ticket.id is null then null else to_jsonb(ticket) end,'ticketAfter',case when saved_ticket.id is null then null else to_jsonb(saved_ticket) end);
 if p_input?'note' then event_payload:=event_payload||jsonb_build_object('note',p_input->>'note');end if;
 if p_input?'resolutionNotes' then event_payload:=event_payload||jsonb_build_object('resolutionNotes',p_input->>'resolutionNotes');end if;
 if decision='reopen' then event_payload:=event_payload||jsonb_build_object('previousResolution',prior.resolution_notes);end if;
 if decision='ticket.reopen' then event_payload:=event_payload||jsonb_build_object('previousResolution',ticket.resolution_notes);end if;
 insert into public.reputation_case_events(id,case_id,property_id,event_type,actor_profile_id,payload) values(p_id,saved.id,p_property_id,kind,p_actor_id,event_payload);
 return public.reviewflow_command_finish(p_id,p_property_id,p_actor_id,kind,p_input,before_state,after_state,jsonb_build_object('caseId',saved.id,'caseVersion',saved.version,'ticketId',saved_ticket.id,'ticketVersion',saved_ticket.version,'sourceVersion',review.source_version,'publicationStarted',false));
end$$;
revoke all on function public.guard_reviewflow_case_version(),public.decide_reviewflow_case(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_reviewflow_case_version(),public.decide_reviewflow_case(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
