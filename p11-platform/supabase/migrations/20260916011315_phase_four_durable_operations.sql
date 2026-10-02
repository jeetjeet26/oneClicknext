-- Durable GEO work is explicitly enrolled. Existing queued/running jobs are not replayed.
alter table public.geo_runs add column if not exists execution_version integer not null default 1;
create table if not exists public.geo_execution_jobs (
  run_id uuid primary key references public.geo_runs(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  surface text not null,
  snapshot jsonb not null,
  state text not null default 'queued' check (state in ('queued','running','completed','partial','failed')),
  lease_token uuid,
  lease_until timestamptz,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  claim_count integer not null default 0
);
create index if not exists geo_execution_jobs_property on public.geo_execution_jobs(property_id,created_at);
create index if not exists geo_execution_jobs_due on public.geo_execution_jobs(state,available_at);
create table if not exists public.geo_execution_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.geo_execution_jobs(run_id) on delete cascade,
  ordinal integer not null,
  query_snapshot jsonb not null,
  state text not null default 'queued' check (state in ('queued','running','completed','failed')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  score jsonb,
  answer_id uuid references public.geo_answers(id) on delete set null,
  error_code text,
  unique(run_id,ordinal)
);
create index if not exists geo_execution_items_answer on public.geo_execution_items(answer_id);
alter table public.geo_execution_jobs enable row level security;
alter table public.geo_execution_items enable row level security;
revoke all on public.geo_execution_jobs,public.geo_execution_items from public,anon,authenticated;
grant all on public.geo_execution_jobs,public.geo_execution_items to service_role;


create table if not exists public.geo_analysis_jobs (
 batch_id uuid primary key, property_id uuid not null references public.properties(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','running','completed','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,error_code text,created_at timestamptz not null default now()
);
create index if not exists geo_analysis_jobs_property on public.geo_analysis_jobs(property_id);
alter table public.geo_analysis_jobs enable row level security;
revoke all on public.geo_analysis_jobs from public,anon,authenticated;
grant all on public.geo_analysis_jobs to service_role;

create or replace function public.enqueue_geo_execution(p_run_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare r public.geo_runs; prop jsonb; cfg jsonb; n integer; repeats integer;
begin
  select * into r from public.geo_runs where id=p_run_id for update;
  if not found then raise exception 'Run not found'; end if;
  if exists(select 1 from public.geo_execution_jobs where run_id=p_run_id) then
    return jsonb_build_object('accepted',true,'run_id',p_run_id); end if;
  if r.status <> 'queued' then raise exception 'Run must be queued'; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.property_id::text, 4));
  if (select count(*) from public.geo_execution_jobs where property_id=r.property_id and created_at>now()-interval '24 hours') >= 24 then
    raise exception 'Property daily audit limit reached'; end if;
  repeats:=greatest(1,least(5,coalesce(r.execution_count,1)));
  select count(*) * repeats into n from public.geo_queries where property_id=r.property_id and is_active;
  if n < 1 or n > 300 then raise exception 'Audit requires 1 to 300 query executions'; end if;
  select jsonb_build_object('name',name,'address',address,'website_url',website_url) into prop from public.properties where id=r.property_id;
  select jsonb_build_object('domains',domains,'competitor_domains',competitor_domains) into cfg from public.geo_property_config where property_id=r.property_id;
  insert into public.geo_execution_jobs(run_id,property_id,surface,snapshot)
    values(p_run_id,r.property_id,r.surface::text,jsonb_build_object('run',to_jsonb(r),'property',prop,'config',coalesce(cfg,'{}')));
  insert into public.geo_execution_items(run_id,ordinal,query_snapshot)
    select p_run_id,row_number() over(order by q.id,rep)::integer,to_jsonb(q)
    from public.geo_queries q cross join generate_series(1,repeats) rep where q.property_id=r.property_id and q.is_active;
  update public.geo_runs set execution_version=2,query_count=n,run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('execution_version',2,'expected_executions',n,'max_attempts',3) where id=p_run_id;
  if r.batch_id is not null then insert into public.geo_analysis_jobs(batch_id,property_id) values(r.batch_id,r.property_id) on conflict(batch_id) do nothing; end if;
  return jsonb_build_object('accepted',true,'run_id',p_run_id,'expected',n);
end; $$;

create or replace function public.claim_geo_execution(p_run_id uuid default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.geo_execution_jobs; token uuid := gen_random_uuid();
begin
  -- Serialize admission, not provider work. At most four workers and one per surface.
  perform pg_advisory_xact_lock(401904);
  update public.geo_execution_jobs expired_job set state='failed',finished_at=now(),lease_until=null,lease_token=null
    where expired_job.state in ('queued','running') and exists(select 1 from public.geo_runs r where r.id=expired_job.run_id and r.status not in ('queued','running'));
  -- Bound crashes before an item can even be claimed, in addition to item retries.
  update public.geo_runs r set status='failed',finished_at=now(),error_message='Execution could not recover after repeated worker interruptions'
    where r.status in ('queued','running') and exists(select 1 from public.geo_execution_jobs expired_job where expired_job.run_id=r.id and expired_job.claim_count>=1000 and (expired_job.lease_until is null or expired_job.lease_until<=now()));
  if (select count(*) from public.geo_execution_jobs where state='running' and lease_until>now()) >= 4 then return null; end if;
  select * into j from public.geo_execution_jobs x
    where (p_run_id is null or x.run_id=p_run_id) and x.state in ('queued','running') and x.available_at<=now()
      and (x.lease_until is null or x.lease_until<=now())
      and exists(select 1 from public.geo_runs r where r.id=x.run_id and r.status in ('queued','running'))
      and not exists(select 1 from public.geo_execution_jobs y where y.surface=x.surface and y.state='running' and y.lease_until>now())
    order by x.created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.geo_execution_jobs set state='running',lease_token=token,lease_until=now()+interval '3 minutes',claim_count=claim_count+1 where run_id=j.run_id returning * into j;
  update public.geo_runs set status='running',last_updated_at=now() where id=j.run_id;
  -- A interrupted provider call counts as an attempt; completed items never run again.
  update public.geo_execution_items set state=case when attempts>=3 then 'failed' else 'queued' end,error_code='worker_interrupted'
    where run_id=j.run_id and state='running';
  return to_jsonb(j);
end; $$;

create or replace function public.advance_geo_execution(p_run_id uuid,p_token uuid,p_item_id uuid default null,p_result jsonb default null,p_error text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare j public.geo_execution_jobs; item public.geo_execution_items; a public.geo_answers; c jsonb; n integer; done integer; failed integer;
begin
 select * into j from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>now() and state='running' for update;
 if not found or not exists(select 1 from public.geo_runs where id=p_run_id and status='running') then raise exception 'Execution lease lost'; end if;
 update public.geo_execution_jobs set lease_until=now()+interval '3 minutes' where run_id=p_run_id;
 update public.geo_runs set last_updated_at=now() where id=p_run_id;
 if p_item_id is not null then
   select * into item from public.geo_execution_items where id=p_item_id and run_id=p_run_id for update;
   if not found then raise exception 'Execution item missing'; end if;
   if item.state='completed' then return jsonb_build_object('saved',true); end if;
   if item.state<>'running' then raise exception 'Execution item is not running'; end if;
   if p_result is not null then
     a := jsonb_populate_record(null::public.geo_answers,p_result->'answer');
     if a.query_id<>(item.query_snapshot->>'id')::uuid or a.run_id<>p_run_id then raise exception 'Answer scope mismatch'; end if;
     insert into public.geo_answers(run_id,query_id,presence,llm_rank,link_rank,sov,flags,answer_summary,ordered_entities,raw_json,natural_response,analysis_method)
       values(p_run_id,a.query_id,a.presence,a.llm_rank,a.link_rank,a.sov,a.flags,a.answer_summary,a.ordered_entities,a.raw_json,a.natural_response,a.analysis_method) returning id into a.id;
     for c in select value from jsonb_array_elements(coalesce(p_result->'citations','[]')) loop
       insert into public.geo_citations(answer_id,url,domain,is_brand_domain,entity_ref)
         values(a.id,c->>'url',c->>'domain',(c->>'is_brand_domain')::boolean,c->>'entity_ref');
     end loop;
     update public.geo_execution_items set state='completed',answer_id=a.id,score=p_result->'score',error_code=null where id=item.id;
   else
     update public.geo_execution_items set state=case when attempts>=3 or p_error='missing_provider_key' then 'failed' else 'queued' end,error_code=p_error where id=item.id;
     if p_error='missing_provider_key' then update public.geo_execution_items set state='failed',error_code=p_error where run_id=p_run_id and state='queued'; end if;
     update public.geo_execution_jobs set state='queued',lease_until=null,lease_token=null,available_at=now()+make_interval(secs=>least(120,10*power(2,item.attempts)::integer)) where run_id=p_run_id;
     return jsonb_build_object('retry_scheduled',true);
   end if;
 end if;
 select count(*),count(*) filter(where state='completed'),count(*) filter(where state='failed') into n,done,failed from public.geo_execution_items where run_id=p_run_id;
 update public.geo_runs set current_query_index=done+failed,progress_pct=floor(100.0*(done+failed)/n),run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('expected_executions',n,'successful_executions',done,'failed_executions',failed,'coverage_pct',round(100.0*done/n,1)) where id=p_run_id;
 select * into item from public.geo_execution_items where run_id=p_run_id and state='queued' order by ordinal limit 1 for update;
 if found then
   update public.geo_execution_items set state='running',attempts=attempts+1 where id=item.id returning * into item;
   return jsonb_build_object('item',to_jsonb(item));
 end if;
 return jsonb_build_object('ready_to_finish',true,'expected',n,'succeeded',done,'failed',failed);
end; $$;

create or replace function public.finish_geo_execution(p_run_id uuid,p_token uuid,p_aggregate jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare n integer; done integer; failed integer; final_state text;
begin
 perform 1 from public.geo_execution_jobs where run_id=p_run_id and lease_token=p_token and lease_until>now() and state='running' for update;
 if not found then raise exception 'Execution lease lost'; end if;
 select count(*),count(*) filter(where state='completed'),count(*) filter(where state='failed') into n,done,failed from public.geo_execution_items where run_id=p_run_id;
 if done+failed<>n then raise exception 'Unfinished execution items'; end if;
 final_state:=case when done=0 then 'failed' when failed>0 then 'partial' else 'completed' end;
 if done>0 then
   insert into public.geo_scores(run_id,overall_score,visibility_pct,avg_llm_rank,avg_link_rank,avg_sov,breakdown,query_scores)
     values(p_run_id,(p_aggregate->>'overall_score')::numeric,(p_aggregate->>'visibility_pct')::numeric,(p_aggregate->>'avg_llm_rank')::numeric,(p_aggregate->>'avg_link_rank')::numeric,(p_aggregate->>'avg_sov')::numeric,
       coalesce(p_aggregate->'breakdown','{}')||jsonb_build_object('coverage_pct',round(100.0*done/n,1),'expected',n,'succeeded',done,'failed',failed,'measurement_state',final_state),
       (select coalesce(jsonb_agg(score order by ordinal),'[]') from public.geo_execution_items where run_id=p_run_id and state='completed'));
 end if;
 -- Existing status enums/readers stay compatible: incomplete measurements are failed,
 -- while their saved answers and score remain available with explicit coverage.
 update public.geo_runs set status=case when failed=0 then 'completed'::public.geo_run_status_enum else 'failed'::public.geo_run_status_enum end,
   finished_at=now(),progress_pct=100,last_updated_at=now(),
   error_message=case when failed>0 then format('Incomplete measurement: %s of %s executions succeeded; %s failed after bounded retries.',done,n,failed) else null end,
   provider_failure_reason=case when failed>0 then 'partial_measurement' else null end,
   run_metadata=coalesce(run_metadata,'{}')||jsonb_build_object('measurement_state',final_state,'expected_executions',n,'successful_executions',done,'failed_executions',failed,'coverage_pct',round(100.0*done/n,1))
   where id=p_run_id and status='running';
 if not found then raise exception 'Run is no longer running'; end if;
 update public.geo_execution_jobs set state=final_state,lease_until=null,lease_token=null,finished_at=now() where run_id=p_run_id;
 return jsonb_build_object('state',final_state,'succeeded',done,'failed',failed,'expected',n);
end; $$;
revoke all on function public.enqueue_geo_execution(uuid),public.claim_geo_execution(uuid),public.advance_geo_execution(uuid,uuid,uuid,jsonb,text),public.finish_geo_execution(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.enqueue_geo_execution(uuid),public.claim_geo_execution(uuid),public.advance_geo_execution(uuid,uuid,uuid,jsonb,text),public.finish_geo_execution(uuid,uuid,jsonb) to service_role;

-- Shared request identities, public admission and bounded AI token reservations.
create table if not exists public.luma_requests (
  property_id uuid not null references public.properties(id) on delete cascade,
  request_id uuid not null,
  operation text not null check(operation in ('chat','lead','tours')),
  input_hash text not null,
  state text not null default 'running' check(state in ('running','completed','review')),
  lease_token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default now()+interval '3 minutes',
  created_at timestamptz not null default now(),
  response jsonb, http_status integer,
  primary key(property_id,request_id)
);
create table if not exists public.luma_allowances (
  property_id uuid not null references public.properties(id) on delete cascade,
  bucket text not null,
  used bigint not null default 0,
  expires_at timestamptz not null,
  primary key(property_id,bucket)
);
alter table public.luma_requests enable row level security;
alter table public.luma_allowances enable row level security;
revoke all on public.luma_requests,public.luma_allowances from public,anon,authenticated;
grant all on public.luma_requests,public.luma_allowances to service_role;

create or replace function public.reserve_luma_allowance(p_property_id uuid,p_bucket text,p_units bigint,p_limit bigint,p_expires_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare total bigint;
begin
 if p_units<1 or p_limit<1 then raise exception 'Invalid allowance'; end if;
 insert into public.luma_allowances(property_id,bucket,used,expires_at) values(p_property_id,p_bucket,0,p_expires_at) on conflict do nothing;
 update public.luma_allowances set used=used+p_units where property_id=p_property_id and bucket=p_bucket and used+p_units<=p_limit returning used into total;
 return found;
end; $$;

create or replace function public.claim_luma_request(p_property_id uuid,p_request_id uuid,p_operation text,p_input_hash text,p_actor text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.luma_requests; minute text := to_char(now() at time zone 'UTC','YYYYMMDDHH24MI');
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||p_request_id::text,7));
 select * into r from public.luma_requests where property_id=p_property_id and request_id=p_request_id for update;
 if found then
   if r.operation<>p_operation or r.input_hash<>p_input_hash then return jsonb_build_object('state','conflict'); end if;
   if r.state='running' and r.expires_at<=now() then
     update public.luma_requests set state='review' where property_id=p_property_id and request_id=p_request_id;
     return jsonb_build_object('state','review');
   end if;
   return to_jsonb(r)-'input_hash'-'lease_token';
 end if;
 -- Property cap remains effective even when a visitor spoofs their IP/header.
 if not public.reserve_luma_allowance(p_property_id,'requests:'||minute,1,120,now()+interval '1 day') or
    not public.reserve_luma_allowance(p_property_id,'actor:'||minute||':'||p_actor,1,20,now()+interval '1 day') then
   return jsonb_build_object('state','limited'); end if;
 insert into public.luma_requests(property_id,request_id,operation,input_hash) values(p_property_id,p_request_id,p_operation,p_input_hash) returning * into r;
 return jsonb_build_object('state','claimed','token',r.lease_token);
end; $$;
create or replace function public.finish_luma_request(p_property_id uuid,p_request_id uuid,p_token uuid,p_response jsonb,p_status integer) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.luma_requests set state=case when p_status>=500 then 'review' else 'completed' end,response=p_response,http_status=p_status
   where property_id=p_property_id and request_id=p_request_id and lease_token=p_token and state='running' and expires_at>now();
 return found;
end; $$;

-- Contact matching and CRM/workflow handoff commit in the same transaction.
create or replace function public.upsert_luma_lead(p_property_id uuid,p_email text,p_phone text,p_existing_id uuid,p_create jsonb,p_update jsonb,p_activity jsonb default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare l public.leads; incoming public.leads; matched text; existing boolean:=false; w public.workflow_definitions; first_delay numeric;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,11));
 select * into l from public.leads where property_id=p_property_id and id=p_existing_id;
 if found then matched:='id'; else
   select * into l from public.leads where property_id=p_property_id and lower(trim(email))=lower(nullif(trim(p_email),'')) order by created_at,id limit 1;
   if found then matched:='email'; else
     select * into l from public.leads where property_id=p_property_id and phone=nullif(trim(p_phone),'') order by created_at,id limit 1;
     if found then matched:='phone'; end if;
   end if;
 end if;
 existing:=l.id is not null;
 if existing then
   incoming:=jsonb_populate_record(l,p_update);
   if nullif(trim(p_update->>'notes'),'') is not null and position((p_update->>'notes') in coalesce(l.notes,''))=0 then
     incoming.notes:=concat_ws(E'\n\n',nullif(l.notes,''),p_update->>'notes'); end if;
   update public.leads set first_name=incoming.first_name,last_name=incoming.last_name,email=incoming.email,phone=incoming.phone,
      notes=incoming.notes,move_in_date=incoming.move_in_date,bedrooms=incoming.bedrooms,status=incoming.status,updated_at=now()
      where id=l.id returning * into l;
 else
   incoming:=jsonb_populate_record(null::public.leads,p_create);
   insert into public.leads(property_id,first_name,last_name,email,phone,source,status,notes,move_in_date,bedrooms)
     values(p_property_id,coalesce(incoming.first_name,''),coalesce(incoming.last_name,''),incoming.email,incoming.phone,incoming.source,coalesce(incoming.status,'new'),incoming.notes,incoming.move_in_date,incoming.bedrooms) returning * into l;
 end if;
 -- Existing CRM retry worker owns delivery; no public request sends externally.
 update public.leads set crm_sync_status=case when crm_sync_status='processing' then crm_sync_status else 'pending' end,
   crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=l.id;
 if existing and p_activity is not null and not exists(select 1 from public.lead_activities where lead_id=l.id and description=p_activity->>'description' and created_at>now()-interval '5 minutes') then
   insert into public.lead_activities(lead_id,type,description,metadata) values(l.id,coalesce(p_activity->>'type','note'),p_activity->>'description',coalesce(p_activity->'metadata','{}'));
 end if;
 -- Only explicitly enabled follow-ups are enrolled. No default workflow is enabled here.
 if not existing then
   for w in select * from public.workflow_definitions where property_id=p_property_id and trigger_on='lead_created' and is_active loop
     if jsonb_typeof(w.steps)='array' and jsonb_array_length(w.steps)>0 then
       first_delay:=greatest(0,coalesce((w.steps->0->>'delay_hours')::numeric,0));
       insert into public.lead_workflows(lead_id,workflow_id,current_step,status,next_action_at)
         values(l.id,w.id,0,'active',now()+make_interval(secs=>(first_delay*3600)::integer));
     end if;
   end loop;
 end if;
 return jsonb_build_object('lead',to_jsonb(l),'leadId',l.id,'isExisting',existing,'matchedBy',matched);
end; $$;

create or replace function public.save_luma_message(p_property_id uuid,p_conversation_id uuid,p_role text,p_content text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare human boolean; mid uuid;
begin
 select is_human_mode into human from public.conversations where id=p_conversation_id and property_id=p_property_id for update;
 if not found then raise exception 'Conversation not found'; end if;
 if p_role not in ('user','assistant') then raise exception 'Invalid message role'; end if;
 if p_role='assistant' and human then return jsonb_build_object('human',true,'saved',false); end if;
 insert into public.messages(conversation_id,role,content) values(p_conversation_id,p_role,p_content) returning id into mid;
 return jsonb_build_object('saved',true,'human',coalesce(human,false),'id',mid);
end; $$;

create table if not exists public.luma_delivery_jobs (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 booking_id uuid not null references public.tour_bookings(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','running','completed','review')),
 payload jsonb not null,
 lease_token uuid, lease_until timestamptz,
 calendar_confirmed boolean not null default false,
 email_confirmed boolean not null default false,
 error_code text, created_at timestamptz not null default now(),
 unique(booking_id)
);
create index if not exists luma_delivery_jobs_property on public.luma_delivery_jobs(property_id);
alter table public.luma_delivery_jobs enable row level security;
revoke all on public.luma_delivery_jobs from public,anon,authenticated;
grant all on public.luma_delivery_jobs to service_role;

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
 if b.slot_id is not null then update public.tour_slots set current_bookings=coalesce(current_bookings,0)+1 where id=b.slot_id; end if;
 insert into public.lead_activities(lead_id,type,description,metadata) values(p_lead_id,'tour_booked',format('Tour reserved for %s at %s',b.scheduled_date,b.scheduled_time),jsonb_build_object('booking_id',b.id));
 update public.leads set status='tour_booked',crm_sync_status=case when crm_sync_status='processing' then 'processing' else 'pending' end,crm_sync_next_retry_at=case when crm_sync_status='processing' then crm_sync_next_retry_at else now() end where id=p_lead_id;
 insert into public.luma_delivery_jobs(property_id,booking_id,payload) values(p_property_id,b.id,p_delivery);
 return jsonb_build_object('booking',to_jsonb(b),'duplicate',false);
end; $$;
revoke all on function public.reserve_luma_allowance(uuid,text,bigint,bigint,timestamptz),public.claim_luma_request(uuid,uuid,text,text,text),public.finish_luma_request(uuid,uuid,uuid,jsonb,integer),public.upsert_luma_lead(uuid,text,text,uuid,jsonb,jsonb,jsonb),public.save_luma_message(uuid,uuid,text,text),public.reserve_luma_tour(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_luma_allowance(uuid,text,bigint,bigint,timestamptz),public.claim_luma_request(uuid,uuid,text,text,text),public.finish_luma_request(uuid,uuid,uuid,jsonb,integer),public.upsert_luma_lead(uuid,text,text,uuid,jsonb,jsonb,jsonb),public.save_luma_message(uuid,uuid,text,text),public.reserve_luma_tour(uuid,uuid,jsonb,jsonb) to service_role;

alter table public.luma_delivery_jobs add column if not exists attempts integer not null default 0;
alter table public.luma_delivery_jobs add column if not exists available_at timestamptz not null default now();
alter table public.luma_delivery_jobs add column if not exists first_attempt_at timestamptz;
alter table public.luma_delivery_jobs add column if not exists email_receipt text;
create index if not exists luma_delivery_jobs_due on public.luma_delivery_jobs(state,available_at);
create or replace function public.claim_luma_delivery() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.luma_delivery_jobs;
begin
 update public.luma_delivery_jobs set state='review',error_code='retry_window_expired'
 where state in ('queued','running') and (lease_until is null or lease_until<=now())
   and (attempts>=3 or first_attempt_at<now()-interval '23 hours');
 select * into j from public.luma_delivery_jobs where state in ('queued','running') and available_at<=now()
   and (lease_until is null or lease_until<=now()) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.luma_delivery_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=j.id returning * into j;
 return to_jsonb(j);
end; $$;
create or replace function public.save_luma_delivery(p_id uuid,p_token uuid,p_stage text,p_receipt jsonb default '{}') returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.luma_delivery_jobs;
begin
 select * into j from public.luma_delivery_jobs where id=p_id and lease_token=p_token and state='running' and lease_until>now() for update;
 if not found then return false; end if;
 if p_stage='calendar' then
   if nullif(p_receipt->>'eventId','') is null then raise exception 'Calendar receipt missing'; end if;
   if not exists(select 1 from public.calendar_events where tour_booking_id=j.booking_id and provider_event_id=p_receipt->>'eventId') then
     insert into public.calendar_events(agent_calendar_id,tour_booking_id,google_event_id,provider_event_id,provider_event_link,sync_status,last_synced_at)
       values((p_receipt->>'calendarId')::uuid,j.booking_id,p_receipt->>'eventId',p_receipt->>'eventId',p_receipt->>'htmlLink','synced',now());
   end if;
   update public.luma_delivery_jobs set calendar_confirmed=true where id=j.id;
 elsif p_stage='email' then
   if nullif(p_receipt->>'messageId','') is null then raise exception 'Email receipt missing'; end if;
   update public.luma_delivery_jobs set email_confirmed=true,email_receipt=p_receipt->>'messageId',state='completed',lease_until=null,lease_token=null where id=j.id;
 elsif p_stage in ('retry','review') then
   update public.luma_delivery_jobs set state=case when p_stage='review' or attempts>=3 then 'review' else 'queued' end,
     error_code=left(p_receipt->>'error',200),available_at=now()+interval '10 minutes',lease_until=null,lease_token=null where id=j.id;
 else raise exception 'Invalid delivery stage'; end if;
 return true;
end; $$;
revoke all on function public.claim_luma_delivery(),public.save_luma_delivery(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_luma_delivery(),public.save_luma_delivery(uuid,uuid,text,jsonb) to service_role;

-- A source refresh commits all new chunks, its source metadata and removal of
-- superseded chunks together. Concurrent refreshes cannot delete one another.
create or replace function public.replace_website_knowledge(p_property_id uuid,p_scope text,p_run_id text,p_documents jsonb,p_extracted jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare d public.documents; doc jsonb; sid uuid; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||p_scope,14));
 n:=jsonb_array_length(p_documents);
 if n<1 or n>500 then raise exception 'Invalid website document count'; end if;
 for doc in select value from jsonb_array_elements(p_documents) loop
   d:=jsonb_populate_record(null::public.documents,doc);
   if d.property_id is distinct from p_property_id or d.metadata->>'source_scope' is distinct from p_scope or d.metadata->>'crawl_run_id' is distinct from p_run_id then raise exception 'Document scope mismatch'; end if;
   insert into public.documents(property_id,content,metadata,embedding) values(p_property_id,d.content,d.metadata,d.embedding);
 end loop;
 select id into sid from public.knowledge_sources where property_id=p_property_id and source_type='website' and source_url=p_scope order by created_at limit 1 for update;
 if sid is null then
   insert into public.knowledge_sources(property_id,source_type,source_name,source_url,status,documents_created,extracted_data,last_synced_at)
     values(p_property_id,'website','Website: '||p_scope,p_scope,'completed',n,p_extracted,now()) returning id into sid;
 else
   update public.knowledge_sources set status='completed',documents_created=n,extracted_data=p_extracted,last_synced_at=now(),error_message=null where id=sid;
 end if;
 delete from public.documents where property_id=p_property_id and metadata->>'source_type'='website_scrape' and metadata->>'source_scope'=p_scope and metadata->>'crawl_run_id' is distinct from p_run_id;
 update public.property_chatbot_contexts set status='stale',stale_at=now(),last_change_summary='Website knowledge changed; regeneration pending' where property_id=p_property_id;
 return sid;
end; $$;
create table if not exists public.phase_four_maintenance (
 kind text not null check(kind in ('knowledge','competitors')),
 item_id uuid not null,
 property_id uuid not null references public.properties(id) on delete cascade,
 lease_token uuid,lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 last_attempt_at timestamptz,last_success_at timestamptz,
 failures integer not null default 0,error_code text,
 primary key(kind,item_id)
);
create index if not exists phase_four_maintenance_property on public.phase_four_maintenance(property_id);
alter table public.phase_four_maintenance enable row level security;
revoke all on public.phase_four_maintenance from public,anon,authenticated;
grant all on public.phase_four_maintenance to service_role;
create or replace function public.claim_phase_four_maintenance(p_kind text,p_limit integer default 5) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record; token uuid; results jsonb:='[]';
begin
 perform pg_advisory_xact_lock(hashtextextended(p_kind,15));
 for item in
   select c.* from (
     select 'knowledge' as kind,k.id as item_id,k.property_id,to_jsonb(k)||jsonb_build_object('properties',jsonb_build_object('name',p.name)) as payload
     from public.knowledge_sources k join public.properties p on p.id=k.property_id
     where k.source_type='website' and (k.last_synced_at is null or k.last_synced_at<now()-interval '7 days' or exists(select 1 from public.property_chatbot_contexts pc where pc.property_id=k.property_id and (pc.status in ('stale','failed') or (pc.status='generating' and pc.stale_at<now()-interval '15 minutes'))))
     union all
     select 'competitors',c.property_id,c.property_id,to_jsonb(c) from public.scrape_config c where c.is_enabled and
       (c.last_run_at is null or c.last_run_at<now()-case c.scrape_frequency when 'hourly' then interval '1 hour' when 'weekly' then interval '7 days' else interval '1 day' end)
   ) c left join public.phase_four_maintenance m on m.kind=c.kind and m.item_id=c.item_id
   where c.kind=p_kind and coalesce(m.next_attempt_at,now())<=now() and (m.lease_until is null or m.lease_until<=now())
   order by m.last_attempt_at nulls first,c.item_id limit greatest(1,least(p_limit,5))
 loop
   token:=gen_random_uuid();
   insert into public.phase_four_maintenance(kind,item_id,property_id,lease_token,lease_until,last_attempt_at)
     values(p_kind,item.item_id,item.property_id,token,now()+interval '15 minutes',now())
     on conflict(kind,item_id) do update set lease_token=token,lease_until=now()+interval '15 minutes',last_attempt_at=now();
   results:=results||jsonb_build_array(item.payload||jsonb_build_object('maintenanceToken',token,'maintenanceId',item.item_id));
 end loop;
 return results;
end; $$;
create or replace function public.finish_phase_four_maintenance(p_kind text,p_item_id uuid,p_token uuid,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.phase_four_maintenance set lease_token=null,lease_until=null,
   failures=case when p_success then 0 else failures+1 end,
   error_code=case when p_success then null else 'refresh_not_confirmed' end,
   last_success_at=case when p_success then now() else last_success_at end,
   next_attempt_at=now()+case when p_success then interval '1 hour' else least(interval '1 day',interval '15 minutes'*power(2,least(failures,6))) end
 where kind=p_kind and item_id=p_item_id and lease_token=p_token and lease_until>now();
 return found;
end; $$;
revoke all on function public.replace_website_knowledge(uuid,text,text,jsonb,jsonb),public.claim_phase_four_maintenance(text,integer),public.finish_phase_four_maintenance(text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.replace_website_knowledge(uuid,text,text,jsonb,jsonb),public.claim_phase_four_maintenance(text,integer),public.finish_phase_four_maintenance(text,uuid,uuid,boolean) to service_role;

create or replace function public.phase_four_status(p_property_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'requests',coalesce((select jsonb_agg(to_jsonb(r)) from (select request_id,operation,
   case when state='running' and expires_at<=now() then 'review' else state end as state,created_at
   from public.luma_requests where property_id=p_property_id and state in ('running','review') order by created_at desc limit 20) r),'[]'),
 'confirmations',coalesce((select jsonb_agg(to_jsonb(d)) from (select booking_id,state,calendar_confirmed,email_confirmed,error_code,created_at
   from public.luma_delivery_jobs where property_id=p_property_id order by created_at desc limit 20) d),'[]'),
 'audits',coalesce((select jsonb_agg(to_jsonb(g)) from (select j.run_id,j.surface,j.state,j.claim_count,j.created_at,r.run_metadata as coverage
   from public.geo_execution_jobs j join public.geo_runs r on j.run_id=r.id where j.property_id=p_property_id order by j.created_at desc limit 20) g),'[]'),
 'analysis',coalesce((select jsonb_agg(to_jsonb(a)) from (select batch_id,state,attempts,error_code from public.geo_analysis_jobs where property_id=p_property_id order by created_at desc limit 20) a),'[]'),
 'maintenance',coalesce((select jsonb_agg(to_jsonb(m)) from (select kind,last_attempt_at,last_success_at,next_attempt_at,failures,error_code
   from public.phase_four_maintenance where property_id=p_property_id order by last_attempt_at desc limit 20) m),'[]'),
 'reservedTokens',coalesce((select used from public.luma_allowances where property_id=p_property_id and bucket='ai:'||to_char(now() at time zone 'UTC','YYYY-MM-DD')),0)
 );
$$;
revoke all on function public.phase_four_status(uuid) from public,anon,authenticated;
grant execute on function public.phase_four_status(uuid) to service_role;

notify pgrst, 'reload schema';

create or replace function public.claim_geo_analysis() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.geo_analysis_jobs; crawl uuid;
begin
 perform pg_advisory_xact_lock(401905);
 update public.geo_analysis_jobs a set state='failed',error_code='website_crawl_unavailable'
   where state='queued' and not exists(select 1 from public.geo_runs r where r.batch_id=a.batch_id and r.status in ('queued','running'))
   and (exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id and c.status::text='failed')
        or (a.created_at<now()-interval '1 hour' and not exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id)))
   and not exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id and c.status::text in ('queued','running','completed'));

 update public.geo_analysis_jobs set state='failed',error_code='analysis_retries_exhausted',lease_token=null,lease_until=null
   where state in ('queued','running') and attempts>=3 and (lease_until is null or lease_until<=now());
 if exists(select 1 from public.geo_analysis_jobs where state='running' and lease_until>now()) then return null; end if;
 select * into j from public.geo_analysis_jobs a where state in ('queued','running') and available_at<=now() and (lease_until is null or lease_until<=now())
   and not exists(select 1 from public.geo_runs r where r.batch_id=a.batch_id and r.status in ('queued','running'))
   and exists(select 1 from public.geo_site_crawls c where c.batch_id=a.batch_id and c.property_id=a.property_id and c.status='completed')
   order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 select id into crawl from public.geo_site_crawls where batch_id=j.batch_id and property_id=j.property_id and status='completed' order by finished_at desc limit 1;
 update public.geo_analysis_jobs set state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' where batch_id=j.batch_id returning * into j;
 return to_jsonb(j)||jsonb_build_object('crawl_id',crawl);
end; $$;
create or replace function public.finish_geo_analysis(p_batch_id uuid,p_token uuid,p_success boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.geo_analysis_jobs set state=case when p_success then 'completed' when attempts>=3 then 'failed' else 'queued' end,
   lease_token=null,lease_until=null,available_at=now()+interval '10 minutes',error_code=case when p_success then null else 'analysis_not_confirmed' end
 where batch_id=p_batch_id and lease_token=p_token and state='running' and lease_until>now();
 return found;
end; $$;
create or replace function public.replace_geo_recommendations(p_property_id uuid,p_crawl_id uuid,p_generation_id uuid,p_rows jsonb,p_token uuid default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare r public.geo_recommendations; item jsonb; n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,17));
 if not exists(select 1 from public.geo_site_crawls where id=p_crawl_id and property_id=p_property_id) then raise exception 'Crawl scope mismatch'; end if;
 n:=jsonb_array_length(p_rows);
 if n<1 or n>100 then raise exception 'Invalid recommendation count'; end if;
 for item in select value from jsonb_array_elements(p_rows) loop
   r:=jsonb_populate_record(null::public.geo_recommendations,item);
   if r.property_id is distinct from p_property_id or r.crawl_id is distinct from p_crawl_id or r.generation_id is distinct from p_generation_id then raise exception 'Recommendation scope mismatch'; end if;
   if p_token is not null and not exists(select 1 from public.geo_analysis_jobs where batch_id=r.batch_id and lease_token=p_token and state='running' and lease_until>now()) then raise exception 'Analysis lease lost'; end if;
   insert into public.geo_recommendations(property_id,batch_id,crawl_id,generation_id,is_current,type,priority,owner,title,narrative,proposed_changes,grounding,status,model_used)
     values(r.property_id,r.batch_id,r.crawl_id,r.generation_id,true,r.type,r.priority,r.owner,r.title,r.narrative,r.proposed_changes,r.grounding,r.status,r.model_used);
 end loop;
 update public.geo_recommendations set is_current=false,updated_at=now() where property_id=p_property_id and is_current and generation_id<>p_generation_id;
 return n;
end; $$;
revoke all on function public.claim_geo_analysis(),public.finish_geo_analysis(uuid,uuid,boolean),public.replace_geo_recommendations(uuid,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_geo_analysis(),public.finish_geo_analysis(uuid,uuid,boolean),public.replace_geo_recommendations(uuid,uuid,uuid,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
