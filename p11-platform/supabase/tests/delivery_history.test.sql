BEGIN;
create temp table assertion_count(n int);insert into assertion_count values(0);
create function pg_temp.check_it(v boolean,label text)returns void language plpgsql as $$begin if v is distinct from true then raise exception 'Assertion failed: %',label;end if;update assertion_count set n=n+1;end$$;
create function pg_temp.throws(statement text,label text)returns void language plpgsql as $$declare failed boolean:=false;begin begin execute statement;exception when others then failed:=true;end;perform pg_temp.check_it(failed,label);end$$;
create function pg_temp.i(n int)returns uuid language sql immutable as $$select('ee900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create temp table st(k text primary key,v jsonb);grant all on st,assertion_count to service_role;
insert into public.organizations(id,name)values(pg_temp.i(1),'Delivery history SQL fixture'),(pg_temp.i(2),'Delivery history other fixture');
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)select pg_temp.i(n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated','delivery-history-'||n||'@fixture.invalid',clock_timestamp(),clock_timestamp(),clock_timestamp()from generate_series(101,103)n;
insert into public.profiles(id,org_id,role)select pg_temp.i(n),pg_temp.i(case when n=103 then 2 else 1 end),case when n=102 then'viewer'else'admin'end from generate_series(101,103)n on conflict(id)do update set org_id=excluded.org_id,role=excluded.role;
insert into public.properties(id,org_id,name)values(pg_temp.i(201),pg_temp.i(1),'Delivery history SQL property'),(pg_temp.i(202),pg_temp.i(2),'Delivery history other property');

insert into public.leads(id,property_id,first_name)values(pg_temp.i(401),pg_temp.i(201),'History lead'),(pg_temp.i(402),pg_temp.i(202),'Other lead');
insert into public.workflow_definitions(id,property_id,name,trigger_on,steps,exit_conditions,is_active)values(pg_temp.i(501),pg_temp.i(201),'History fixture','lead_created','[{"id":0,"delay_hours":0,"action":"wait"}]','[]',false);
insert into public.lead_workflows(id,lead_id,workflow_id,current_step,status)values(pg_temp.i(502),pg_temp.i(401),pg_temp.i(501),0,'stopped');
insert into public.workflow_deliveries(id,property_id,lead_id,lead_workflow_id,step_number,state,snapshot,deadline,created_at,body,lease_token)
select pg_temp.i(10000+n),pg_temp.i(201),pg_temp.i(401),pg_temp.i(502),n,'running','{}',now(),now(),'Private dispatch bytes',gen_random_uuid() from generate_series(1,1005)n;
insert into public.tour_schedule_work(id,property_id,lead_id,tour_source,tour_id,schedule_version,kind,state,payload,created_at,lease_token)
select pg_temp.i(20000+n),pg_temp.i(201),pg_temp.i(401),'tours',pg_temp.i(40000+n),1,case when n<=1005 then 'notice_email' else 'confirmation' end,'running',case when n<=1005 then '{"email":"private@fixture.invalid","action":"reschedule"}'::jsonb else '{"reminderVersion":2}'::jsonb end,now(),gen_random_uuid() from generate_series(1,2010)n;
insert into public.tour_reminder_channels(id,work_id,channel,recipient,state)values(pg_temp.i(30100),pg_temp.i(22010),'email','private@fixture.invalid','running'),(pg_temp.i(30101),pg_temp.i(22010),'sms','+15550000000','accepted');
insert into public.tour_schedule_reviews(property_id,lead_id,work_id,actor_id,request_id,input,result,created_at)select pg_temp.i(201),pg_temp.i(401),pg_temp.i(21005),pg_temp.i(101),gen_random_uuid(),jsonb_build_object('reason','Exact latest review '||n),'{}',now()+n*interval'1 second'from generate_series(1,1005)n;
insert into public.tour_reminder_reviews(property_id,lead_id,channel_id,actor_id,request_id,input,result)values(pg_temp.i(201),pg_temp.i(401),pg_temp.i(30100),pg_temp.i(101),gen_random_uuid(),'{"reason":"Channel-specific original"}','{}');
insert into public.workflow_delivery_reviews(property_id,lead_id,delivery_id,actor_id,request_id,input,result)values(pg_temp.i(201),pg_temp.i(401),pg_temp.i(11005),pg_temp.i(101),gen_random_uuid(),'{"reason":"Workflow original review"}','{}');
create temp table seen(kind text,id text,primary key(kind,id));grant all on seen to service_role;
set local role service_role;
do $$declare k text;r jsonb;c jsonb;n integer;begin
 foreach k in array array['schedule','reminder','workflow'] loop
  c:=null;n:=0;
  loop
   r:=public.read_lead_delivery_history(pg_temp.i(201),pg_temp.i(401),pg_temp.i(101),k,c);
   perform pg_temp.check_it((r->>'total')::integer=1005,k||': count includes all records');
   insert into seen select k,v->>'id'from jsonb_array_elements(r->'work')v;
   n:=n+jsonb_array_length(r->'work');c:=nullif(r->'nextCursor','null'::jsonb);exit when c is null;
  end loop;
  perform pg_temp.check_it(n=1005,k||': every saved record reachable exactly once');
  r:=public.read_lead_delivery_history(pg_temp.i(201),pg_temp.i(401),pg_temp.i(102),k,null);
  perform pg_temp.check_it(r->>'state'='ready',k||': current viewer reads scoped history');
  perform pg_temp.check_it(r->'work'->0->>'state'='review',k||': missing lease is an uncertain result');
  perform pg_temp.check_it(r::text not like '%lease_token%' and r::text not like '%Private dispatch bytes%',k||': dispatch content and tokens excluded');
  perform pg_temp.check_it(public.read_lead_delivery_history(pg_temp.i(201),pg_temp.i(401),pg_temp.i(103),k,null)->>'state'='forbidden',k||': other organization denied');
 end loop;
 r:=public.read_lead_delivery_history(pg_temp.i(201),pg_temp.i(401),pg_temp.i(101),'schedule',null);
 perform pg_temp.check_it(r->'work'->0->>'reviewReason'='Exact latest review 1005','latest exact review beyond prior global cap');
 perform pg_temp.throws(format('select public.read_lead_delivery_history(%L,%L,%L,%L,%L)',pg_temp.i(201),pg_temp.i(401),pg_temp.i(101),'workflow',r->'nextCursor'),'cursor cannot cross kinds');
 r:=public.read_lead_delivery_history(pg_temp.i(201),pg_temp.i(401),pg_temp.i(101),'reminder',null);
 perform pg_temp.check_it(jsonb_array_length(r->'work'->0->'channels')=2,'all individual channel receipts preserved');
 perform pg_temp.check_it(r->'work'->0->'channels'->0->>'reviewReason'='Channel-specific original','exact channel review remains reachable');
 perform pg_temp.check_it(r->'work'->0->'channels'->0->>'state'='review' and r->'work'->0->'channels'->1->>'state'='accepted','unknown and actual accepted channels stay distinct');
 perform pg_temp.check_it(public.read_lead_delivery_history(pg_temp.i(201),pg_temp.i(402),pg_temp.i(101),'schedule',null)->>'state'='not_found','lead must belong to the requested property');
 perform pg_temp.check_it(not has_function_privilege('authenticated','public.read_lead_delivery_history(uuid,uuid,uuid,text,jsonb)','execute'),'authenticated cannot spoof actor');
end$$;
reset role;
select 'Assertions passed: '||n from assertion_count;
ROLLBACK;
