create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
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
 origin:=case when p_action='console.page.viewed' then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- Concise state snapshots contain no lead contact details or free-text notes.
create function public.tour_action_snapshot(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('status',s->>'status','date',s->>'tour_date','time',s->>'tour_time',
  'scheduleVersion',s->'schedule_version','leadStatus',(select status from public.leads where id=(s->>'lead_id')::uuid and property_id=p_property_id))
 from (select public.tour_schedule_row(p_property_id,p_source,p_tour_id) s) x where s is not null;
$$;

-- Applies the product operation and its action record in one transaction.
-- A failed logical request can be retried after its blocking condition is resolved.
create function public.apply_recorded_tour_action(p_property_id uuid,p_lead_id uuid,p_source text,p_tour_id uuid,p_actor_id uuid,p_request_id uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.shared_action_events;before_state jsonb;after_state jsonb;r jsonb;saved jsonb;
 input jsonb;event_id uuid;success boolean;row_state jsonb;
begin
 if p_request_id is null or p_actor_id is null or p_source is null or p_source not in ('tours','tour_bookings')
  or p_action is null or p_action not in ('tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled')
  or jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>6000 then raise exception 'Invalid tour action';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 row_state:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);
 if row_state is null or (row_state->>'lead_id')::uuid is distinct from p_lead_id then return '{"state":"not_found"}';end if;
 input:=jsonb_build_object('tourId',p_tour_id,'source',p_source,'leadId',p_lead_id,'requestId',p_request_id,
  'inputHash',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
 select * into e from public.shared_action_events where id=p_request_id;
 if found and (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,p_action,input) then return '{"state":"request_conflict"}';end if;
 before_state:=public.tour_action_snapshot(p_property_id,p_source,p_tour_id);
 if p_action='tour.outcome.recorded' then
  -- Replaying an outcome must never overwrite a later deliberate correction.
  if e.id is not null and not exists(select 1 from public.tour_outcomes where id=(e.result->>'outcomeId')::uuid and property_id=p_property_id and lead_id=p_lead_id and tour_id=p_tour_id and tour_source=p_source) then return '{"state":"conflict"}';end if;
  r:=public.record_tour_outcome(p_property_id,p_lead_id,p_source,p_tour_id,p_input->>'outcome',p_input->>'notes',false);
 elsif p_action='tour.no_show.corrected' then
  r:=public.correct_tour_no_show(p_property_id,p_lead_id,p_source,p_tour_id,p_request_id,p_actor_id,p_input->>'reason');
 else
  if (p_action='tour.cancelled' and p_input->>'action'<>'cancel') or (p_action='tour.rescheduled' and p_input->>'action'<>'reschedule') then raise exception 'Schedule action mismatch';end if;
  r:=public.change_tour_schedule(p_property_id,p_lead_id,p_source,p_tour_id,p_actor_id,p_request_id,(p_input->>'expectedVersion')::integer,p_input-'expectedVersion');
 end if;
 if e.id is not null then return r||jsonb_build_object('actionEventId',e.id);end if;
 if r->>'state' in ('not_found','forbidden','request_conflict') then return r;end if;
 success:=r->>'state' in ('applied','replayed','legacy');
 event_id:=case when success then p_request_id else md5(p_request_id::text||p_action||(input->>'inputHash')||(r->>'state'))::uuid end;
 -- Repeated checks of the same still-blocked logical decision do not add duplicate events.
 if exists(select 1 from public.shared_action_events where id=event_id and property_id=p_property_id and actor_id=p_actor_id and action=p_action and request=input) then return r||jsonb_build_object('actionEventId',event_id);end if;
 after_state:=public.tour_action_snapshot(p_property_id,p_source,p_tour_id);
 saved:=public.append_shared_action_event(event_id,md5('tour/'||p_source||p_tour_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark',p_action,'server_confirmed',case when success then 'succeeded' else 'failed' end,input,
  case when r->>'state'='replayed' then null else before_state end,after_state,
  jsonb_strip_nulls(jsonb_build_object('state',r->>'state','outcomeId',r->'outcome'->>'id','outcome',r->'outcome'->>'outcome',
   'followupState',r->'outcome'->>'followup_state','correctionId',r->'correction'->>'id','changeId',r->>'changeId',
   'queued',r->'queued','outcomeEvidence','operator_recorded')));
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Tour action record could not be saved';end if;
 return r||jsonb_build_object('actionEventId',event_id);
end; $$;

create function public.review_recorded_tour_reminder(p_property_id uuid,p_lead_id uuid,p_channel_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work;e public.shared_action_events;before_state jsonb;r jsonb;saved jsonb;input jsonb;event_id uuid;success boolean;
begin
 if p_request_id is null or p_actor_id is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Invalid reminder action';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select sw.* into w from public.tour_reminder_channels c join public.tour_schedule_work sw on sw.id=c.work_id
  where c.id=p_channel_id and sw.property_id=p_property_id and sw.lead_id=p_lead_id;
 if not found then return '{"state":"not_found"}';end if;
 input:=jsonb_build_object('leadId',p_lead_id,'channelId',p_channel_id,'requestId',p_request_id,'resolution',p_input->>'resolution',
  'inputHash',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
 select * into e from public.shared_action_events where id=p_request_id;
 if found and (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'tour.reminder.reviewed',input) then return '{"state":"request_conflict"}';end if;
 if exists(select 1 from public.tour_reminder_reviews where property_id=p_property_id and request_id=p_request_id and actor_id<>p_actor_id) then return '{"state":"request_conflict"}';end if;
 select jsonb_build_object('state',state,'attempts',attempts) into before_state from public.tour_reminder_channels where id=p_channel_id;
 r:=public.review_tour_reminder(p_property_id,p_lead_id,p_channel_id,p_actor_id,p_request_id,p_input);
 if e.id is not null then return r||jsonb_build_object('actionEventId',e.id);end if;
 if r->>'state' in ('forbidden','not_found','request_conflict') then return r;end if;
 success:=r->>'state' in ('applied','replayed');event_id:=case when success then p_request_id else md5(p_request_id::text||(input->>'inputHash')||(r->>'state'))::uuid end;
 if exists(select 1 from public.shared_action_events where id=event_id and property_id=p_property_id and actor_id=p_actor_id and action='tour.reminder.reviewed' and request=input) then return r||jsonb_build_object('actionEventId',event_id);end if;
 saved:=public.append_shared_action_event(event_id,md5('tour/'||w.tour_source||w.tour_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark','tour.reminder.reviewed','server_confirmed',case when success then 'succeeded' else 'failed' end,input,
  case when r->>'state'='replayed' then null else before_state end,
  (select jsonb_build_object('state',state,'attempts',attempts) from public.tour_reminder_channels where id=p_channel_id),
  r||jsonb_build_object('reviewRequestId',p_request_id,'outcomeEvidence','operator_review'));
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Reminder action record could not be saved';end if;
 return r||jsonb_build_object('actionEventId',event_id);
end; $$;
revoke all on function public.tour_action_snapshot(uuid,text,uuid),public.apply_recorded_tour_action(uuid,uuid,text,uuid,uuid,uuid,text,jsonb),public.review_recorded_tour_reminder(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.tour_action_snapshot(uuid,text,uuid),public.apply_recorded_tour_action(uuid,uuid,text,uuid,uuid,uuid,text,jsonb),public.review_recorded_tour_reminder(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
