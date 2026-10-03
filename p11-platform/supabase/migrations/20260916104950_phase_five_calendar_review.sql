-- Local-only calendar recovery. No external write or delivery is performed.
create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
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
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;


create or replace function public.change_tour_schedule(p_property_id uuid,p_lead_id uuid,p_source text,p_tour_id uuid,p_actor_id uuid,p_request_id uuid,p_expected_version integer,p_change jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_schedule jsonb; next_schedule jsonb; c public.tour_schedule_changes; change_id uuid:=gen_random_uuid();
 l public.leads; prop public.properties; action text:=p_change->>'action'; blocked text; new_date date; new_time time;
 new_slot uuid; zone text; starts timestamptz; local_start timestamp; duration integer; payload jsonb; event jsonb; destination jsonb;
 work_count integer:=0; final_result jsonb; prior_delivery boolean; new_status text;
begin
 if p_source is null or p_source not in ('tours','tour_bookings') or p_request_id is null or p_expected_version is null or p_expected_version<1
  or action is null or action not in ('reschedule','cancel') or p_change->>'reason' is null or length(trim(p_change->>'reason')) not between 1 and 2000 then raise exception 'Invalid schedule change input' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles pr join public.properties p on p.org_id=pr.org_id where pr.id=p_actor_id and p.id=p_property_id) then return jsonb_build_object('state','forbidden'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.tour_schedule_changes where property_id=p_property_id and request_id=p_request_id;
 if found then
  if c.tour_source<>p_source or c.tour_id<>p_tour_id or c.actor_id<>p_actor_id or c.lead_id<>p_lead_id or c.input<>p_change||jsonb_build_object('_expectedVersion',p_expected_version) then return jsonb_build_object('state','request_conflict'); end if;
  return c.result||jsonb_build_object('state','replayed','tour',public.tour_schedule_row(p_property_id,p_source,p_tour_id),'leadStatus',(select status from public.leads where id=p_lead_id));
 end if;
 if p_source='tours' then perform 1 from public.tours where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 else perform 1 from public.tour_bookings where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update; end if;
 if not found then return jsonb_build_object('state','not_found'); end if;
 select * into l from public.leads where id=p_lead_id and property_id=p_property_id for update;
 if not found then return jsonb_build_object('state','not_found'); end if;
 old_schedule:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);
 if (old_schedule->>'schedule_version')::integer<>p_expected_version then return jsonb_build_object('state','stale'); end if;
 if old_schedule->>'status' not in ('scheduled','confirmed') then return jsonb_build_object('state','conflict'); end if;
 if p_source='tour_bookings' and exists(select 1 from public.calendar_events e where e.tour_booking_id=p_tour_id and e.sync_status in ('external_drift','external_missing','external_cancelled') and e.id::text is distinct from p_change->>'_calendarReviewEventId') then return '{"state":"calendar_review_required"}';end if;
 blocked:=public.tour_delivery_block(p_property_id,p_source,p_tour_id);
 if blocked is not null then return jsonb_build_object('state',blocked); end if;
 duration:=coalesce((old_schedule->>'duration_minutes')::integer,30);
 next_schedule:=old_schedule||jsonb_build_object('schedule_version',p_expected_version+1);
 if action='reschedule' then
  new_date:=(p_change->>'date')::date;new_time:=(p_change->>'time')::time;
  if new_date is null or new_time is null then raise exception 'Date and time are required' using errcode='22023'; end if;
  if new_date=(old_schedule->>'tour_date')::date and new_time=(old_schedule->>'tour_time')::time then return jsonb_build_object('state','unchanged'); end if;
  zone:=public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->>'timezone';
  if zone is null then return jsonb_build_object('state','needs_timezone'); end if;
  local_start:=new_date+new_time;starts:=local_start at time zone zone;
  if starts at time zone zone<>local_start or exists(select 1 from generate_series(-120,120) i where i<>0 and (starts+make_interval(mins=>i)) at time zone zone=local_start) then return jsonb_build_object('state','ambiguous_time'); end if;
  if starts<=now() then return jsonb_build_object('state','not_future'); end if;
  select id into new_slot from public.tour_slots where property_id=p_property_id and slot_date=new_date and start_time=new_time and is_available order by id limit 1;
  if new_slot is null and (old_schedule->>'slot_id' is not null or exists(select 1 from public.tour_slots where property_id=p_property_id and slot_date=new_date)) then return jsonb_build_object('state','unavailable'); end if;
  begin perform public.check_tour_capacity(p_property_id,p_source,p_tour_id,new_date,new_time,duration,new_slot);
  exception when raise_exception then return jsonb_build_object('state','unavailable'); end;
  next_schedule:=next_schedule||jsonb_build_object('tour_date',new_date,'tour_time',new_time,'slot_id',new_slot);
  if p_source='tour_bookings' then next_schedule:=next_schedule||jsonb_build_object('scheduled_date',new_date,'scheduled_time',new_time);end if;
 else next_schedule:=next_schedule||jsonb_build_object('status','cancelled'); end if;
 insert into public.tour_schedule_changes(id,property_id,lead_id,tour_source,tour_id,request_id,actor_id,action,input,previous_schedule,next_schedule)
 values(change_id,p_property_id,p_lead_id,p_source,p_tour_id,p_request_id,p_actor_id,action,p_change||jsonb_build_object('_expectedVersion',p_expected_version),old_schedule,next_schedule);
 -- Unattempted old work is obsolete. Ambiguous attempted work was blocked above.
 update public.tour_schedule_work set state='superseded',error_code='schedule_superseded' where property_id=p_property_id and tour_source=p_source and tour_id=p_tour_id and state in ('queued','review');
 if p_source='tour_bookings' then
  update public.luma_delivery_jobs set state='review',error_code='schedule_superseded',lease_token=null,lease_until=null where booking_id=p_tour_id and state<>'completed';
  update public.tour_bookings set scheduled_date=(next_schedule->>'tour_date')::date,scheduled_time=(next_schedule->>'tour_time')::time,
   slot_id=(next_schedule->>'slot_id')::uuid,status=next_schedule->>'status',schedule_version=p_expected_version+1,
   reminder_24h_sent_at=null,reminder_1h_sent_at=null,updated_at=now() where id=p_tour_id;
 else
  update public.tours set tour_date=(next_schedule->>'tour_date')::date,tour_time=(next_schedule->>'tour_time')::time,
   slot_id=(next_schedule->>'slot_id')::uuid,status=next_schedule->>'status',schedule_version=p_expected_version+1,
   confirmation_sent_at=null,reminder_24h_sent_at=null,reminder_sent_at=null,updated_at=now() where id=p_tour_id;
 end if;
 new_status:=l.status;
 if action='cancel' and l.status='tour_booked' and not exists(select 1 from public.tours where lead_id=p_lead_id and status in ('scheduled','confirmed'))
  and not exists(select 1 from public.tour_bookings where lead_id=p_lead_id and status in ('scheduled','confirmed')) then
  new_status:=case when exists(select 1 from public.tours where lead_id=p_lead_id and status='completed') or exists(select 1 from public.tour_bookings where lead_id=p_lead_id and status='completed') then 'toured' else 'contacted' end;
 end if;
 update public.leads set status=new_status,updated_at=now(),crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,
  crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=p_lead_id;
 select * into prop from public.properties where id=p_property_id;
 payload:=jsonb_build_object('action',action,'date',next_schedule->>'tour_date','time',next_schedule->>'tour_time','durationMinutes',duration,
  'timezone',coalesce(zone,public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->>'timezone'),
  'propertyName',prop.name,'propertyAddress',coalesce(prop.address->>'street',prop.address->>'full',''),
  'name',trim(coalesce(l.first_name,'')||' '||coalesce(l.last_name,'')),'email',l.email,'phone',l.phone,'reason',trim(p_change->>'reason'));
 if p_source='tour_bookings' then
  select jsonb_build_object('eventId',coalesce(e.provider_event_id,e.google_event_id),'calendarId',cal.id,'providerCalendarId',cal.calendar_id,'provider',cal.provider)
   into destination from public.calendar_events e join public.agent_calendars cal on cal.id=e.agent_calendar_id
   where e.tour_booking_id=p_tour_id and cal.property_id=p_property_id order by e.created_at desc limit 1;
  if destination is null and action='reschedule' then
   select jsonb_build_object('calendarId',j.payload->>'calendarId','providerCalendarId',j.payload->>'providerCalendarId','provider',j.payload->>'provider')
    into destination from public.luma_delivery_jobs j where j.booking_id=p_tour_id;
  end if;
  if destination is not null then
   insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
   values(p_property_id,p_lead_id,p_source,p_tour_id,p_expected_version+1,'calendar',payload||destination);work_count:=work_count+1;
   update public.calendar_events set sync_status='pending' where tour_booking_id=p_tour_id;
  end if;
 end if;
 if coalesce((p_change->>'notify')::boolean,false) then
  if nullif(l.email,'') is not null then insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
   values(p_property_id,p_lead_id,p_source,p_tour_id,p_expected_version+1,'notice_email',payload);work_count:=work_count+1; end if;
  if nullif(l.phone,'') is not null then insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
   values(p_property_id,p_lead_id,p_source,p_tour_id,p_expected_version+1,'notice_sms',payload);work_count:=work_count+1; end if;
 end if;
 insert into public.lead_activities(lead_id,type,description,metadata,created_by) values(p_lead_id,case when action='cancel' then 'tour_cancelled' else 'tour_rescheduled' end,
  case when action='cancel' then 'Tour cancelled: ' else format('Tour rescheduled to %s at %s: ',new_date,new_time) end||trim(p_change->>'reason'),
  jsonb_build_object('tour_id',p_tour_id,'_source',p_source,'_schedule_change_id',change_id),p_actor_id);
 final_result:=jsonb_build_object('state','applied','tour',public.tour_schedule_row(p_property_id,p_source,p_tour_id),'leadStatus',new_status,'changeId',change_id,'queued',case when p_change ? '_calendarReviewEventId' then 0 else work_count end,'notificationRequested',coalesce((p_change->>'notify')::boolean,false));
 update public.tour_schedule_changes set result=final_result where id=change_id;
 return final_result;
end; $$;

create or replace function public.tour_calendar_review_context(p_property_id uuid,p_booking_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('bookingId',b.id,'leadId',b.lead_id,'version',b.schedule_version,'status',b.status,
  'date',b.scheduled_date,'time',b.scheduled_time,'duration',b.duration_minutes,'timezone',b.schedule_timezone,
  'eventId',e.id,'calendarId',c.id,'providerEventId',coalesce(e.provider_event_id,e.google_event_id),
  'provider',c.provider,'providerCalendarId',c.calendar_id,'accountEmail',coalesce(c.account_email,c.google_email),
  'syncStatus',e.sync_status,'observedAt',e.last_synced_at,'observedVersion',e.observed_schedule_version,'remote',e.remote_snapshot)
 from public.tour_bookings b join public.calendar_events e on e.tour_booking_id=b.id
 join public.agent_calendars c on c.id=e.agent_calendar_id and c.property_id=b.property_id
 where b.id=p_booking_id and b.property_id=p_property_id
 and (select count(*) from public.calendar_events x where x.tour_booking_id=b.id)=1;
$$;

create or replace function public.review_tour_calendar_change(p_property_id uuid,p_booking_id uuid,p_event_id uuid,p_actor_id uuid,p_request_id uuid,p_version integer,p_observed_at timestamptz,p_reason text,p_verified_at timestamptz default null,p_verified_remote jsonb default null,p_verified_calendar jsonb default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.tour_bookings;e public.calendar_events;c public.agent_calendars;prior public.shared_action_events;
 input jsonb;before_state jsonb;after_state jsonb;r jsonb;saved jsonb;code text;event_id uuid;
 starts timestamptz;ends timestamptz;wall timestamp;change jsonb;action text;identity jsonb;
begin
 if p_actor_id is null or p_request_id is null or p_event_id is null or p_version is null or p_version<1 or p_observed_at is null
  or nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Invalid calendar review';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('bookingId',p_booking_id,'eventId',p_event_id,'requestId',p_request_id,'version',p_version,'observedAt',p_observed_at,'reasonHash',encode(sha256(convert_to(trim(p_reason),'UTF8')),'hex'));
 select * into prior from public.shared_action_events where id=p_request_id;
 if found then
  if (prior.property_id,prior.actor_id,prior.action,prior.request) is distinct from (p_property_id,p_actor_id,'tour.calendar_change.reviewed',input) then return '{"state":"request_conflict"}';end if;
  return prior.result||jsonb_build_object('state','replayed','actionEventId',prior.id);
 end if;
 select * into b from public.tour_bookings where id=p_booking_id and property_id=p_property_id for update;
 if not found or b.lead_id is null then return '{"state":"not_found"}';end if;
 select ce.* into e from public.calendar_events ce join public.agent_calendars ac on ac.id=ce.agent_calendar_id and ac.property_id=p_property_id
 where ce.id=p_event_id and ce.tour_booking_id=b.id for update of ce;
 if not found then return '{"state":"not_found"}';end if;
 select * into c from public.agent_calendars where id=e.agent_calendar_id for share;
 identity:=jsonb_build_object('id',c.id,'provider',c.provider,'calendarId',c.calendar_id,'accountEmail',coalesce(c.account_email,c.google_email));
 before_state:=public.tour_action_snapshot(p_property_id,'tour_bookings',b.id)||jsonb_build_object('calendarStatus',e.sync_status,'observedAt',e.last_synced_at,'remote',e.remote_snapshot);
 if b.schedule_version<>p_version or e.observed_schedule_version is distinct from p_version or e.last_synced_at is distinct from p_observed_at then code:='stale';
 elsif coalesce(b.status,'') not in ('scheduled','confirmed') or coalesce(e.sync_status,'') not in ('external_drift','external_missing','external_cancelled') then code:='conflict';
 elsif (select count(*) from public.calendar_events where tour_booking_id=b.id)<>1 then code:='binding_conflict';
 elsif not coalesce(c.sync_enabled,false) then code:='calendar_unavailable';
 elsif p_verified_at is null then return jsonb_build_object('state','verification_required','calendarId',c.id,'providerEventId',coalesce(e.provider_event_id,e.google_event_id));
 elsif p_verified_at>clock_timestamp()+interval '5 seconds' or p_verified_at<clock_timestamp()-interval '60 seconds' then code:='verification_expired';
 elsif p_verified_calendar is distinct from identity then code:='binding_conflict';
 elsif p_verified_remote is distinct from e.remote_snapshot then code:='provider_changed';
 elsif e.remote_snapshot is not null and (jsonb_typeof(e.remote_snapshot) is distinct from 'object' or length(e.remote_snapshot::text)>4096 or e.remote_snapshot-array['id','status','startDateTime','endDateTime']<>'{}' or e.remote_snapshot->>'id' is distinct from coalesce(e.provider_event_id,e.google_event_id)) then code:='unsupported_change';
 elsif e.sync_status='external_missing' and e.remote_snapshot is not null then code:='unsupported_change';
 elsif e.sync_status='external_cancelled' and e.remote_snapshot->>'status' is distinct from 'cancelled' then code:='unsupported_change';
 end if;
 if code is null then
  if e.sync_status='external_drift' then
   if b.schedule_timezone is null then code:='needs_timezone';
   elsif e.remote_snapshot->>'status' is null or e.remote_snapshot->>'status' not in ('confirmed','tentative') then code:='unsupported_change';
   else
    begin
     if coalesce(e.remote_snapshot->>'startDateTime','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(e.remote_snapshot->>'endDateTime','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then code:='unsupported_change';
     else
      starts:=(e.remote_snapshot->>'startDateTime')::timestamptz;ends:=(e.remote_snapshot->>'endDateTime')::timestamptz;
      wall:=starts at time zone b.schedule_timezone;
      if ends-starts<>make_interval(mins=>coalesce(b.duration_minutes,30)) or date_trunc('minute',wall)<>wall then code:='unsupported_change';end if;
     end if;
    exception when invalid_datetime_format or datetime_field_overflow then code:='unsupported_change';end;
   end if;
   action:='reschedule';change:=jsonb_build_object('action',action,'date',wall::date,'time',wall::time,'reason',trim(p_reason),'notify',false);
  else action:='cancel';change:=jsonb_build_object('action',action,'reason',trim(p_reason),'notify',false);end if;
 end if;
 if code is null then
  r:=public.change_tour_schedule(p_property_id,b.lead_id,'tour_bookings',b.id,p_actor_id,p_request_id,p_version,change||jsonb_build_object('_calendarReviewEventId',e.id));
  if r->>'state'='applied' then
   -- The provider change already exists. Skip redundant dispatch; never invent a send receipt.
   update public.tour_schedule_work set state='skipped',error_code='external_change_adopted',receipt=null
    where property_id=p_property_id and tour_source='tour_bookings' and tour_id=b.id and schedule_version=p_version+1 and kind='calendar' and state='queued';
   update public.calendar_events set sync_status='synced',observed_schedule_version=p_version+1,last_synced_at=clock_timestamp() where id=e.id;
   r:=jsonb_build_object('state','applied','changeId',r->>'changeId','action',action,'queued',0,'notificationRequested',false,'scheduleVersion',p_version+1,
    'providerEvidence',case when e.sync_status='external_missing' then 'observed_missing' when e.sync_status='external_cancelled' then 'observed_cancelled' else 'observed_schedule' end,
    'verifiedAt',p_verified_at,'outcomeEvidence','operator_review');
  else code:=r->>'state';end if;
 end if;
 if code is not null then r:=jsonb_build_object('state',code);end if;
 event_id:=case when code is null then p_request_id else md5(p_request_id::text||input::text||code)::uuid end;
 after_state:=public.tour_action_snapshot(p_property_id,'tour_bookings',b.id)||jsonb_build_object('calendarStatus',(select sync_status from public.calendar_events where id=e.id));
 if not exists(select 1 from public.shared_action_events where id=event_id) then
  saved:=public.append_shared_action_event(event_id,md5('tour/tour_bookings'||b.id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark','tour.calendar_change.reviewed','server_confirmed',case when code is null then 'succeeded' else 'failed' end,input,before_state,after_state,r);
  if saved->>'state' not in ('recorded','replayed') then raise exception 'Calendar decision could not be recorded';end if;
 end if;
 return r||jsonb_build_object('actionEventId',event_id);
end; $$;
revoke all on function public.tour_calendar_review_context(uuid,uuid),public.review_tour_calendar_change(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.tour_calendar_review_context(uuid,uuid),public.review_tour_calendar_change(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,timestamptz,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
