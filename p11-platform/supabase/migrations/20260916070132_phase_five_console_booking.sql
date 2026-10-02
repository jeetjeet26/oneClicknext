create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set') then raise exception 'Unregistered action';end if;
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

create function public.tour_booking_context(p_property_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with context as (
  select coalesce(nullif(p.settings->>'timezone',''),(select min(c.timezone) from public.agent_calendars c where c.property_id=p.id and c.sync_enabled having count(distinct c.timezone)=1)) tz
  from public.properties p where p.id=p_property_id
 ) select jsonb_build_object('timezone',case when exists(select 1 from pg_timezone_names where name=tz) then tz end,
  'today',case when exists(select 1 from pg_timezone_names where name=tz) then (now() at time zone tz)::date end,
  'lastDate',case when exists(select 1 from pg_timezone_names where name=tz) then (now() at time zone tz)::date+90 end) from context;
$$;

create function public.book_recorded_console_tour(p_property_id uuid,p_lead_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb)
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
   insert into public.tours(id,property_id,lead_id,tour_date,tour_time,tour_type,status,notes,duration_minutes,assigned_agent_id,created_by,slot_id)
   values(scheduled_id,p_property_id,p_lead_id,date_value,time_value,p_input->>'type','scheduled',nullif(p_input->>'notes',''),30,agent,p_actor_id,slot_id) returning * into t;
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

create or replace function public.tour_reminder_window(p_schedule jsonb,p_kind text,p_now timestamptz default now())
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(p_schedule->>'issue' is null and p_schedule->>'timezone' is not null and
 case p_kind when 'confirmation' then (p_schedule->>'startsAt')::timestamptz>p_now when 'reminder_24h' then (p_schedule->>'startsAt')::timestamptz-p_now between interval '22 hours' and interval '25 hours'
 when 'reminder_1h' then (p_schedule->>'startsAt')::timestamptz-p_now between interval '30 minutes' and interval '90 minutes' else false end,false);
$$;
create or replace function public.prepare_tour_reminder(p_property_id uuid,p_source text,p_tour_id uuid,p_version integer,p_kind text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb; schedule jsonb; w public.tour_schedule_work; l public.leads; property public.properties; claim jsonb;
begin
 if p_kind not in ('confirmation','reminder_24h','reminder_1h') then raise exception 'Invalid reminder kind';end if;
 -- Only explicitly queued confirmations are eligible; never backfill older bookings.
 if p_kind='confirmation' and not exists(select 1 from public.tour_schedule_work where property_id=p_property_id and tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version and kind='confirmation' and payload->>'reminderVersion'='2') then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 s:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);schedule:=public.tour_reminder_schedule(p_property_id,p_source,p_tour_id);
 if s is null or s->>'status' not in ('scheduled','confirmed') or (s->>'schedule_version')::integer<>p_version then return null;end if;
 if not public.tour_reminder_window(schedule,p_kind) then return null;end if;
 if (p_kind='reminder_24h' and s->>'reminder_24h_sent_at' is not null) or (p_kind='reminder_1h' and coalesce(s->>'reminder_1h_sent_at',s->>'reminder_sent_at') is not null) then return null;end if;
 select * into l from public.leads where id=(s->>'lead_id')::uuid and property_id=p_property_id;
 if not found then return null;end if;
 select * into property from public.properties where id=p_property_id;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p_property_id,l.id,p_source,p_tour_id,p_version,p_kind,schedule||jsonb_build_object('reminderVersion',2,'firstName',l.first_name,'propertyName',property.name,'address',property.address))
 on conflict(tour_source,tour_id,schedule_version,kind) do nothing;
 select * into w from public.tour_schedule_work where tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version and kind=p_kind for update;
 -- Older grouped attempts need their existing review path; never infer per-channel receipts.
 if w.payload->>'reminderVersion' is distinct from '2' then return null;end if;
 if w.state='review' and w.error_code='no_recipient' and w.started_at is null and (nullif(trim(l.email),'') is not null or nullif(trim(l.phone),'') is not null) then
  update public.tour_schedule_work set state='queued',error_code=null where id=w.id;w.state:='queued';
 end if;
 if w.state='queued' and not exists(select 1 from public.tour_reminder_channels where work_id=w.id) then
  if nullif(trim(l.email),'') is not null then insert into public.tour_reminder_channels(work_id,channel,recipient)values(w.id,'email',l.email) on conflict do nothing;end if;
  if nullif(trim(l.phone),'') is not null then insert into public.tour_reminder_channels(work_id,channel,recipient)values(w.id,'sms',l.phone) on conflict do nothing;end if;
  if not exists(select 1 from public.tour_reminder_channels where work_id=w.id) then
   update public.tour_schedule_work set state='review',error_code='no_recipient' where id=w.id;return null;
  end if;
 end if;
 claim:=public.claim_tour_schedule_work(w.id);
 if claim is null then
  if w.state='running' and w.lease_until<=now() then update public.tour_reminder_channels set state='review',error_code='delivery_unconfirmed' where work_id=w.id and state='running';end if;
  return null;
 end if;
 return claim||jsonb_build_object('channels',(select jsonb_agg(to_jsonb(c) order by channel) from public.tour_reminder_channels c where work_id=w.id));
end; $$;
create or replace function public.pending_tour_reminder_windows(p_property_id uuid default null,p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 with tours as (
  select id,property_id,'tours'::text source,schedule_version,tour_date as scheduled_day,reminder_24h_sent_at,reminder_sent_at as reminder_1h_sent_at
   from public.tours where status in ('scheduled','confirmed') and (p_property_id is null or property_id=p_property_id)
  union all select id,property_id,'tour_bookings',schedule_version,scheduled_date,reminder_24h_sent_at,reminder_1h_sent_at
   from public.tour_bookings where status in ('scheduled','confirmed') and (p_property_id is null or property_id=p_property_id)
 ), schedules as materialized (
  select t.*,public.tour_reminder_schedule(property_id,source,id) schedule from tours t
  where scheduled_day between (now() at time zone 'UTC')::date-1 and (now() at time zone 'UTC')::date+2
 ), due as (
  select s.*,kind from schedules s cross join (values('reminder_24h'),('reminder_1h')) k(kind)
  where public.tour_reminder_window(schedule,kind) and
   case kind when 'reminder_24h' then reminder_24h_sent_at is null else reminder_1h_sent_at is null end
   and not exists(select 1 from public.tour_schedule_work w where w.tour_source=s.source and w.tour_id=s.id and w.schedule_version=s.schedule_version and w.kind=k.kind and w.state in ('completed','review','superseded') and not (w.state='review' and w.error_code='no_recipient' and exists(select 1 from public.leads l where l.id=(s.schedule->>'leadId')::uuid and (nullif(trim(l.email),'') is not null or nullif(trim(l.phone),'') is not null))))
 ), limited as (select * from due order by schedule->>'startsAt',source,id,kind limit greatest(1,least(p_limit,200)))
 select jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('propertyId',property_id,'source',source,'tourId',id,'version',schedule_version,'kind',kind)) from limited),'[]'),
  'reminders24h',(select count(*) from due where kind='reminder_24h'),'reminders1h',(select count(*) from due where kind='reminder_1h'),
  'needsReview',(select count(*) from schedules where schedule->>'issue' is not null),
  'held',(select count(*) from public.tour_schedule_work where kind in ('reminder_24h','reminder_1h') and (p_property_id is null or property_id=p_property_id) and
    (state='review' or (state='running' and lease_until<=now()))));
$$;
create or replace function public.pending_tour_reminders(p_property_id uuid default null,p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 with reminders as (select public.pending_tour_reminder_windows(p_property_id,p_limit) r), confirmations as materialized (
  select w.* from public.tour_schedule_work w where kind='confirmation' and payload->>'reminderVersion'='2'
   and (p_property_id is null or property_id=p_property_id)
 ), due as (
  select * from confirmations w where (state in ('queued','running') or (state='review' and error_code='no_recipient' and exists(select 1 from public.leads l where l.id=w.lead_id and (nullif(trim(l.email),'') is not null or nullif(trim(l.phone),'') is not null))))
   and created_at>=now()-interval '23 hours' and public.tour_reminder_window(public.tour_reminder_schedule(property_id,tour_source,tour_id),'confirmation')
   and (public.tour_schedule_row(property_id,tour_source,tour_id)->>'schedule_version')::integer=schedule_version
   and public.tour_schedule_row(property_id,tour_source,tour_id)->>'status' in ('scheduled','confirmed')
 ), limited as (select * from due order by created_at,id limit greatest(1,least(p_limit,100)))
 select r||jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('propertyId',property_id,'source',tour_source,'tourId',tour_id,'version',schedule_version,'kind','confirmation')) from limited),'[]')||(r->'candidates'),
  'confirmations',(select count(*) from due),'held',(r->>'held')::integer+(select count(*) from confirmations where state='review' or (state='running' and lease_until<=now()))) from reminders;
$$;

create or replace function public.recover_tour_reminders(p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work;token uuid;n integer:=0;
begin
 for w in select * from public.tour_schedule_work where payload->>'reminderVersion'='2'
  and ((state='running' and lease_until<=now()) or (state='queued' and (created_at<now()-interval '23 hours' or not public.tour_reminder_window(public.tour_reminder_schedule(property_id,tour_source,tour_id),kind))))
  order by created_at,id limit greatest(1,least(p_limit,200)) loop
  perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
  select * into w from public.tour_schedule_work where id=w.id for update;
  if (w.state='running' and w.lease_until<=now()) or (w.state='queued' and (w.created_at<now()-interval '23 hours' or not public.tour_reminder_window(public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id),w.kind))) then
   token:=coalesce(w.lease_token,gen_random_uuid());
   update public.tour_schedule_work set state='running',lease_token=token,lease_until=now()-interval '1 second' where id=w.id;
   if (w.created_at<now()-interval '23 hours' or not public.tour_reminder_window(public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id),w.kind)) then
    update public.tour_reminder_channels set state='skipped',error_code='reminder_window_closed' where work_id=w.id and state='queued';
   end if;
   perform public.settle_tour_reminder(w.id,token);n:=n+1;
  end if;
 end loop;
 return n;
end; $$;
revoke all on function public.tour_booking_context(uuid),public.book_recorded_console_tour(uuid,uuid,uuid,uuid,jsonb),public.pending_tour_reminder_windows(uuid,integer) from public,anon,authenticated;
grant execute on function public.tour_booking_context(uuid),public.book_recorded_console_tour(uuid,uuid,uuid,uuid,jsonb),public.pending_tour_reminder_windows(uuid,integer) to service_role;
notify pgrst,'reload schema';

create or replace function public.start_tour_reminder_channel(p_id uuid,p_token uuid,p_body text,p_subject text,p_sender text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.tour_reminder_channels;w public.tour_schedule_work;s jsonb;l public.leads; schedule jsonb;
begin
 select * into c from public.tour_reminder_channels where id=p_id;if not found then return null;end if;
 select * into w from public.tour_schedule_work where id=c.work_id;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=c.work_id for update;
 select * into c from public.tour_reminder_channels where id=p_id for update;
 if w.state<>'running' or w.lease_token is distinct from p_token or w.lease_until<=now() or c.state<>'queued' then return null;end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);schedule:=public.tour_reminder_schedule(w.property_id,w.tour_source,w.tour_id);
 select * into l from public.leads where id=w.lead_id and property_id=w.property_id;
 if w.created_at<now()-interval '23 hours' or s is null or s->>'status' not in ('scheduled','confirmed') or (s->>'schedule_version')::integer<>w.schedule_version
   or not public.tour_reminder_window(schedule,w.kind) or schedule->>'timezone' is distinct from w.payload->>'timezone'
   or (schedule->>'startsAt')::timestamptz is distinct from (w.payload->>'startsAt')::timestamptz then
  update public.tour_reminder_channels set state='skipped',error_code='reminder_window_changed' where id=p_id;return null;
 end if;
 if c.recipient is distinct from (case c.channel when 'email' then l.email else l.phone end) then
  update public.tour_reminder_channels set state='review',error_code='recipient_changed' where id=p_id;return null;
 end if;
 if c.attempts>=3 or nullif(trim(p_sender),'') is null or nullif(trim(p_body),'') is null or (c.channel='email' and nullif(trim(p_subject),'') is null) then
  update public.tour_reminder_channels set state='review',error_code='configuration_or_retry_limit' where id=p_id;return null;
 end if;
 if c.body is not null and (c.body,c.subject,c.sender) is distinct from (p_body,p_subject,p_sender) then
  update public.tour_reminder_channels set state='review',error_code='message_changed' where id=p_id;return null;
 end if;
 update public.tour_reminder_channels set state='running',body=p_body,subject=p_subject,sender=p_sender,attempts=attempts+1,started_at=now(),error_code=null where id=p_id returning * into c;
 update public.tour_schedule_work set started_at=coalesce(started_at,now()) where id=w.id;
 return to_jsonb(c);
end; $$;
notify pgrst,'reload schema';


-- Complete missing booking setup without silently changing an existing valid timezone.
create function public.set_recorded_tour_timezone(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_timezone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.shared_action_events;context jsonb;input jsonb:=jsonb_build_object('timezone',p_timezone);saved jsonb;
begin
 if p_request_id is null or p_actor_id is null then raise exception 'Missing action identity';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then return '{"state":"invalid_timezone"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into e from public.shared_action_events where id=p_request_id;
 if found then
  if (e.property_id,e.actor_id,e.action,e.request) is distinct from (p_property_id,p_actor_id,'tour.timezone.set',input) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','context',public.tour_booking_context(p_property_id),'actionEventId',e.id);
 end if;
 context:=public.tour_booking_context(p_property_id);
 if context->>'timezone' is not null then return jsonb_build_object('state','already_configured','context',context);end if;
 update public.properties set settings=coalesce(settings,'{}')||jsonb_build_object('timezone',p_timezone) where id=p_property_id;
 saved:=public.append_shared_action_event(p_request_id,md5('tour-timezone/'||p_property_id::text||p_actor_id::text)::uuid,p_property_id,p_actor_id,'tourspark','tour.timezone.set','server_confirmed','succeeded',input,context,public.tour_booking_context(p_property_id),'{"state":"applied"}');
 if saved->>'state' not in ('recorded','replayed') then raise exception 'Timezone decision could not be recorded';end if;
 return jsonb_build_object('state','applied','context',public.tour_booking_context(p_property_id),'actionEventId',p_request_id);
end; $$;
revoke all on function public.set_recorded_tour_timezone(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.set_recorded_tour_timezone(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';

create function public.tour_calendar_schedules(p_property_id uuid,p_lead_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with tours as (
  select id,'tours'::text source from public.tours where property_id=p_property_id and lead_id=p_lead_id and status in ('scheduled','confirmed')
  union all select id,'tour_bookings' from public.tour_bookings where property_id=p_property_id and lead_id=p_lead_id and status in ('scheduled','confirmed')
 ) select coalesce(jsonb_agg(public.tour_reminder_schedule(p_property_id,source,id)),'[]') from tours;
$$;
revoke all on function public.tour_calendar_schedules(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tour_calendar_schedules(uuid,uuid) to service_role;
notify pgrst,'reload schema';
