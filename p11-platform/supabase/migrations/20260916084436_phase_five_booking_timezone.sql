-- Only newly confirmed booking operations pin their known timezone. Historical
-- rows are not backfilled from today's settings and keep their legacy provenance.
alter table public.tours add column if not exists schedule_timezone text;
alter table public.tour_bookings add column if not exists schedule_timezone text;

create function public.protect_tour_timezone() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.schedule_timezone is distinct from old.schedule_timezone then
  raise exception 'A booked timezone cannot be rewritten' using errcode='55000';
 end if;
 if new.schedule_timezone is not null and not exists(select 1 from pg_timezone_names where name=new.schedule_timezone) then
  raise exception 'Invalid booked timezone' using errcode='22023';
 end if;
 return new;
end; $$;
create trigger protect_tour_timezone before insert or update on public.tours for each row execute function public.protect_tour_timezone();
create trigger protect_booking_timezone before insert or update on public.tour_bookings for each row execute function public.protect_tour_timezone();
revoke all on function public.protect_tour_timezone() from public,anon,authenticated;
grant execute on function public.protect_tour_timezone() to service_role;

create or replace function public.tour_outcome_schedule(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with tour as (
   select id,lead_id,property_id,status,tour_date as day,tour_time as time,coalesce(duration_minutes,30) as minutes,schedule_timezone
   from public.tours where p_source='tours' and id=p_tour_id and property_id=p_property_id
   union all
   select id,lead_id,property_id,status,scheduled_date,scheduled_time,coalesce(duration_minutes,30),schedule_timezone
   from public.tour_bookings where p_source='tour_bookings' and id=p_tour_id and property_id=p_property_id
 ), zone as (
   select t.*,coalesce(t.schedule_timezone,
     (select c.timezone from public.calendar_events e join public.agent_calendars c on c.id=e.agent_calendar_id
       where p_source='tour_bookings' and e.tour_booking_id=t.id and c.property_id=t.property_id limit 1),
     nullif(p.settings->>'timezone',''),
     (select min(c.timezone) from public.agent_calendars c where c.property_id=t.property_id and c.sync_enabled
       having count(distinct c.timezone)=1)
   ) as tz from tour t join public.properties p on p.id=t.property_id
 )
 select jsonb_build_object('id',id,'leadId',lead_id,'propertyId',property_id,'source',p_source,
   'status',status,'date',day,'time',time,'durationMinutes',minutes,
   'timezone',case when exists(select 1 from pg_timezone_names where name=tz) then tz end,
   'startsAt',case when exists(select 1 from pg_timezone_names where name=tz) then (day+time) at time zone tz end,
   'endsAt',case when exists(select 1 from pg_timezone_names where name=tz) then ((day+time) at time zone tz)+make_interval(mins=>minutes) end
 ) from zone;
$$;

create or replace function public.book_recorded_console_tour(p_property_id uuid,p_lead_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.leads;t public.tours;p public.properties;e public.shared_action_events;r jsonb;context jsonb;input jsonb;saved jsonb;
 zone text;wall timestamp;instant timestamptz;matches integer;code text;work_id uuid;scheduled_id uuid:=gen_random_uuid();
 date_value date;time_value time;agent uuid;slot_id uuid;notify boolean;event_id uuid;stopped integer:=0;lead_before text;
begin
 if p_actor_id is null or p_request_id is null or jsonb_typeof(p_input) is distinct from 'object'
  or p_input->>'type' is null or p_input->>'type' not in ('in_person','virtual','self_guided') or length(p_input->>'notes')>2000
  or jsonb_typeof(p_input->'sendConfirmation') is distinct from 'boolean' then raise exception 'Invalid booking input';end if;
 if not exists(select 1 from public.properties x join public.profiles u on u.org_id=x.org_id where x.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties where id=p_property_id for share;
 perform 1 from public.agent_calendars where property_id=p_property_id and sync_enabled for share;
 select * into l from public.leads where id=p_lead_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into p from public.properties where id=p_property_id;
 input:=jsonb_build_object('leadId',p_lead_id,'requestId',p_request_id,'inputHash',encode(sha256(convert_to(p_input::text,'UTF8')),'hex'));
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'tour.booked',input) then return '{"state":"request_conflict"}';end if;
  select * into t from public.tours where id=(e.result->>'tourId')::uuid and property_id=p_property_id and lead_id=p_lead_id;
  if not found then return '{"state":"not_found"}';end if;
  return e.result||jsonb_build_object('state','replayed','tour',to_jsonb(t),'leadStatus',l.status,'actionEventId',e.id,'confirmation',coalesce((select case when state='completed' then 'accepted' when state='superseded' then 'not_sent' when state='review' and error_code='no_recipient' then 'needs_contact' when state='review' then 'review' else 'queued' end from public.tour_schedule_work where id=(e.result->>'confirmationWorkId')::uuid),e.result->>'confirmation'));
 end if;
 date_value:=(p_input->>'date')::date;time_value:=(p_input->>'time')::time;
 if date_value is null or time_value is null then raise exception 'Tour date and time required';end if;
 agent:=nullif(p_input->>'assignedAgentId','')::uuid;notify:=(p_input->>'sendConfirmation')::boolean;
 context:=public.tour_booking_context(p_property_id);zone:=context->>'timezone';wall:=date_value+time_value;
 if zone is null then code:='needs_timezone';
 elsif date_value>(context->>'lastDate')::date then code:='date_out_of_range';
 else
  instant:=wall at time zone zone;
  select count(distinct candidate) into matches from (
   select (wall-((probe at time zone zone)-(probe at time zone 'UTC'))) at time zone 'UTC' candidate
   from (values(instant-interval '2 days'),(instant),(instant+interval '2 days')) x(probe)
  ) y where candidate at time zone zone=wall;
  if matches<>1 then code:='ambiguous_time';elsif instant<=now() then code:='not_future';end if;
 end if;
 if agent is not null and not exists(select 1 from public.profiles where id=agent and org_id=p.org_id) then code:='invalid_agent';end if;
 lead_before:=l.status;
 if code is null then
  select id into slot_id from public.tour_slots where property_id=p_property_id and slot_date=date_value and start_time=time_value order by id limit 1;
  begin
   insert into public.tours(id,property_id,lead_id,tour_date,tour_time,tour_type,status,notes,duration_minutes,assigned_agent_id,created_by,slot_id,schedule_timezone)
   values(scheduled_id,p_property_id,p_lead_id,date_value,time_value,p_input->>'type','scheduled',nullif(p_input->>'notes',''),30,agent,p_actor_id,slot_id,zone) returning * into t;
  exception when sqlstate 'P0001' then
   if sqlerrm in ('Tour time is no longer available','Tour slot is no longer available') then code:='unavailable';else raise;end if;
  end;
 end if;
 if code is null then
  update public.leads set status=case when status in ('leased','lost','toured','application','applied','qualified') then status else 'tour_booked' end,
   crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,
   crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end,updated_at=now() where id=l.id returning * into l;
  update public.lead_workflows lw set status='stopped',next_action_at=null,updated_at=now() from public.workflow_definitions d
   where lw.workflow_id=d.id and lw.lead_id=l.id and lw.status in ('active','paused')
   and (d.trigger_on in ('lead_created','tour_no_show') or coalesce(d.exit_conditions,'[]') ? 'tour_booked');
  get diagnostics stopped=row_count;
  insert into public.lead_activities(lead_id,type,description,metadata,created_by)values(l.id,'tour_booked','Tour scheduled in the console',jsonb_build_object('tour_id',t.id,'request_id',p_request_id,'timezone',zone),p_actor_id);
  if notify then
   insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload,state,error_code)
   values(p_property_id,l.id,'tours',t.id,1,'confirmation',public.tour_reminder_schedule(p_property_id,'tours',t.id)||jsonb_build_object('reminderVersion',2,'firstName',l.first_name,'propertyName',p.name,'address',p.address),
    case when nullif(trim(l.email),'') is null and nullif(trim(l.phone),'') is null then 'review' else 'queued' end,
    case when nullif(trim(l.email),'') is null and nullif(trim(l.phone),'') is null then 'no_recipient' end) returning id into work_id;
   if nullif(trim(l.email),'') is not null then insert into public.tour_reminder_channels(work_id,channel,recipient)values(work_id,'email',l.email);end if;
   if nullif(trim(l.phone),'') is not null then insert into public.tour_reminder_channels(work_id,channel,recipient)values(work_id,'sms',l.phone);end if;
  end if;
  r:=jsonb_build_object('state','applied','tourId',t.id,'leadStatus',l.status,'stoppedWorkflows',stopped,
   'confirmation',case when not notify then 'not_requested' when nullif(trim(l.email),'') is null and nullif(trim(l.phone),'') is null then 'needs_contact' else 'queued' end,'confirmationWorkId',work_id);
 end if;
 r:=coalesce(r,jsonb_build_object('state',code));event_id:=case when code is null then p_request_id else md5(p_request_id::text||(input->>'inputHash')||code)::uuid end;
 if not exists(select 1 from public.shared_action_events where id=event_id and property_id=p_property_id and actor_id=p_actor_id and action='tour.booked' and request=input) then
  saved:=public.append_shared_action_event(event_id,case when code is null then md5('tour/tours'||t.id::text||p_actor_id::text)::uuid else md5('booking/'||p_request_id::text||p_actor_id::text)::uuid end,p_property_id,p_actor_id,'tourspark','tour.booked','server_confirmed',case when code is null then 'succeeded' else 'failed' end,input,
   jsonb_build_object('leadStatus',lead_before),case when code is null then public.tour_action_snapshot(p_property_id,'tours',t.id) else jsonb_build_object('leadStatus',lead_before) end,r);
  if saved->>'state' not in ('recorded','replayed') then raise exception 'Booking action record could not be saved';end if;
 end if;
 return r||jsonb_build_object('actionEventId',event_id)||case when code is null then jsonb_build_object('tour',to_jsonb(t)) else '{}'::jsonb end;
end; $$;

create or replace function public.reserve_luma_tour(p_property_id uuid,p_lead_id uuid,p_booking jsonb,p_delivery jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.tour_bookings; existing public.tour_bookings; slot public.tour_slots; capacity integer:=1;zone text;wall timestamp;instant timestamptz;matches integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties where id=p_property_id for share;
 perform 1 from public.agent_calendars where property_id=p_property_id and sync_enabled for share;
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then raise exception 'Lead scope mismatch'; end if;
 b:=jsonb_populate_record(null::public.tour_bookings,p_booking);
 if b.booked_via_conversation_id is not null and not exists(select 1 from public.conversations where id=b.booked_via_conversation_id and property_id=p_property_id) then raise exception 'Conversation scope mismatch'; end if;
 select * into existing from public.tour_bookings where property_id=p_property_id and lead_id=p_lead_id and scheduled_date=b.scheduled_date and scheduled_time=b.scheduled_time and status in ('scheduled','confirmed') order by created_at limit 1;
 if found then return jsonb_build_object('booking',to_jsonb(existing),'duplicate',true); end if;
 zone:=public.tour_booking_context(p_property_id)->>'timezone';
 if zone is null then raise exception 'Tour timezone needs configuration' using errcode='22023';end if;
 if b.scheduled_date is null or b.scheduled_time is null or b.duration_minutes not between 5 and 240 then raise exception 'Invalid tour schedule' using errcode='22023';end if;
 wall:=b.scheduled_date+b.scheduled_time;instant:=wall at time zone zone;
 select count(distinct candidate) into matches from (
  select (wall-((probe at time zone zone)-(probe at time zone 'UTC'))) at time zone 'UTC' candidate
  from (values(instant-interval '2 days'),(instant),(instant+interval '2 days')) x(probe)
 ) y where candidate at time zone zone=wall;
 if matches<>1 or instant<=now() then raise exception 'Tour time is not a unique future instant' using errcode='22023';end if;
 if (p_delivery ? 'timezone' and p_delivery->>'timezone' is distinct from zone)
  or (p_delivery ? 'startsAt' and (p_delivery->>'startsAt')::timestamptz is distinct from instant) then
  raise exception 'Tour timezone changed during booking' using errcode='40001';end if;
 p_delivery:=p_delivery||jsonb_build_object('timezone',zone,'startsAt',instant,'bookingDate',b.scheduled_date,'bookingTime',to_char(b.scheduled_time,'HH24:MI'),'durationMinutes',coalesce(b.duration_minutes,30));
 if b.slot_id is not null then
   select * into slot from public.tour_slots where id=b.slot_id and property_id=p_property_id and slot_date=b.scheduled_date and start_time=b.scheduled_time and is_available for update;
   if not found or coalesce(slot.current_bookings,0)>=coalesce(slot.max_bookings,1) then raise exception 'Tour slot is no longer available'; end if;
   capacity:=coalesce(slot.max_bookings,1);
 end if;
 -- The table guard checks both tour sources under the same property lock.
 insert into public.tour_bookings(property_id,lead_id,slot_id,scheduled_date,scheduled_time,duration_minutes,special_requests,source,booked_via_conversation_id,status,schedule_timezone)
   values(p_property_id,p_lead_id,b.slot_id,b.scheduled_date,b.scheduled_time,coalesce(b.duration_minutes,30),b.special_requests,b.source,b.booked_via_conversation_id,'confirmed',zone) returning * into b;
 insert into public.lead_activities(lead_id,type,description,metadata) values(p_lead_id,'tour_booked',format('Tour reserved for %s at %s',b.scheduled_date,b.scheduled_time),jsonb_build_object('booking_id',b.id));
 update public.leads set status=case when status in ('leased','lost','toured') then status else 'tour_booked' end,crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=p_lead_id;
 insert into public.luma_delivery_jobs(property_id,booking_id,payload) values(p_property_id,b.id,p_delivery);
 return jsonb_build_object('booking',to_jsonb(b),'duplicate',false);
end; $$;

create or replace function public.tour_action_snapshot(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('status',s->>'status','date',s->>'tour_date','time',s->>'tour_time',
  'timezone',public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->>'timezone','startsAt',public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->'startsAt',
  'scheduleVersion',s->'schedule_version','leadStatus',(select status from public.leads where id=(s->>'lead_id')::uuid and property_id=p_property_id))
 from (select public.tour_schedule_row(p_property_id,p_source,p_tour_id) s) x where s is not null;
$$;

-- Compare real occupied instants when appointments retain different booked
-- zones after a settings change. Legacy unknown times stay conservative.
create or replace function public.check_tour_capacity(p_property_id uuid,p_source text,p_tour_id uuid,p_date date,p_time time,p_minutes integer,p_slot uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare capacity integer:=1;slot public.tour_slots;occupied integer;zone text;starts timestamptz;buffer integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.properties where id=p_property_id for share;
 perform 1 from public.agent_calendars where property_id=p_property_id and sync_enabled for share;
 if p_minutes is null or p_minutes not between 1 and 240 or p_time+make_interval(mins=>p_minutes)<=p_time then raise exception 'Invalid tour duration' using errcode='22023';end if;
 if p_slot is not null then
  select * into slot from public.tour_slots where id=p_slot and property_id=p_property_id and slot_date=p_date and start_time=p_time and is_available for update;
  if not found or slot.end_time<p_time+make_interval(mins=>p_minutes) then raise exception 'Tour slot is no longer available' using errcode='P0001';end if;
  capacity:=greatest(1,coalesce(slot.max_bookings,1));
 end if;
 zone:=coalesce(public.tour_outcome_schedule(p_property_id,p_source,p_tour_id)->>'timezone',public.tour_booking_context(p_property_id)->>'timezone');
 if zone is not null then starts:=(p_date+p_time) at time zone zone;end if;
 select greatest(0,least(240,coalesce(max(coalesce(buffer_minutes,15)),0))) into buffer from public.agent_calendars where property_id=p_property_id and sync_enabled;
 select count(*) into occupied from (
  select tour_date as day,tour_time as at,coalesce(duration_minutes,30) as minutes,public.tour_outcome_schedule(p_property_id,'tours',id) as schedule
  from public.tours where property_id=p_property_id and status in ('scheduled','confirmed') and tour_date between p_date-2 and p_date+2 and not(p_source='tours' and id=p_tour_id)
  union all
  select scheduled_date,scheduled_time,coalesce(duration_minutes,30),public.tour_outcome_schedule(p_property_id,'tour_bookings',id)
  from public.tour_bookings where property_id=p_property_id and status in ('scheduled','confirmed') and scheduled_date between p_date-2 and p_date+2 and not(p_source='tour_bookings' and id=p_tour_id)
 ) x where case when starts is null then
  x.day=p_date and x.at<p_time+make_interval(mins=>p_minutes+buffer) and x.at+make_interval(mins=>x.minutes+buffer)>p_time
 else x.schedule->>'startsAt' is null or
  ((x.schedule->>'startsAt')::timestamptz<starts+make_interval(mins=>p_minutes+buffer) and
   (x.schedule->>'endsAt')::timestamptz+make_interval(mins=>buffer)>starts) end;
 if occupied>=capacity then raise exception 'Tour time is no longer available' using errcode='P0001';end if;
end; $$;

notify pgrst,'reload schema';
