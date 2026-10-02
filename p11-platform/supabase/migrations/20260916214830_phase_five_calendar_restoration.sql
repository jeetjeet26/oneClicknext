-- Reviewed calendar restoration and duration adoption. External delivery remains gated by the existing worker.
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
 if p_change ? '_calendarReviewDuration' then
  if p_source<>'tour_bookings' or not p_change ? '_calendarReviewEventId' then raise exception 'Duration requires a reviewed calendar event';end if;
  duration:=(p_change->>'_calendarReviewDuration')::integer;
  if duration not between 1 and 240 then return '{"state":"unsupported_change"}';end if;
 end if;
 next_schedule:=old_schedule||jsonb_build_object('schedule_version',p_expected_version+1);
 if action='reschedule' then
  new_date:=(p_change->>'date')::date;new_time:=(p_change->>'time')::time;
  if new_date is null or new_time is null then raise exception 'Date and time are required' using errcode='22023'; end if;
  if new_date=(old_schedule->>'tour_date')::date and new_time=(old_schedule->>'tour_time')::time and duration=coalesce((old_schedule->>'duration_minutes')::integer,30) and not coalesce((p_change->>'_calendarRestore')::boolean,false) then return jsonb_build_object('state','unchanged'); end if;
  zone:=public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->>'timezone';
  if zone is null then return jsonb_build_object('state','needs_timezone'); end if;
  local_start:=new_date+new_time;starts:=local_start at time zone zone;
  if starts at time zone zone<>local_start or exists(select 1 from generate_series(-120,120) i where i<>0 and (starts+make_interval(mins=>i)) at time zone zone=local_start) then return jsonb_build_object('state','ambiguous_time'); end if;
  if starts<=now() then return jsonb_build_object('state','not_future'); end if;
  select id into new_slot from public.tour_slots where property_id=p_property_id and slot_date=new_date and start_time=new_time and is_available order by id limit 1;
  if new_slot is null and (old_schedule->>'slot_id' is not null or exists(select 1 from public.tour_slots where property_id=p_property_id and slot_date=new_date)) then return jsonb_build_object('state','unavailable'); end if;
  begin perform public.check_tour_capacity(p_property_id,p_source,p_tour_id,new_date,new_time,duration,new_slot);
  exception when raise_exception then return jsonb_build_object('state','unavailable'); end;
  next_schedule:=next_schedule||jsonb_build_object('tour_date',new_date,'tour_time',new_time,'slot_id',new_slot,'duration_minutes',duration);
  if p_source='tour_bookings' then next_schedule:=next_schedule||jsonb_build_object('scheduled_date',new_date,'scheduled_time',new_time);end if;
 else next_schedule:=next_schedule||jsonb_build_object('status','cancelled'); end if;
 insert into public.tour_schedule_changes(id,property_id,lead_id,tour_source,tour_id,request_id,actor_id,action,input,previous_schedule,next_schedule)
 values(change_id,p_property_id,p_lead_id,p_source,p_tour_id,p_request_id,p_actor_id,action,p_change||jsonb_build_object('_expectedVersion',p_expected_version),old_schedule,next_schedule);
 -- Unattempted old work is obsolete. Ambiguous attempted work was blocked above.
 update public.tour_schedule_work set state='superseded',error_code='schedule_superseded' where property_id=p_property_id and tour_source=p_source and tour_id=p_tour_id and state in ('queued','review');
 if p_source='tour_bookings' then
  update public.luma_delivery_jobs set state='review',error_code='schedule_superseded',lease_token=null,lease_until=null where booking_id=p_tour_id and state<>'completed';
  update public.tour_bookings set scheduled_date=(next_schedule->>'tour_date')::date,scheduled_time=(next_schedule->>'tour_time')::time,
   duration_minutes=(next_schedule->>'duration_minutes')::integer,slot_id=(next_schedule->>'slot_id')::uuid,status=next_schedule->>'status',schedule_version=p_expected_version+1,
   reminder_24h_sent_at=null,reminder_1h_sent_at=null,updated_at=now() where id=p_tour_id;
 else
  update public.tours set tour_date=(next_schedule->>'tour_date')::date,tour_time=(next_schedule->>'tour_time')::time,
   duration_minutes=(next_schedule->>'duration_minutes')::integer,slot_id=(next_schedule->>'slot_id')::uuid,status=next_schedule->>'status',schedule_version=p_expected_version+1,
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
 final_result:=jsonb_build_object('state','applied','tour',public.tour_schedule_row(p_property_id,p_source,p_tour_id),'leadStatus',new_status,'changeId',change_id,'queued',case when p_change ? '_calendarReviewEventId' and not coalesce((p_change->>'_calendarRestore')::boolean,false) then 0 else work_count end,'notificationRequested',coalesce((p_change->>'notify')::boolean,false));
 update public.tour_schedule_changes set result=final_result where id=change_id;
 return final_result;
end; $$;
create or replace function public.tour_action_snapshot(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('status',s->>'status','date',s->>'tour_date','time',s->>'tour_time',
  'timezone',public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->>'timezone','startsAt',public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->'startsAt',
  'durationMinutes',s->'duration_minutes','scheduleVersion',s->'schedule_version','leadStatus',(select status from public.leads where id=(s->>'lead_id')::uuid and property_id=p_property_id))
 from (select public.tour_schedule_row(p_property_id,p_source,p_tour_id) s) x where s is not null;
$$;
drop function public.review_tour_calendar_change(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,timestamptz,jsonb,jsonb);
create or replace function public.review_tour_calendar_change(p_property_id uuid,p_booking_id uuid,p_event_id uuid,p_actor_id uuid,p_request_id uuid,p_version integer,p_observed_at timestamptz,p_reason text,p_verified_at timestamptz default null,p_verified_remote jsonb default null,p_verified_calendar jsonb default null,p_resolution text default 'adopt')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.tour_bookings;e public.calendar_events;c public.agent_calendars;prior public.shared_action_events;
 input jsonb;before_state jsonb;after_state jsonb;r jsonb;saved jsonb;code text;event_id uuid;
 starts timestamptz;ends timestamptz;wall timestamp;change jsonb;action text;identity jsonb;duration integer;
begin
 if p_resolution is null or p_resolution not in ('adopt','restore') then raise exception 'Invalid calendar resolution';end if;
 if p_actor_id is null or p_request_id is null or p_event_id is null or p_version is null or p_version<1 or p_observed_at is null
  or nullif(trim(p_reason),'') is null or length(p_reason)>2000 then raise exception 'Invalid calendar review';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input:=jsonb_build_object('bookingId',p_booking_id,'eventId',p_event_id,'requestId',p_request_id,'version',p_version,'observedAt',p_observed_at,'reasonHash',encode(sha256(convert_to(trim(p_reason),'UTF8')),'hex'));
 if p_resolution='restore' then input:=input||'{"resolution":"restore"}';end if;
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
 identity:=jsonb_build_object('id',c.id,'provider',c.provider,'calendarId',c.calendar_id,'accountEmail',coalesce(c.account_email,c.google_email),'credentialVersion',c.credential_version);
 before_state:=public.tour_action_snapshot(p_property_id,'tour_bookings',b.id)||jsonb_build_object('calendarStatus',e.sync_status,'observedAt',e.last_synced_at,'remote',e.remote_snapshot);
 if b.schedule_version<>p_version or e.observed_schedule_version is distinct from p_version or e.last_synced_at is distinct from p_observed_at then code:='stale';
 elsif coalesce(b.status,'') not in ('scheduled','confirmed') or coalesce(e.sync_status,'') not in ('external_drift','external_missing','external_cancelled') then code:='conflict';
 elsif (select count(*) from public.calendar_events where tour_booking_id=b.id)<>1 then code:='binding_conflict';
 elsif c.retired_at is not null or not coalesce(c.sync_enabled,false) or c.token_status is distinct from 'healthy' or public.integration_permission_state(c.provider,'calendar',c.scopes,c.provider_metadata->>'scopeEvidence')<>'confirmed' then code:='calendar_unavailable';
 elsif p_verified_at is null then return jsonb_build_object('state','verification_required','calendarId',c.id,'providerEventId',coalesce(e.provider_event_id,e.google_event_id));
 elsif p_verified_at>clock_timestamp()+interval '5 seconds' or p_verified_at<clock_timestamp()-interval '60 seconds' then code:='verification_expired';
 elsif p_verified_calendar is distinct from identity then code:='binding_conflict';
 elsif p_verified_remote is distinct from e.remote_snapshot then code:='provider_changed';
 elsif e.remote_snapshot is not null and (jsonb_typeof(e.remote_snapshot) is distinct from 'object' or length(e.remote_snapshot::text)>4096 or e.remote_snapshot-array['id','status','startDateTime','endDateTime']<>'{}' or e.remote_snapshot->>'id' is distinct from coalesce(e.provider_event_id,e.google_event_id)) then code:='unsupported_change';
 elsif e.sync_status='external_missing' and e.remote_snapshot is not null then code:='unsupported_change';
 elsif e.sync_status='external_cancelled' and e.remote_snapshot->>'status' is distinct from 'cancelled' then code:='unsupported_change';
 end if;
 if code is null then
  if p_resolution='restore' then
   if b.schedule_timezone is null then code:='needs_timezone';end if;
   if not exists(select 1 from public.leads where id=b.lead_id and property_id=p_property_id and nullif(trim(email),'') is not null) then code:='missing_recipient';end if;
   action:='restore';change:=jsonb_build_object('action','reschedule','date',b.scheduled_date,'time',b.scheduled_time,'reason',trim(p_reason),'notify',false,'_calendarRestore',true);
  elsif e.sync_status='external_drift' then
   if b.schedule_timezone is null then code:='needs_timezone';
   elsif e.remote_snapshot->>'status' is null or e.remote_snapshot->>'status' not in ('confirmed','tentative') then code:='unsupported_change';
   else
    begin
     if coalesce(e.remote_snapshot->>'startDateTime','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$'
      or coalesce(e.remote_snapshot->>'endDateTime','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then code:='unsupported_change';
     else
      starts:=(e.remote_snapshot->>'startDateTime')::timestamptz;ends:=(e.remote_snapshot->>'endDateTime')::timestamptz;
      wall:=starts at time zone b.schedule_timezone;
      duration:=extract(epoch from ends-starts)/60;
      if not isfinite(starts) or not isfinite(ends) or ends<=starts or ends-starts<>make_interval(mins=>duration) or duration not between 1 and 240 or date_trunc('minute',wall)<>wall then code:='unsupported_change';end if;
     end if;
    exception when invalid_datetime_format or datetime_field_overflow then code:='unsupported_change';end;
   end if;
   action:='reschedule';change:=jsonb_build_object('action',action,'date',wall::date,'time',wall::time,'reason',trim(p_reason),'notify',false,'_calendarReviewDuration',duration);
  else action:='cancel';change:=jsonb_build_object('action',action,'reason',trim(p_reason),'notify',false);end if;
 end if;
 if code is null then
  r:=public.change_tour_schedule(p_property_id,b.lead_id,'tour_bookings',b.id,p_actor_id,p_request_id,p_version,change||jsonb_build_object('_calendarReviewEventId',e.id));
  if r->>'state'='applied' then
   if p_resolution='restore' then
    -- Recreate missing/cancelled events with the normal durable create identity; preserve the prior identity in the work record.
    update public.tour_schedule_work set payload=(case when e.sync_status in ('external_missing','external_cancelled') then payload-'eventId' else payload end)
     ||jsonb_build_object('restore',true,'calendarEventRecordId',e.id,'replacesEventId',coalesce(e.provider_event_id,e.google_event_id))
     where property_id=p_property_id and tour_source='tour_bookings' and tour_id=b.id and schedule_version=p_version+1 and kind='calendar' and state='queued';
    if not found then raise exception 'Restoration work could not be saved';end if;
   else
    -- Adoption uses the observed provider state; no redundant dispatch or invented send receipt.
    update public.tour_schedule_work set state='skipped',error_code='external_change_adopted',receipt=null
     where property_id=p_property_id and tour_source='tour_bookings' and tour_id=b.id and schedule_version=p_version+1 and kind='calendar' and state='queued';
    update public.calendar_events set sync_status='synced',observed_schedule_version=p_version+1,last_synced_at=clock_timestamp() where id=e.id;
   end if;
   r:=jsonb_build_object('state','applied','changeId',r->>'changeId','action',action,'queued',case when p_resolution='restore' then 1 else 0 end,'notificationRequested',false,'scheduleVersion',p_version+1,
    'providerEvidence',case when p_resolution='restore' then 'restoration_pending' when e.sync_status='external_missing' then 'observed_missing' when e.sync_status='external_cancelled' then 'observed_cancelled' else 'observed_schedule' end,
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
create or replace function public.finish_tour_schedule_work(p_id uuid,p_token uuid,p_receipt jsonb,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work; s jsonb;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 if exists(select 1 from public.tour_schedule_work where id=p_id and state='completed' and completion_token=p_token and receipt=p_receipt) then return p_success;end if;
 select * into w from public.tour_schedule_work where id=p_id and lease_token=p_token and state in ('running','review') for update;
 if not found then return false; end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
 if s is null or (s->>'schedule_version')::integer<>w.schedule_version then return false; end if;
 if p_success and w.kind in ('calendar','notice_email','notice_sms') and (w.started_at is null or
  (w.kind in ('notice_email','notice_sms') and nullif(trim(p_receipt->>'messageId'),'') is null)) then raise exception 'Attempt and provider receipt required';end if;
 if p_success and (p_receipt is null or p_receipt='{}') then raise exception 'Delivery receipt is required'; end if;
 if p_success and w.kind='calendar' then
  if nullif(p_receipt->>'eventId','') is null or length(p_receipt->>'eventId')>1024 then raise exception 'Calendar receipt is required'; end if;
  if nullif(w.payload->>'eventId','') is not null and p_receipt->>'eventId' is distinct from w.payload->>'eventId' then raise exception 'Calendar receipt identity conflict';end if;
  if coalesce((w.payload->>'restore')::boolean,false) then
   if not exists(select 1 from public.calendar_events e join public.agent_calendars c on c.id=e.agent_calendar_id where e.id=(w.payload->>'calendarEventRecordId')::uuid and e.tour_booking_id=w.tour_id and e.agent_calendar_id=(w.payload->>'calendarId')::uuid and coalesce(e.provider_event_id,e.google_event_id)=w.payload->>'replacesEventId' and c.property_id=w.property_id and c.retired_at is null) then raise exception 'Calendar restoration binding changed';end if;
  end if;
  if exists(select 1 from public.calendar_events where tour_booking_id=w.tour_id and agent_calendar_id=(w.payload->>'calendarId')::uuid) then
   update public.calendar_events set sync_status='synced',last_synced_at=now(),observed_schedule_version=w.schedule_version,remote_snapshot=null,google_event_id=p_receipt->>'eventId',provider_event_id=p_receipt->>'eventId',provider_event_link=case when provider_event_id is distinct from p_receipt->>'eventId' then p_receipt->>'htmlLink' else coalesce(p_receipt->>'htmlLink',provider_event_link) end where tour_booking_id=w.tour_id and agent_calendar_id=(w.payload->>'calendarId')::uuid;
  elsif w.payload->>'action'<>'cancel' then
   insert into public.calendar_events(agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,provider_event_link,sync_status,last_synced_at)
   values((w.payload->>'calendarId')::uuid,w.tour_id,p_receipt->>'eventId',p_receipt->>'eventId',p_receipt->>'htmlLink','synced',now());
  end if;
 end if;
 update public.tour_schedule_work set completion_token=case when p_success then p_token else completion_token end,state=case when p_success then 'completed' else 'review' end,receipt=p_receipt,
  error_code=case when p_success then null when started_at is null then 'not_attempted' else 'delivery_unconfirmed' end,
  completed_at=case when p_success then now() end,lease_until=null,lease_token=case when p_success then null else lease_token end where id=p_id;
 if p_success and w.kind in ('confirmation','reminder_24h','reminder_1h') then
  if w.tour_source='tours' then update public.tours set
   confirmation_sent_at=case when w.kind='confirmation' then now() else confirmation_sent_at end,
   reminder_24h_sent_at=case when w.kind='reminder_24h' then now() else reminder_24h_sent_at end,
   reminder_sent_at=case when w.kind='reminder_1h' then now() else reminder_sent_at end where id=w.tour_id and schedule_version=w.schedule_version;
  else update public.tour_bookings set reminder_24h_sent_at=case when w.kind='reminder_24h' then now() else reminder_24h_sent_at end,
   reminder_1h_sent_at=case when w.kind='reminder_1h' then now() else reminder_1h_sent_at end where id=w.tour_id and schedule_version=w.schedule_version; end if;
 end if;
 return true;
end; $$;
revoke all on function public.review_tour_calendar_change(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,timestamptz,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.review_tour_calendar_change(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,timestamptz,jsonb,jsonb,text) to service_role;
notify pgrst,'reload schema';
