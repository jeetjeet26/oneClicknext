-- Local Phase 5: atomic schedule changes and version-fenced external work.
alter table public.tours add column if not exists schedule_version integer not null default 1;
alter table public.tours add column if not exists duration_minutes integer not null default 30;
alter table public.tours add column if not exists slot_id uuid references public.tour_slots(id);
alter table public.tour_bookings add column if not exists schedule_version integer not null default 1;
alter table public.luma_delivery_jobs add column if not exists schedule_version integer not null default 1;
create index if not exists tours_slot_id_idx on public.tours(slot_id);

create table if not exists public.tour_schedule_changes (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade, tour_source text not null check(tour_source in ('tours','tour_bookings')),
 tour_id uuid not null, request_id uuid not null, actor_id uuid not null, action text not null check(action in ('reschedule','cancel')),
 input jsonb not null, previous_schedule jsonb not null, next_schedule jsonb not null,
 transaction_id bigint not null default txid_current(), result jsonb, created_at timestamptz not null default now(),
 unique(property_id,request_id)
);
create index if not exists tour_schedule_changes_lead_idx on public.tour_schedule_changes(lead_id);
create index if not exists tour_schedule_changes_tour_idx on public.tour_schedule_changes(tour_source,tour_id);
alter table public.tour_schedule_changes enable row level security;
revoke all on public.tour_schedule_changes from public,anon,authenticated;
grant all on public.tour_schedule_changes to service_role;
drop trigger if exists protect_schedule_change_history on public.tour_schedule_changes;
create trigger protect_schedule_change_history before update or delete on public.tour_schedule_changes
 for each row execute function public.protect_tour_correction_history();

create table if not exists public.tour_schedule_work (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade, tour_source text not null check(tour_source in ('tours','tour_bookings')),
 tour_id uuid not null, schedule_version integer not null,
 kind text not null check(kind in ('calendar','notice_email','notice_sms','confirmation','reminder_24h','reminder_1h','calendar_reconcile')),
 state text not null default 'queued' check(state in ('queued','running','completed','review','superseded')),
 payload jsonb not null default '{}', receipt jsonb, error_code text, lease_token uuid, lease_until timestamptz,
 started_at timestamptz, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(tour_source,tour_id,schedule_version,kind)
);
create index if not exists tour_schedule_work_property_idx on public.tour_schedule_work(property_id);
create index if not exists tour_schedule_work_lead_idx on public.tour_schedule_work(lead_id);
create index if not exists tour_schedule_work_due_idx on public.tour_schedule_work(state,created_at);
alter table public.tour_schedule_work enable row level security;
revoke all on public.tour_schedule_work from public,anon,authenticated;
grant all on public.tour_schedule_work to service_role;

create or replace function public.tour_schedule_row(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select to_jsonb(t)||jsonb_build_object('source','tours') from public.tours t where p_source='tours' and t.id=p_tour_id and t.property_id=p_property_id
 union all
 select to_jsonb(t)||jsonb_build_object('source','tour_bookings','tour_date',t.scheduled_date,'tour_time',t.scheduled_time,'tour_type','in_person','notes',t.special_requests)
 from public.tour_bookings t where p_source='tour_bookings' and t.id=p_tour_id and t.property_id=p_property_id;
$$;

create or replace function public.tour_delivery_block(p_property_id uuid,p_source text,p_tour_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work; j public.luma_delivery_jobs;
begin
 for w in select * from public.tour_schedule_work where property_id=p_property_id and tour_source=p_source and tour_id=p_tour_id
  and (state='running' or (state='review' and started_at is not null)) order by id for update loop
  if w.state='running' and w.lease_until>now() then return 'delivery_busy'; end if;
  return 'delivery_review_required';
 end loop;
 if p_source='tour_bookings' then
  select * into j from public.luma_delivery_jobs where booking_id=p_tour_id and property_id=p_property_id for update;
  if found and j.state='running' and j.lease_until>now() then return 'delivery_busy'; end if;
  if found and j.state<>'completed' and (j.lease_token is not null or j.attempts>0) and j.error_code is distinct from 'schedule_superseded' then return 'delivery_review_required'; end if;
 end if;
 return null;
end; $$;

-- Serialize capacity across both sources. Existing historical records are not rewritten.
create or replace function public.check_tour_capacity(p_property_id uuid,p_source text,p_tour_id uuid,p_date date,p_time time,p_minutes integer,p_slot uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare capacity integer:=1; slot public.tour_slots; occupied integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if p_minutes is null or p_minutes not between 1 and 240 or p_time+make_interval(mins=>p_minutes)<=p_time then raise exception 'Invalid tour duration' using errcode='22023'; end if;
 if p_slot is not null then
  select * into slot from public.tour_slots where id=p_slot and property_id=p_property_id and slot_date=p_date and start_time=p_time and is_available for update;
  if not found or slot.end_time< p_time+make_interval(mins=>p_minutes) then raise exception 'Tour slot is no longer available' using errcode='P0001'; end if;
  capacity:=greatest(1,coalesce(slot.max_bookings,1));
 end if;
 select count(*) into occupied from (
  select tour_date as day,tour_time as at,coalesce(duration_minutes,30) as minutes from public.tours
   where property_id=p_property_id and status in ('scheduled','confirmed') and not(p_source='tours' and id=p_tour_id)
  union all select scheduled_date,scheduled_time,coalesce(duration_minutes,30) from public.tour_bookings
   where property_id=p_property_id and status in ('scheduled','confirmed') and not(p_source='tour_bookings' and id=p_tour_id)
 ) x where x.day=p_date and x.at<p_time+make_interval(mins=>p_minutes) and x.at+make_interval(mins=>x.minutes)>p_time;
 if occupied>=capacity then raise exception 'Tour time is no longer available' using errcode='P0001'; end if;
end; $$;

create or replace function public.guard_tour_schedule() returns trigger
language plpgsql security invoker set search_path='' as $$
declare n jsonb:=to_jsonb(new); o jsonb; changed boolean; schedule_changed boolean; d date; t time; blocked text;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old); end if;
 d:=coalesce(n->>'tour_date',n->>'scheduled_date')::date;t:=coalesce(n->>'tour_time',n->>'scheduled_time')::time;
 schedule_changed:=tg_op='UPDATE' and (coalesce(n->>'tour_date',n->>'scheduled_date'),coalesce(n->>'tour_time',n->>'scheduled_time'),n->>'duration_minutes',n->>'slot_id',n->>'tour_type')
  is distinct from (coalesce(o->>'tour_date',o->>'scheduled_date'),coalesce(o->>'tour_time',o->>'scheduled_time'),o->>'duration_minutes',o->>'slot_id',o->>'tour_type');
 changed:=tg_op='UPDATE' and (schedule_changed or (new.status is distinct from old.status and (new.status='cancelled' or old.status='cancelled')));
 if tg_op='UPDATE' and (new.property_id is distinct from old.property_id or new.lead_id is distinct from old.lead_id) then raise exception 'Tour ownership cannot be reassigned'; end if;
 if tg_op='UPDATE' and (schedule_changed or new.status is distinct from old.status) then
  perform pg_advisory_xact_lock(hashtextextended(new.property_id::text,12));
  blocked:=public.tour_delivery_block(new.property_id,tg_table_name,new.id);
  if blocked is not null then raise exception '%',blocked; end if;
 end if;
 if changed or (tg_op='UPDATE' and new.schedule_version<>old.schedule_version) then
  if not exists(select 1 from public.tour_schedule_changes c where c.property_id=new.property_id and c.tour_source=tg_table_name and c.tour_id=new.id
    and c.transaction_id=txid_current() and c.result is null and (c.next_schedule->>'schedule_version')::integer=new.schedule_version) then
   raise exception 'Use the atomic tour schedule operation' using errcode='55000';
  end if;
 end if;
 if new.status in ('scheduled','confirmed') and (tg_op='INSERT' or schedule_changed) then
  perform public.check_tour_capacity(new.property_id,tg_table_name,new.id,d,t,(n->>'duration_minutes')::integer,(n->>'slot_id')::uuid);
 end if;
 return new;
end; $$;
drop trigger if exists guard_tour_schedule on public.tours;
create trigger guard_tour_schedule before insert or update on public.tours for each row execute function public.guard_tour_schedule();
drop trigger if exists guard_booking_schedule on public.tour_bookings;
create trigger guard_booking_schedule before insert or update on public.tour_bookings for each row execute function public.guard_tour_schedule();

create or replace function public.refresh_tour_slot_count() returns trigger
language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; slot uuid;
begin
 ids:=case when tg_op='INSERT' then array[new.slot_id] when tg_op='DELETE' then array[old.slot_id] else array[old.slot_id,new.slot_id] end;
 for slot in select distinct x from unnest(ids) x where x is not null order by x loop
  update public.tour_slots set current_bookings=(select count(*) from (
    select id from public.tours where slot_id=slot and status in ('scheduled','confirmed')
    union all select id from public.tour_bookings where slot_id=slot and status in ('scheduled','confirmed')
   ) t) where id=slot;
 end loop;
 return null;
end; $$;
drop trigger if exists refresh_manual_tour_slot on public.tours;
create trigger refresh_manual_tour_slot after insert or update or delete on public.tours for each row execute function public.refresh_tour_slot_count();
drop trigger if exists refresh_widget_tour_slot on public.tour_bookings;
create trigger refresh_widget_tour_slot after insert or update or delete on public.tour_bookings for each row execute function public.refresh_tour_slot_count();

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
 final_result:=jsonb_build_object('state','applied','tour',public.tour_schedule_row(p_property_id,p_source,p_tour_id),'leadStatus',new_status,'changeId',change_id,'queued',work_count,'notificationRequested',coalesce((p_change->>'notify')::boolean,false));
 update public.tour_schedule_changes set result=final_result where id=change_id;
 return final_result;
end; $$;

create or replace function public.reserve_luma_tour(p_property_id uuid,p_lead_id uuid,p_booking jsonb,p_delivery jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.tour_bookings; existing public.tour_bookings; slot public.tour_slots; capacity integer:=1;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if not exists(select 1 from public.leads where id=p_lead_id and property_id=p_property_id) then raise exception 'Lead scope mismatch'; end if;
 b:=jsonb_populate_record(null::public.tour_bookings,p_booking);
 if b.booked_via_conversation_id is not null and not exists(select 1 from public.conversations where id=b.booked_via_conversation_id and property_id=p_property_id) then raise exception 'Conversation scope mismatch'; end if;
 select * into existing from public.tour_bookings where property_id=p_property_id and lead_id=p_lead_id and scheduled_date=b.scheduled_date and scheduled_time=b.scheduled_time and status in ('scheduled','confirmed') order by created_at limit 1;
 if found then return jsonb_build_object('booking',to_jsonb(existing),'duplicate',true); end if;
 if b.slot_id is not null then
   select * into slot from public.tour_slots where id=b.slot_id and property_id=p_property_id and slot_date=b.scheduled_date and start_time=b.scheduled_time and is_available for update;
   if not found or coalesce(slot.current_bookings,0)>=coalesce(slot.max_bookings,1) then raise exception 'Tour slot is no longer available'; end if;
   capacity:=coalesce(slot.max_bookings,1);
 end if;
 -- Include pending reservations while external calendars catch up; overlapping
 -- direct tours cannot both reserve the same host's time.
 if (select count(*) from public.tour_bookings x where property_id=p_property_id and scheduled_date=b.scheduled_date and status in ('scheduled','confirmed')
   and x.scheduled_time < b.scheduled_time+make_interval(mins=>coalesce(b.duration_minutes,30))
   and x.scheduled_time+make_interval(mins=>coalesce(x.duration_minutes,30))>b.scheduled_time) >= capacity then raise exception 'Tour time is no longer available'; end if;
 insert into public.tour_bookings(property_id,lead_id,slot_id,scheduled_date,scheduled_time,duration_minutes,special_requests,source,booked_via_conversation_id,status)
   values(p_property_id,p_lead_id,b.slot_id,b.scheduled_date,b.scheduled_time,coalesce(b.duration_minutes,30),b.special_requests,b.source,b.booked_via_conversation_id,'confirmed') returning * into b;
 insert into public.lead_activities(lead_id,type,description,metadata) values(p_lead_id,'tour_booked',format('Tour reserved for %s at %s',b.scheduled_date,b.scheduled_time),jsonb_build_object('booking_id',b.id));
 update public.leads set status=case when status in ('leased','lost','toured') then status else 'tour_booked' end,crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=p_lead_id;
 insert into public.luma_delivery_jobs(property_id,booking_id,payload) values(p_property_id,b.id,p_delivery);
 return jsonb_build_object('booking',to_jsonb(b),'duplicate',false);
end; $$;

create or replace function public.claim_tour_schedule_work(p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work; s jsonb;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=p_id for update;
 if w.state='running' and w.lease_until<=now() then
  update public.tour_schedule_work set state='review',error_code='delivery_unconfirmed' where id=p_id;return null;
 end if;
 if w.state<>'queued' then return null; end if;
 if w.created_at<now()-interval '23 hours' then update public.tour_schedule_work set state='review',error_code='delivery_window_expired' where id=p_id;return null;end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
 if s is null or (s->>'schedule_version')::integer<>w.schedule_version
  or (w.kind in ('confirmation','reminder_24h','reminder_1h','calendar_reconcile') and s->>'status' not in ('scheduled','confirmed'))
  or (w.kind in ('calendar','notice_email','notice_sms') and s->>'status' not in ('scheduled','confirmed','cancelled')) then
  update public.tour_schedule_work set state='superseded',error_code='schedule_superseded' where id=p_id;return null;
 end if;
 update public.tour_schedule_work set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=p_id returning * into w;
 return to_jsonb(w);
end; $$;

create or replace function public.claim_tour_legacy_delivery(p_property_id uuid,p_source text,p_tour_id uuid,p_version integer,p_kind text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s jsonb; work_id uuid; result jsonb;
begin
 if p_kind not in ('confirmation','reminder_24h','reminder_1h','calendar_reconcile') then raise exception 'Invalid delivery kind'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 s:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);
 if s is null or s->>'status' not in ('scheduled','confirmed') or (s->>'schedule_version')::integer<>p_version then return null; end if;
 if p_kind='calendar_reconcile' and (p_version>1 or exists(select 1 from public.luma_delivery_jobs where booking_id=p_tour_id)) then return null;end if;
 if p_kind='confirmation' and s->>'confirmation_sent_at' is not null then return null; end if;
 if p_kind='reminder_24h' and s->>'reminder_24h_sent_at' is not null then return null; end if;
 if p_kind='reminder_1h' and coalesce(s->>'reminder_1h_sent_at',s->>'reminder_sent_at') is not null then return null; end if;
 insert into public.tour_schedule_work(property_id,lead_id,tour_source,tour_id,schedule_version,kind,payload)
 values(p_property_id,(s->>'lead_id')::uuid,p_source,p_tour_id,p_version,p_kind,s) on conflict(tour_source,tour_id,schedule_version,kind) do nothing;
 select id into work_id from public.tour_schedule_work where tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version and kind=p_kind;
 result:=public.claim_tour_schedule_work(work_id);
 if result is not null then update public.tour_schedule_work set started_at=now() where id=work_id; end if;
 return result;
end; $$;

create or replace function public.start_tour_schedule_work(p_id uuid,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.tour_schedule_work set started_at=coalesce(started_at,now()) where id=p_id and lease_token=p_token and state='running' and lease_until>now();
 return found;
end; $$;

create or replace function public.finish_tour_schedule_work(p_id uuid,p_token uuid,p_receipt jsonb,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare w public.tour_schedule_work; s jsonb;
begin
 select * into w from public.tour_schedule_work where id=p_id;
 if not found then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.property_id::text,12));
 select * into w from public.tour_schedule_work where id=p_id and lease_token=p_token and state in ('running','review') for update;
 if not found then return false; end if;
 s:=public.tour_schedule_row(w.property_id,w.tour_source,w.tour_id);
 if s is null or (s->>'schedule_version')::integer<>w.schedule_version then return false; end if;
 if p_success and (p_receipt is null or p_receipt='{}') then raise exception 'Delivery receipt is required'; end if;
 if p_success and w.kind='calendar' then
  if nullif(p_receipt->>'eventId','') is null then raise exception 'Calendar receipt is required'; end if;
  if exists(select 1 from public.calendar_events where tour_booking_id=w.tour_id and agent_calendar_id=(w.payload->>'calendarId')::uuid) then
   update public.calendar_events set sync_status='synced',last_synced_at=now() where tour_booking_id=w.tour_id and agent_calendar_id=(w.payload->>'calendarId')::uuid;
  elsif w.payload->>'action'<>'cancel' then
   insert into public.calendar_events(agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,provider_event_link,sync_status,last_synced_at)
   values((w.payload->>'calendarId')::uuid,w.tour_id,p_receipt->>'eventId',p_receipt->>'eventId',p_receipt->>'htmlLink','synced',now());
  end if;
 end if;
 update public.tour_schedule_work set state=case when p_success then 'completed' else 'review' end,receipt=p_receipt,
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

-- Existing initial confirmations use the same property lock, so change/claim cannot race.
create or replace function public.claim_luma_delivery() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare candidate public.luma_delivery_jobs; j public.luma_delivery_jobs; b public.tour_bookings;
begin
 for candidate in select * from public.luma_delivery_jobs where state in ('queued','running') and available_at<=now()
   and (lease_until is null or lease_until<=now()) order by created_at limit 20 loop
  perform pg_advisory_xact_lock(hashtextextended(candidate.property_id::text,12));
  select * into j from public.luma_delivery_jobs where id=candidate.id for update;
  if j.state not in ('queued','running') or (j.lease_until is not null and j.lease_until>now()) then continue; end if;
  select * into b from public.tour_bookings where id=j.booking_id and property_id=j.property_id;
  if not found or b.schedule_version<>j.schedule_version or b.status not in ('confirmed','scheduled') then
   update public.luma_delivery_jobs set state='review',error_code='schedule_superseded' where id=j.id;continue;
  end if;
  if j.attempts>=3 or j.first_attempt_at<now()-interval '23 hours' then update public.luma_delivery_jobs set state='review',error_code='retry_window_expired' where id=j.id;continue;end if;
  update public.luma_delivery_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=j.id returning * into j;
  return to_jsonb(j);
 end loop;
 return null;
end; $$;

create or replace function public.record_tour_outcome(
 p_property_id uuid,p_lead_id uuid,p_source text,p_tour_id uuid,p_outcome text,
 p_notes text default null,p_automatic boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 s jsonb; r public.tour_outcomes; l public.leads; w public.workflow_definitions;
 workflow_ids uuid[]:='{}'; v_workflow_id uuid; delay_hours numeric; event_name text;
 followup_state text:='not_configured'; new_status text; legacy boolean:=false; outcome_at timestamptz:=now();
begin
 if p_source is null or p_source not in ('tours','tour_bookings') or p_outcome is null or p_outcome not in ('completed','no_show')
   or length(p_notes)>2000 then raise exception 'Invalid tour outcome input'; end if;
 if p_automatic and p_outcome<>'no_show' then raise exception 'Invalid automatic outcome'; end if;
 -- Shared with the widget reservation path; serialize outcome/booking changes in this property.
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 if p_source='tours' then
   perform 1 from public.tours where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 else
   perform 1 from public.tour_bookings where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 end if;
 if not found then return jsonb_build_object('state','not_found'); end if;
 select * into l from public.leads where id=p_lead_id and property_id=p_property_id for update;
 if not found then return jsonb_build_object('state','not_found'); end if;
 select * into r from public.tour_outcomes where tour_source=p_source and tour_id=p_tour_id;
 if found then
   if r.outcome<>p_outcome then return jsonb_build_object('state','conflict','status',r.outcome); end if;
   return jsonb_build_object('state','replayed','outcome',to_jsonb(r),'leadStatus',l.status);
 end if;
 s:=public.tour_outcome_schedule(p_property_id,p_source,p_tour_id);
 if s->>'status'=p_outcome then
   -- Historical terminal records are acknowledged without replaying old follow-ups.
   legacy:=true; followup_state:='legacy'; outcome_at:=null;
   if p_source='tour_bookings' and p_outcome='completed' then select completed_at into outcome_at from public.tour_bookings where id=p_tour_id; end if;
 elsif coalesce(s->>'status','') not in ('scheduled','confirmed') then
   return jsonb_build_object('state','conflict','status',s->>'status');
 end if;
 if not legacy and p_automatic then
   if s->>'timezone' is null then return jsonb_build_object('state','needs_timezone'); end if;
   if (s->>'endsAt')::timestamptz+interval '1 hour'>now() or (s->>'startsAt')::timestamptz<now()-interval '7 days' then
     return jsonb_build_object('state','not_due');
   end if;
 elsif not legacy and s->>'startsAt' is not null and (s->>'startsAt')::timestamptz>now() then
   return jsonb_build_object('state','not_due');
 end if;
 if not legacy and public.tour_delivery_block(p_property_id,p_source,p_tour_id) is not null then return jsonb_build_object('state',public.tour_delivery_block(p_property_id,p_source,p_tour_id));end if;
 if not legacy and p_source='tour_bookings' then
   -- Do not race a provider request already in progress. Expired/queued work is held.
   perform 1 from public.luma_delivery_jobs where booking_id=p_tour_id for update;
   if exists(select 1 from public.luma_delivery_jobs where booking_id=p_tour_id and state='running' and lease_until>now()) then
     return jsonb_build_object('state','delivery_busy');
   end if;
   update public.luma_delivery_jobs set state='review',error_code='tour_finalized',lease_token=null,lease_until=null
     where booking_id=p_tour_id and state in ('queued','running');
 end if;
 if not legacy then
   if p_source='tours' then
     update public.tours set status=p_outcome,updated_at=now() where id=p_tour_id;
   else
     update public.tour_bookings set status=p_outcome,updated_at=now(),
       completed_at=case when p_outcome='completed' then now() else completed_at end,
       completion_notes=case when p_outcome='completed' then p_notes else completion_notes end where id=p_tour_id;
   end if;
   new_status:=l.status;
   if coalesce(l.status,'') not in ('leased','lost','application','applied','qualified') then
     if p_outcome='completed' then new_status:='toured';
     elsif coalesce(l.status,'')<>'toured'
       and not exists(select 1 from public.tours where lead_id=l.id and status in ('scheduled','confirmed','completed'))
       and not exists(select 1 from public.tour_bookings where lead_id=l.id and status in ('scheduled','confirmed','completed')) then new_status:='contacted';
     end if;
   end if;
   update public.leads set status=new_status,updated_at=now(),
     last_contacted_at=case when p_outcome='completed' then now() else last_contacted_at end,
     crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,
     crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=l.id;
   event_name:=case when p_outcome='completed' then 'tour_completed' else 'tour_no_show' end;
   insert into public.lead_activities(lead_id,type,description,metadata)
     values(l.id,event_name,case when p_outcome='completed' then 'Tour completed' else 'Tour marked as no-show' end,
       jsonb_build_object('tour_id',p_tour_id,'tour_source',p_source,'notes',p_notes,'automatic',p_automatic));
   insert into public.lead_engagement_events(lead_id,property_id,event_type,event_source,score_weight,idempotency_key,metadata)
     values(l.id,p_property_id,event_name,'tourspark',case when p_outcome='completed' then 35 else -25 end,
       'tour-outcome/'||p_source||'/'||p_tour_id, jsonb_build_object('tour_id',p_tour_id,'tour_source',p_source))
     on conflict(property_id,idempotency_key) do nothing;
   perform public.score_lead(l.id);
   if new_status in ('leased','lost') or (p_outcome='no_show' and new_status in ('tour_booked','toured','application','applied','qualified')) then
     followup_state:='suppressed';
   else
     for w in select * from public.workflow_definitions where property_id=p_property_id and trigger_on=event_name and is_active order by id loop
       if jsonb_typeof(w.steps)<>'array' or jsonb_array_length(w.steps)=0 then raise exception 'Tour follow-up workflow has no steps'; end if;
       if coalesce(w.exit_conditions,'[]'::jsonb) ? new_status then continue; end if;
       delay_hours:=coalesce((w.steps->0->>'delay_hours')::numeric,0);
       if delay_hours<0 or delay_hours>8760 then raise exception 'Invalid tour workflow delay'; end if;
       v_workflow_id:=null;
       insert into public.lead_workflows(lead_id,workflow_id,current_step,status,next_action_at)
         values(l.id,w.id,0,'active',now()+make_interval(secs=>(delay_hours*3600)::integer))
         on conflict(lead_id,workflow_id) where lead_id is not null and workflow_id is not null and status in ('active','paused') do nothing
         returning id into v_workflow_id;
       if v_workflow_id is null then select id into v_workflow_id from public.lead_workflows
         where lead_id=l.id and public.lead_workflows.workflow_id=w.id and status in ('active','paused'); end if;
       if v_workflow_id is not null then workflow_ids:=array_append(workflow_ids,v_workflow_id); end if;
     end loop;
     if cardinality(workflow_ids)>0 then followup_state:='configured'; end if;
   end if;
 end if;
 insert into public.tour_outcomes(property_id,lead_id,tour_source,tour_id,outcome,notes,workflow_ids,followup_state,outcome_at)
   values(p_property_id,l.id,p_source,p_tour_id,p_outcome,p_notes,workflow_ids,followup_state,outcome_at) returning * into r;
 return jsonb_build_object('state',case when legacy then 'legacy' else 'applied' end,'outcome',to_jsonb(r),'leadStatus',coalesce(new_status,l.status));
end; $$;

-- Keep completed outcomes from being silently overwritten by older mutation paths.
-- A deliberate correction workflow is separate from rescheduling a scheduled tour.

create or replace function public.tour_outcome_schedule(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with tour as (
   select id,lead_id,property_id,status,tour_date as day,tour_time as time,coalesce(duration_minutes,30) as minutes
   from public.tours where p_source='tours' and id=p_tour_id and property_id=p_property_id
   union all
   select id,lead_id,property_id,status,scheduled_date,scheduled_time,coalesce(duration_minutes,30)
   from public.tour_bookings where p_source='tour_bookings' and id=p_tour_id and property_id=p_property_id
 ), zone as (
   select t.*,coalesce(
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


revoke all on function public.tour_schedule_row(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.tour_schedule_row(uuid,text,uuid) to service_role;

revoke all on function public.tour_delivery_block(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.tour_delivery_block(uuid,text,uuid) to service_role;

revoke all on function public.check_tour_capacity(uuid,text,uuid,date,time,integer,uuid) from public,anon,authenticated;
grant execute on function public.check_tour_capacity(uuid,text,uuid,date,time,integer,uuid) to service_role;

revoke all on function public.guard_tour_schedule() from public,anon,authenticated;
grant execute on function public.guard_tour_schedule() to service_role;

revoke all on function public.refresh_tour_slot_count() from public,anon,authenticated;
grant execute on function public.refresh_tour_slot_count() to service_role;

revoke all on function public.change_tour_schedule(uuid,uuid,text,uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.change_tour_schedule(uuid,uuid,text,uuid,uuid,uuid,integer,jsonb) to service_role;

revoke all on function public.claim_tour_schedule_work(uuid) from public,anon,authenticated;
grant execute on function public.claim_tour_schedule_work(uuid) to service_role;

revoke all on function public.claim_tour_legacy_delivery(uuid,text,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.claim_tour_legacy_delivery(uuid,text,uuid,integer,text) to service_role;

revoke all on function public.start_tour_schedule_work(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_tour_schedule_work(uuid,uuid) to service_role;

revoke all on function public.finish_tour_schedule_work(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.finish_tour_schedule_work(uuid,uuid,jsonb,boolean) to service_role;

alter table public.tour_schedule_work drop constraint if exists tour_schedule_work_kind_check;
alter table public.tour_schedule_work add constraint tour_schedule_work_kind_check check(kind in ('calendar','notice_email','notice_sms','confirmation','reminder_24h','reminder_1h','calendar_reconcile'));

create or replace function public.correct_tour_no_show(
 p_property_id uuid,p_lead_id uuid,p_source text,p_tour_id uuid,p_request_id uuid,p_actor_id uuid,p_reason text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 prior public.tour_outcomes; correction public.tour_outcome_corrections;
 s jsonb; event_ids uuid[]:='{}'; prior_events jsonb:='[]'; workflow_ids uuid[]:='{}';
 delivery text:='none'; completion jsonb; final_result jsonb; corrected_id uuid:=gen_random_uuid();
 reason text:=trim(p_reason); workflow_row public.lead_workflows;
begin
 if p_source is null or p_source not in ('tours','tour_bookings') or p_request_id is null or p_actor_id is null
   or reason is null or length(reason) not between 1 and 2000 then raise exception 'Invalid tour correction input'; end if;
 -- The API derives actor_id from the authenticated session. Check tenant scope again.
 if not exists(select 1 from public.profiles pr join public.properties p on p.org_id=pr.org_id
   where pr.id=p_actor_id and p.id=p_property_id) then return jsonb_build_object('state','forbidden'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into correction from public.tour_outcome_corrections where property_id=p_property_id and request_id=p_request_id;
 if found then
   if correction.lead_id<>p_lead_id or correction.tour_source<>p_source or correction.tour_id<>p_tour_id
     or correction.actor_id<>p_actor_id or correction.reason<>reason then return jsonb_build_object('state','request_conflict'); end if;
   return correction.result || jsonb_build_object('state','replayed','leadStatus',(select status from public.leads where id=p_lead_id and property_id=p_property_id));
 end if;
 if p_source='tours' then
   perform 1 from public.tours where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 else
   perform 1 from public.tour_bookings where id=p_tour_id and property_id=p_property_id and lead_id=p_lead_id for update;
 end if;
 if not found then return jsonb_build_object('state','not_found'); end if;
 perform 1 from public.leads where id=p_lead_id and property_id=p_property_id for update;
 if not found then return jsonb_build_object('state','not_found'); end if;
 s:=public.tour_outcome_schedule(p_property_id,p_source,p_tour_id);
 if s->>'status'<>'no_show' then return jsonb_build_object('state','conflict'); end if;
 if s->>'startsAt' is not null and (s->>'startsAt')::timestamptz>now() then return jsonb_build_object('state','not_due'); end if;
 -- Legacy metadata without a source is only usable for an unambiguous identifier.
 if exists(select 1 from public.tours where id=p_tour_id) and exists(select 1 from public.tour_bookings where id=p_tour_id) then
   return jsonb_build_object('state','history_conflict');
 end if;
 select * into prior from public.tour_outcomes where tour_source=p_source and tour_id=p_tour_id for update;
 if found and (prior.outcome<>'no_show' or prior.property_id<>p_property_id or prior.lead_id<>p_lead_id) then
   return jsonb_build_object('state','history_conflict');
 end if;
 -- Stop only this lead's no-show follow-ups. A completed visit supersedes those
 -- even if an older record lacks a workflow link. Other workflow kinds are retained.
 for workflow_row in select lw.* from public.lead_workflows lw join public.workflow_definitions d on d.id=lw.workflow_id
   where lw.lead_id=p_lead_id and d.property_id=p_property_id and d.trigger_on='tour_no_show'
     and (lw.status in ('active','paused') or lw.processing_started_at is not null or lw.processing_expires_at is not null) order by lw.id for update of lw loop
   if workflow_row.processing_started_at is not null or workflow_row.processing_expires_at is not null then
     if workflow_row.processing_expires_at>now() then return jsonb_build_object('state','delivery_busy');
     else return jsonb_build_object('state','delivery_review_required'); end if;
   end if;
   if workflow_row.status in ('active','paused') then workflow_ids:=array_append(workflow_ids,workflow_row.id); end if;
 end loop;
 if public.tour_delivery_block(p_property_id,p_source,p_tour_id) is not null then return jsonb_build_object('state',public.tour_delivery_block(p_property_id,p_source,p_tour_id));end if;
 if p_source='tour_bookings' then
   perform 1 from public.luma_delivery_jobs where booking_id=p_tour_id for update;
   if exists(select 1 from public.luma_delivery_jobs where booking_id=p_tour_id and state='running' and lease_until>now()) then
     return jsonb_build_object('state','delivery_busy');
   end if;
 end if;
 -- Evidence of prior sends is kept honest; an already accepted message cannot be recalled.
 if exists(select 1 from public.workflow_actions a join public.lead_workflows lw on lw.id=a.lead_workflow_id
     join public.workflow_definitions d on d.id=lw.workflow_id where lw.lead_id=p_lead_id and d.property_id=p_property_id
     and d.trigger_on='tour_no_show' and a.status='sent' and nullif(a.external_id,'') is not null)
   or (p_source='tours' and exists(select 1 from public.tours where id=p_tour_id and noshow_followup_sent_at is not null)) then delivery:='sent';
 elsif prior.id is null or prior.followup_state='legacy' or exists(select 1 from public.workflow_actions a
     join public.lead_workflows lw on lw.id=a.lead_workflow_id join public.workflow_definitions d on d.id=lw.workflow_id
     where lw.lead_id=p_lead_id and d.property_id=p_property_id and d.trigger_on='tour_no_show'
       and (a.status is distinct from 'skipped')) then delivery:='unknown';
 end if;
 -- Lock and preserve precisely the no-show events for this tour; other penalties stay intact.
 perform 1 from public.lead_engagement_events e where e.lead_id=p_lead_id and (e.property_id=p_property_id or e.property_id is null)
   and e.event_type='tour_no_show' and (e.idempotency_key='tour-outcome/'||p_source||'/'||p_tour_id or
     (coalesce(e.metadata->>'tour_id',e.metadata->>'booking_id')=p_tour_id::text and coalesce(e.metadata->>'tour_source',p_source)=p_source)) for update;
 select coalesce(array_agg(e.id),'{}'),coalesce(jsonb_agg(to_jsonb(e)),'[]') into event_ids,prior_events
   from public.lead_engagement_events e where e.lead_id=p_lead_id and (e.property_id=p_property_id or e.property_id is null)
   and e.event_type='tour_no_show' and (e.idempotency_key='tour-outcome/'||p_source||'/'||p_tour_id or
     (coalesce(e.metadata->>'tour_id',e.metadata->>'booking_id')=p_tour_id::text and coalesce(e.metadata->>'tour_source',p_source)=p_source));
 if exists(select 1 from public.lead_engagement_events e where e.lead_id=p_lead_id and e.event_type='tour_completed'
   and coalesce(e.metadata->>'tour_id',e.metadata->>'booking_id')=p_tour_id::text) then return jsonb_build_object('state','history_conflict'); end if;
 insert into public.tour_outcome_corrections(id,property_id,lead_id,tour_source,tour_id,request_id,actor_id,reason,previous_outcome,previous_events,stopped_workflow_ids,previous_delivery)
   values(corrected_id,p_property_id,p_lead_id,p_source,p_tour_id,p_request_id,p_actor_id,reason,coalesce(to_jsonb(prior),'{}')||jsonb_build_object('_schedule',s),prior_events,workflow_ids,delivery);
 update public.lead_workflows set status='stopped',next_action_at=null,updated_at=now() where id=any(workflow_ids);
 update public.lead_engagement_events set score_weight=0,idempotency_key='tour-correction/'||corrected_id||'/'||id,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('reversed_by_correction',corrected_id,'previous_score_weight',score_weight)
   where id=any(event_ids);
 delete from public.tour_outcomes where tour_source=p_source and tour_id=p_tour_id;
 if p_source='tours' then update public.tours set status='confirmed' where id=p_tour_id;
 else update public.tour_bookings set status='confirmed' where id=p_tour_id; end if;
 completion:=public.record_tour_outcome(p_property_id,p_lead_id,p_source,p_tour_id,'completed',reason,false);
 if completion->>'state'<>'applied' then raise exception 'Correction completion was not confirmed'; end if;
 insert into public.lead_activities(lead_id,type,description,metadata,created_by) values(p_lead_id,'tour_outcome_corrected',
   'No-show corrected to completed: '||reason,
   jsonb_build_object('tour_id',p_tour_id,'_tour_source',p_source,'_correction_id',corrected_id,'_previous_delivery',delivery),p_actor_id);
 final_result:=completion||jsonb_build_object('correction',jsonb_build_object('id',corrected_id,'reason',reason,'recordedAt',now(),
   'previousDelivery',delivery,'stoppedWorkflows',cardinality(workflow_ids),'reversedEvents',cardinality(event_ids)));
 update public.tour_outcome_corrections set result=final_result where id=corrected_id;
 return final_result;
end; $$;
