-- Local Phase 5 increment: one atomic completion/no-show outcome for both tour sources.
-- No external delivery occurs in these functions. Follow-ups use configured workflows.
create table if not exists public.tour_outcomes (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 tour_source text not null check(tour_source in ('tours','tour_bookings')),
 tour_id uuid not null,
 outcome text not null check(outcome in ('completed','no_show')),
 recorded_at timestamptz not null default now(),
 outcome_at timestamptz,
 notes text,
 workflow_ids uuid[] not null default '{}',
 followup_state text not null check(followup_state in ('configured','not_configured','suppressed','legacy')),
 unique(tour_source,tour_id)
);
alter table public.tour_outcomes add column if not exists outcome_at timestamptz;
create index if not exists tour_outcomes_property on public.tour_outcomes(property_id);
create index if not exists tour_outcomes_lead on public.tour_outcomes(lead_id);
alter table public.tour_outcomes enable row level security;
revoke all on public.tour_outcomes from public,anon,authenticated;
grant all on public.tour_outcomes to service_role;

-- A linked calendar owns a widget booking's timezone. Otherwise use explicit
-- property settings, or a single unambiguous configured calendar timezone.
-- An unknown zone stays unknown; the worker must not guess the server timezone.
create or replace function public.tour_outcome_schedule(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with tour as (
   select id,lead_id,property_id,status,tour_date as day,tour_time as time,30 as minutes
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
create or replace function public.protect_recorded_tour_outcome() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.status is distinct from old.status or
     (tg_table_name='tours' and (to_jsonb(new)->>'tour_date',to_jsonb(new)->>'tour_time') is distinct from (to_jsonb(old)->>'tour_date',to_jsonb(old)->>'tour_time')) or
     (tg_table_name='tour_bookings' and (to_jsonb(new)->>'scheduled_date',to_jsonb(new)->>'scheduled_time') is distinct from (to_jsonb(old)->>'scheduled_date',to_jsonb(old)->>'scheduled_time')))
   and old.status in ('completed','no_show') then
   raise exception 'Recorded tour outcome requires a deliberate correction' using errcode='55000';
 end if;
 return new;
end; $$;
drop trigger if exists protect_tour_outcome on public.tours;
create trigger protect_tour_outcome before update on public.tours for each row execute function public.protect_recorded_tour_outcome();
drop trigger if exists protect_booking_outcome on public.tour_bookings;
create trigger protect_booking_outcome before update on public.tour_bookings for each row execute function public.protect_recorded_tour_outcome();

create or replace function public.list_tour_noshow_candidates(p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 with candidates as (
   select id,property_id,tour_date as day,'tours'::text as source from public.tours where status in ('scheduled','confirmed')
     and tour_date between current_date-8 and current_date+1
   union all
   select id,property_id,scheduled_date,'tour_bookings' from public.tour_bookings where status in ('scheduled','confirmed')
     and scheduled_date between current_date-8 and current_date+1
 ), schedules as (
   select public.tour_outcome_schedule(property_id,source,id) as s,day,id from candidates
 ), due as (
   select s from schedules where s->>'leadId' is not null and s->>'timezone' is not null
     and (s->>'startsAt')::timestamptz>=now()-interval '7 days'
     and (s->>'endsAt')::timestamptz+interval '1 hour'<=now()
     order by day,id limit greatest(1,least(p_limit,250))
 ) select jsonb_build_object('tours',coalesce((select jsonb_agg(s) from due),'[]'::jsonb),
   'needsTimezone',(select count(*) from schedules where s->>'timezone' is null));
$$;

create or replace function public.tour_noshow_stats(p_property_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 with all_tours as (
   select id,lead_id,tour_date+tour_time as starts_at,created_at,status,'tours'::text as source,noshow_followup_sent_at as sent_at
     from public.tours where property_id=p_property_id
   union all
   select id,lead_id,scheduled_date+scheduled_time,created_at,status,'tour_bookings',null::timestamptz
     from public.tour_bookings where property_id=p_property_id
 ), missed as (
   select t.*,r.workflow_ids,r.followup_state, t.sent_at is not null or exists(
     select 1 from public.workflow_actions a where a.lead_workflow_id=any(r.workflow_ids)
       and a.status='sent' and nullif(a.external_id,'') is not null) as sent
   from all_tours t left join public.tour_outcomes r on r.tour_source=t.source and r.tour_id=t.id
   where t.status='no_show'
 ) select jsonb_build_object('totalNoShows',count(*),'followupsSent',count(*) filter(where sent),
   'followupsQueued',count(*) filter(where not sent and exists(select 1 from public.lead_workflows w where w.id=any(workflow_ids) and w.status in ('active','paused'))),
   'needsSetup',count(*) filter(where followup_state='not_configured'),
   'rescheduled',count(*) filter(where exists(select 1 from all_tours n where n.lead_id=missed.lead_id and n.starts_at>missed.starts_at
      and n.created_at>missed.created_at and n.status in ('scheduled','confirmed','completed')))) from missed;
$$;
revoke all on function public.tour_outcome_schedule(uuid,text,uuid),public.record_tour_outcome(uuid,uuid,text,uuid,text,text,boolean),public.protect_recorded_tour_outcome(),public.list_tour_noshow_candidates(integer),public.tour_noshow_stats(uuid) from public,anon,authenticated;
grant execute on function public.tour_outcome_schedule(uuid,text,uuid),public.record_tour_outcome(uuid,uuid,text,uuid,text,text,boolean),public.protect_recorded_tour_outcome(),public.list_tour_noshow_candidates(integer),public.tour_noshow_stats(uuid) to service_role;
notify pgrst,'reload schema';
