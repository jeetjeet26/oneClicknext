-- Automatic no-show outcomes are database-only transactions, with bounded retries.
-- No provider calls, historical replay or live delivery are enabled by this migration.
create table public.tour_noshow_attempts (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade,
 tour_source text not null check(tour_source in ('tours','tour_bookings')),
 tour_id uuid not null, schedule_version integer not null check(schedule_version>0),
 state text not null check(state in ('backoff','review','completed','skipped')),
 attempts integer not null check(attempts between 1 and 3),
 next_try_at timestamptz, last_attempt_at timestamptz not null default now(),
 error_code text, result jsonb,
 unique(tour_source,tour_id,schedule_version)
);
create index tour_noshow_attempts_property_idx on public.tour_noshow_attempts(property_id);
create index tour_noshow_attempts_lead_idx on public.tour_noshow_attempts(lead_id);
alter table public.tour_noshow_attempts enable row level security;
revoke all on public.tour_noshow_attempts from public,anon,authenticated;
grant all on public.tour_noshow_attempts to service_role;

create function public.tour_noshow_state(p_property_id uuid,p_source text,p_tour_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;version integer;a public.tour_noshow_attempts;decision text;
begin
 s:=public.tour_reminder_schedule(p_property_id,p_source,p_tour_id);
 if s is null or coalesce(s->>'status','') not in ('scheduled','confirmed') then return null;end if;
 version:=(public.tour_schedule_row(p_property_id,p_source,p_tour_id)->>'schedule_version')::integer;
 select * into a from public.tour_noshow_attempts where tour_source=p_source and tour_id=p_tour_id and schedule_version=version;
 decision:=case
  when (s->>'date')::date<(now() at time zone 'UTC')::date-8 then 'backlog'
  when s->>'leadId' is null then 'needs_lead'
  when s->>'issue'='needs_timezone' then 'needs_timezone'
  when s->>'issue' is not null then 'ambiguous_time'
  when (s->>'startsAt')::timestamptz<now()-interval '7 days' then 'backlog'
  when (s->>'endsAt')::timestamptz+interval '1 hour'>now() then 'upcoming'
  when a.state='review' then 'review'
  when a.state in ('completed','skipped') then 'review'
  when a.next_try_at>now() then 'backoff'
  else 'due' end;
 return s||jsonb_build_object('scheduleVersion',version,'automation',jsonb_build_object(
  'state',decision,'attempts',coalesce(a.attempts,0),'nextTryAt',a.next_try_at,'errorCode',a.error_code));
end; $$;

create function public.tour_noshow_queue(p_property_id uuid default null,p_lead_id uuid default null)
returns setof jsonb language sql stable security invoker set search_path='' as $$
 with tours as (
  select id,property_id,'tours'::text source,tour_date as day from public.tours where status in ('scheduled','confirmed')
   and (p_property_id is null or property_id=p_property_id) and (p_lead_id is null or lead_id=p_lead_id)
  union all select id,property_id,'tour_bookings',scheduled_date from public.tour_bookings where status in ('scheduled','confirmed')
   and (p_property_id is null or property_id=p_property_id) and (p_lead_id is null or lead_id=p_lead_id)
 ) select public.tour_noshow_state(property_id,source,id) from tours where day<=(now() at time zone 'UTC')::date+1;
$$;

create or replace function public.list_tour_noshow_candidates(p_limit integer default 100)
returns jsonb language sql stable security invoker set search_path='' as $$
 with schedules as materialized (select s from public.tour_noshow_queue() s), due as (
  select s from schedules where s->'automation'->>'state'='due'
  order by (s->>'endsAt')::timestamptz,s->>'source',s->>'id' limit greatest(1,least(p_limit,250))
 ) select jsonb_build_object('tours',coalesce((select jsonb_agg(s) from due),'[]'),
  'needsTimezone',count(*) filter(where s->'automation'->>'state'='needs_timezone'),
  'needsReview',count(*) filter(where s->'automation'->>'state' in ('review','ambiguous_time','needs_lead')),
  'backlog',count(*) filter(where s->'automation'->>'state'='backlog'),
  'deferred',count(*) filter(where s->'automation'->>'state'='backoff')) from schedules;
$$;

create function public.process_tour_noshow_attempt(p_property_id uuid,p_lead_id uuid,p_source text,p_tour_id uuid,p_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb;a public.tour_noshow_attempts;r jsonb;code text;decision text;
begin
 if p_source is null or p_source not in ('tours','tour_bookings') or p_version is null or p_version<1 then raise exception 'Invalid no-show attempt';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 s:=public.tour_schedule_row(p_property_id,p_source,p_tour_id);
 if s is null or (s->>'lead_id')::uuid is distinct from p_lead_id then return '{"state":"not_found"}';end if;
 if (s->>'schedule_version')::integer<>p_version then return '{"state":"stale"}';end if;
 select * into a from public.tour_noshow_attempts where tour_source=p_source and tour_id=p_tour_id and schedule_version=p_version for update;
 if a.state='completed' then return a.result||'{"state":"replayed"}';end if;
 if a.state='skipped' then return '{"state":"skipped"}';end if;
 s:=public.tour_noshow_state(p_property_id,p_source,p_tour_id);
 if s is null then return '{"state":"conflict"}';end if;
 decision:=s->'automation'->>'state';
 if decision<>'due' then return jsonb_build_object('state',decision);end if;
 insert into public.tour_noshow_attempts(property_id,lead_id,tour_source,tour_id,schedule_version,state,attempts)
 values(p_property_id,p_lead_id,p_source,p_tour_id,p_version,'backoff',1)
 on conflict(tour_source,tour_id,schedule_version) do update set attempts=tour_noshow_attempts.attempts+1,last_attempt_at=now()
 returning * into a;
 -- Errors roll back all outcome effects, while the outer transaction retains the attempt.
 begin
  r:=public.record_tour_outcome(p_property_id,p_lead_id,p_source,p_tour_id,'no_show',null,true);
 exception when others then
  code:='outcome_transaction_failed';r:=jsonb_build_object('state','failed');
 end;
 if r->>'state' in ('applied','replayed','legacy') then
  update public.tour_noshow_attempts set state='completed',result=r,next_try_at=null,error_code=null where id=a.id;
  return r;
 elsif r->>'state' in ('not_found','conflict','not_due') then
  update public.tour_noshow_attempts set state='skipped',result=r,next_try_at=null,error_code=r->>'state' where id=a.id;
  return r;
 end if;
 code:=coalesce(code,r->>'state','unconfirmed_outcome');
 decision:=case when a.attempts>=3 or code in ('delivery_review_required','needs_timezone') then 'review' else 'backoff' end;
 update public.tour_noshow_attempts set state=decision,error_code=code,result=r,
  next_try_at=case when decision='backoff' then now()+case when a.attempts=1 then interval '15 minutes' else interval '1 hour' end end where id=a.id;
 return jsonb_build_object('state',decision,'attempts',a.attempts,'errorCode',code);
end; $$;

revoke all on function public.tour_noshow_state(uuid,text,uuid),public.tour_noshow_queue(uuid,uuid),public.process_tour_noshow_attempt(uuid,uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.tour_noshow_state(uuid,text,uuid),public.tour_noshow_queue(uuid,uuid),public.process_tour_noshow_attempt(uuid,uuid,text,uuid,integer) to service_role;

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
   -- A delayed attendance correction is not permission to launch a fresh missed-tour campaign.
   if new_status in ('leased','lost') or (p_outcome='no_show' and (
     new_status in ('tour_booked','toured','application','applied','qualified')
     or s->>'startsAt' is null or (s->>'startsAt')::timestamptz<now()-interval '24 hours'
     or public.tour_reminder_schedule(p_property_id,p_source,p_tour_id)->>'issue' is not null)) then
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
notify pgrst, 'reload schema';
