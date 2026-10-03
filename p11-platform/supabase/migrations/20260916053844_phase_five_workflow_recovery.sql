-- Durable follow-up delivery. Local qualification only; no provider calls or backlog replay.
create table public.workflow_deliveries (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade,
 lead_workflow_id uuid not null references public.lead_workflows on delete cascade, step_number integer not null,
 state text not null check(state in ('queued','running','accepted','review','skipped')),
 snapshot jsonb not null, channel text, recipient text, template_id uuid, body text, subject text, sender text,
 attempts integer not null default 0 check(attempts between 0 and 3), legacy boolean not null default false,
 lease_token uuid, lease_until timestamptz, started_at timestamptz, first_attempt_at timestamptz,
 provider_id text, accepted_at timestamptz, advanced_at timestamptz, error_code text,
 due_at timestamptz, deadline timestamptz not null, created_at timestamptz not null default now(),
 unique(lead_workflow_id,step_number)
);
create index workflow_deliveries_lead_idx on public.workflow_deliveries(lead_id);
create index workflow_deliveries_property_idx on public.workflow_deliveries(property_id);
create table public.workflow_delivery_reviews (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties on delete cascade,
 lead_id uuid not null references public.leads on delete cascade, delivery_id uuid not null references public.workflow_deliveries on delete cascade,
 actor_id uuid not null, request_id uuid not null, input jsonb not null, result jsonb not null,
 transaction_id bigint not null default txid_current(), created_at timestamptz not null default now(), unique(property_id,request_id)
);
create index workflow_delivery_reviews_lead_idx on public.workflow_delivery_reviews(lead_id);
create index workflow_delivery_reviews_delivery_idx on public.workflow_delivery_reviews(delivery_id);
alter table public.workflow_deliveries enable row level security;
alter table public.workflow_delivery_reviews enable row level security;
revoke all on public.workflow_deliveries,public.workflow_delivery_reviews from public,anon,authenticated;
grant all on public.workflow_deliveries,public.workflow_delivery_reviews to service_role;
create trigger protect_workflow_review_history before update or delete on public.workflow_delivery_reviews for each row execute function public.protect_tour_correction_history();

create function public.valid_followup_steps(p_steps jsonb) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare s jsonb;
begin
 if jsonb_typeof(p_steps) is distinct from 'array' or jsonb_array_length(p_steps)=0 then return false;end if;
 for s in select value from jsonb_array_elements(p_steps) loop
  if coalesce(s->>'action','') not in ('sms','email','wait') or jsonb_typeof(s->'delay_hours') is distinct from 'number' then return false;end if;
  if (s->>'delay_hours')::numeric not between 0 and 8760 then return false;end if;
  if s->>'action'<>'wait' and nullif(trim(s->>'template_slug'),'') is null then return false;end if;
 end loop;return true;
end; $$;

-- Called inside property lock + workflow row lock. Provider receipt and workflow advancement share a transaction.
create function public.settle_workflow_delivery(p_id uuid) returns text language plpgsql security invoker set search_path='' as $$
declare d public.workflow_deliveries;w public.lead_workflows;definition public.workflow_definitions;l public.leads;n integer;
begin
 select * into d from public.workflow_deliveries where id=p_id;if not found then return 'missing';end if;
 perform pg_advisory_xact_lock(hashtextextended(d.property_id::text,12));
 select * into l from public.leads where id=d.lead_id and property_id=d.property_id for update;
 select * into w from public.lead_workflows where id=d.lead_workflow_id for update;
 select * into d from public.workflow_deliveries where id=p_id for update;
 if d.state not in ('accepted','skipped') then return d.state;end if;
 if d.state='accepted' then
  if nullif(trim(d.provider_id),'') is null then raise exception 'Acceptance requires a receipt';end if;
  insert into public.workflow_actions(id,lead_workflow_id,step_number,action_type,template_id,status,external_id)
   values(d.id,w.id,d.step_number,d.channel,d.template_id,'sent',d.provider_id) on conflict(id) do nothing;
  -- Only the first saved receipt affects contact metadata; never downgrade a newer lead status.
  if d.advanced_at is null then update public.leads set last_contacted_at=greatest(last_contacted_at,d.accepted_at),status=case when status='new' then 'contacted' else status end where id=l.id;end if;
 else
  insert into public.workflow_actions(id,lead_workflow_id,step_number,action_type,status,error_message)
   values(d.id,w.id,d.step_number,coalesce(d.channel,'wait'),'skipped',d.error_code) on conflict(id) do nothing;
 end if;
 update public.lead_workflows set processing_started_at=null,processing_expires_at=null where id=w.id;
 if d.advanced_at is not null or w.current_step<>d.step_number or w.status<>'active' then return d.state;end if;
 select * into definition from public.workflow_definitions where id=w.workflow_id and property_id=d.property_id;
 if not found or not coalesce(definition.is_active,false) or definition.steps is distinct from d.snapshot->'steps' or definition.exit_conditions is distinct from d.snapshot->'exitConditions' then
  update public.workflow_deliveries set error_code='definition_changed' where id=d.id;return d.state;
 end if;
 if coalesce(definition.exit_conditions,'[]') ? l.status then
  update public.lead_workflows set status=case when l.status='leased' then 'converted' else 'stopped' end,next_action_at=null,updated_at=now() where id=w.id;
 else
  n:=w.current_step+1;
  update public.lead_workflows set current_step=n,status=case when n>=jsonb_array_length(definition.steps) then 'completed' else 'active' end,
   last_action_at=now(),next_action_at=case when n<jsonb_array_length(definition.steps) then now()+make_interval(secs=>((definition.steps->n->>'delay_hours')::numeric*3600)::double precision) end,updated_at=now() where id=w.id;
 end if;
 update public.workflow_deliveries set advanced_at=now() where id=d.id;
 return d.state;
end; $$;

create function public.prepare_workflow_delivery(p_workflow_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.lead_workflows;definition public.workflow_definitions;l public.leads;p public.properties;d public.workflow_deliveries;t public.follow_up_templates;s jsonb;reason text;receipt text;actions integer;token uuid:=gen_random_uuid();
begin
 select * into w from public.lead_workflows where id=p_workflow_id;if not found then return null;end if;
 select * into l from public.leads where id=w.lead_id;if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(l.property_id::text,12));
 select * into l from public.leads where id=w.lead_id for update;
 select * into w from public.lead_workflows where id=p_workflow_id for update;
 if w.status<>'active' or w.next_action_at is null or w.next_action_at>now() then return null;end if;
 select * into definition from public.workflow_definitions where id=w.workflow_id and property_id=l.property_id;
 if not found then return jsonb_build_object('state','review','error_code','property_mismatch');end if;
 select * into d from public.workflow_deliveries where lead_workflow_id=w.id and step_number=w.current_step for update;
 if found then
  if d.state in ('accepted','skipped') then perform public.settle_workflow_delivery(d.id);return to_jsonb(d)||'{"settled":true}';end if;
  if d.state='running' then
   if d.lease_until>now() then return null;end if;
   if d.started_at is not null then
    update public.workflow_deliveries set state='review',error_code='delivery_unconfirmed' where id=d.id returning * into d;return to_jsonb(d);
   end if;
   update public.workflow_deliveries set state='queued',lease_token=null,lease_until=null where id=d.id;
   update public.lead_workflows set processing_started_at=null,processing_expires_at=null where id=w.id;
   d.state:='queued';
  end if;
  if d.state='review' then return to_jsonb(d);end if;
 end if;
 -- Do not erase an old lease before classifying the delivery evidence below.
 if d.id is null then
  s:=definition.steps->w.current_step;
  select * into t from public.follow_up_templates where property_id=l.property_id and slug=s->>'template_slug';
  select * into p from public.properties where id=l.property_id;
  insert into public.workflow_deliveries(property_id,lead_id,lead_workflow_id,step_number,state,snapshot,channel,recipient,template_id,due_at,deadline)
  values(l.property_id,l.id,w.id,w.current_step,'queued',jsonb_build_object('steps',definition.steps,'exitConditions',definition.exit_conditions,'step',s,'template',to_jsonb(t),
   'firstName',l.first_name,'lastName',l.last_name,'propertyName',p.name,'tourLink',p.settings->>'tour_booking_url'),s->>'action',case s->>'action' when 'sms' then l.phone else l.email end,t.id,w.next_action_at,w.next_action_at+interval '23 hours') returning * into d;
  select count(*),min(external_id) filter(where status='sent' and nullif(trim(external_id),'') is not null) into actions,receipt from public.workflow_actions where lead_workflow_id=w.id and step_number=w.current_step;
  if w.processing_started_at is not null or w.processing_expires_at is not null or actions>0 then
   update public.workflow_deliveries set legacy=true,state='review',error_code='legacy_delivery_review',started_at=coalesce(w.processing_started_at,now()),lease_until=w.processing_expires_at where id=d.id returning * into d;
   update public.lead_workflows set processing_started_at=coalesce(processing_started_at,now()),processing_expires_at=coalesce(processing_expires_at,now()-interval '1 second') where id=w.id;
   -- Historical receipts are reconciled by an operator; never infer acceptance from a status alone.
   return to_jsonb(d);
  end if;
 end if;
 if coalesce(definition.exit_conditions,'[]') ? l.status then
  update public.lead_workflows set status=case when l.status='leased' then 'converted' else 'stopped' end,next_action_at=null,processing_started_at=null,processing_expires_at=null,updated_at=now() where id=w.id;
  update public.workflow_deliveries set state='skipped',error_code='lead_exit_condition' where id=d.id returning * into d;return to_jsonb(d);
 end if;
 if not coalesce(definition.is_active,false) then reason:='definition_inactive';
 elsif not public.valid_followup_steps(definition.steps) or w.current_step<0 or w.current_step>=jsonb_array_length(definition.steps) then reason:='invalid_steps';
 elsif d.deadline<=now() then reason:='backlog_expired';
 elsif definition.steps is distinct from d.snapshot->'steps' or definition.exit_conditions is distinct from d.snapshot->'exitConditions' then reason:='definition_changed';
 elsif d.channel<>'wait' then
  select * into t from public.follow_up_templates where id=d.template_id and property_id=d.property_id;
  if not found or not coalesce(t.is_active,false) or t.channel is distinct from d.channel then reason:='template_unavailable';
  elsif to_jsonb(t) is distinct from d.snapshot->'template' then reason:='template_changed';
  elsif nullif(trim(d.recipient),'') is null then reason:='recipient_missing';
  elsif d.recipient is distinct from (case d.channel when 'sms' then l.phone else l.email end) then reason:='recipient_changed';end if;
 end if;
 if reason is not null then
  update public.workflow_deliveries set state='review',error_code=reason,lease_token=null,lease_until=null where id=d.id returning * into d;
  update public.lead_workflows set processing_started_at=null,processing_expires_at=null where id=w.id;return to_jsonb(d);
 end if;
 if d.channel='wait' then
  update public.workflow_deliveries set state='skipped',error_code='wait_completed' where id=d.id;
  perform public.settle_workflow_delivery(d.id);return jsonb_build_object('state','skipped','settled',true);
 end if;
 update public.workflow_deliveries set state='running',lease_token=token,lease_until=now()+interval '5 minutes',started_at=null,error_code=null where id=d.id returning * into d;
 update public.lead_workflows set processing_started_at=now(),processing_expires_at=d.lease_until where id=w.id;
 return to_jsonb(d);
end; $$;

create function public.start_workflow_delivery(p_id uuid,p_token uuid,p_body text,p_subject text,p_sender text,p_issue text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.workflow_deliveries;w public.lead_workflows;l public.leads;definition public.workflow_definitions;t public.follow_up_templates;reason text:=p_issue;
begin
 select * into d from public.workflow_deliveries where id=p_id;if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(d.property_id::text,12));
 select * into l from public.leads where id=d.lead_id and property_id=d.property_id for update;
 select * into w from public.lead_workflows where id=d.lead_workflow_id for update;
 select * into d from public.workflow_deliveries where id=p_id for update;
 if d.state<>'running' or d.lease_token is distinct from p_token or d.lease_until<=now() or d.started_at is not null then return null;end if;
 select * into definition from public.workflow_definitions where id=w.workflow_id and property_id=d.property_id;
 select * into t from public.follow_up_templates where id=d.template_id and property_id=d.property_id;
 if w.status<>'active' or w.current_step<>d.step_number then reason:='workflow_changed';
 elsif coalesce(definition.exit_conditions,'[]') ? l.status then reason:='lead_exit_condition';
 elsif not coalesce(definition.is_active,false) or definition.steps is distinct from d.snapshot->'steps' or definition.exit_conditions is distinct from d.snapshot->'exitConditions' then reason:='definition_changed';
 elsif to_jsonb(t) is distinct from d.snapshot->'template' or not coalesce(t.is_active,false) then reason:='template_changed';
 elsif d.recipient is distinct from (case d.channel when 'sms' then l.phone else l.email end) then reason:='recipient_changed';
 elsif d.deadline<=now() or d.attempts>=3 or d.legacy then reason:='retry_limit';
 elsif nullif(trim(p_body),'') is null or nullif(trim(p_sender),'') is null or (d.channel='email' and nullif(trim(p_subject),'') is null) then reason:='configuration_missing';
 elsif d.body is not null and (d.body,d.subject,d.sender) is distinct from (p_body,p_subject,p_sender) then reason:='message_changed';end if;
 if reason is not null then
  update public.workflow_deliveries set state='review',error_code=reason,lease_token=null,lease_until=null where id=p_id;
  update public.lead_workflows set processing_started_at=null,processing_expires_at=null where id=w.id;return null;
 end if;
 update public.workflow_deliveries set started_at=now(),first_attempt_at=coalesce(first_attempt_at,now()),attempts=attempts+1,body=p_body,subject=p_subject,sender=p_sender where id=p_id returning * into d;
 return to_jsonb(d);
end; $$;

create function public.finish_workflow_delivery(p_id uuid,p_token uuid,p_provider_id text) returns boolean language plpgsql security invoker set search_path='' as $$
declare d public.workflow_deliveries;
begin
 select * into d from public.workflow_deliveries where id=p_id;if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(d.property_id::text,12));
 perform 1 from public.leads where id=d.lead_id for update;
 perform 1 from public.lead_workflows where id=d.lead_workflow_id for update;
 select * into d from public.workflow_deliveries where id=p_id for update;
 if d.lease_token is distinct from p_token then return false;end if;
 if d.state='accepted' then return coalesce(d.provider_id=p_provider_id,false);end if;
 if d.state not in ('running','review') or d.started_at is null then return false;end if;
 if nullif(trim(p_provider_id),'') is null then
  update public.workflow_deliveries set state='review',error_code='delivery_unconfirmed' where id=p_id;return true;
 end if;
 update public.workflow_deliveries set state='accepted',provider_id=trim(p_provider_id),accepted_at=now(),error_code=null where id=p_id;
 perform public.settle_workflow_delivery(p_id);return true;
end; $$;

create function public.pending_workflow_deliveries(p_limit integer default 100) returns jsonb language sql stable security invoker set search_path='' as $$
 with due as (select w.id from public.lead_workflows w left join public.workflow_deliveries d on d.lead_workflow_id=w.id and d.step_number=w.current_step
  where w.status='active' and w.next_action_at<=now() and (d.id is null or d.state='queued' or (d.state='running' and d.lease_until<=now()) or (d.state in ('accepted','skipped') and d.advanced_at is null and d.error_code is null))
  order by w.next_action_at,w.id limit greatest(1,least(p_limit,200)))
 select jsonb_build_object('candidates',coalesce((select jsonb_agg(id) from due),'[]'),
 'review',(select count(*) from public.workflow_deliveries where state='review' or (state='running' and lease_until<=now() and started_at is not null)));
$$;

create function public.review_workflow_delivery(p_property_id uuid,p_lead_id uuid,p_delivery_id uuid,p_actor_id uuid,p_request_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.workflow_deliveries;w public.lead_workflows;r public.workflow_delivery_reviews;resolution text:=p_input->>'resolution';result jsonb;next_state text;
begin
 if p_request_id is null or p_actor_id is null or coalesce(resolution,'') not in ('accepted','not_sent','skip') or nullif(trim(p_input->>'reason'),'') is null or length(p_input->>'reason')>2000
 or (resolution='accepted' and (nullif(trim(p_input->>'providerId'),'') is null or length(p_input->>'providerId')>300)) then raise exception 'Invalid workflow review';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into r from public.workflow_delivery_reviews where property_id=p_property_id and request_id=p_request_id;
 if found then
  if r.delivery_id<>p_delivery_id or r.lead_id<>p_lead_id or r.actor_id<>p_actor_id or r.input<>p_input then return '{"state":"request_conflict"}';end if;
  return r.result||'{"state":"replayed"}';
 end if;
 select * into d from public.workflow_deliveries where id=p_delivery_id and property_id=p_property_id and lead_id=p_lead_id;
 if not found then return '{"state":"not_found"}';end if;
 perform 1 from public.leads where id=p_lead_id for update;
 select * into w from public.lead_workflows where id=d.lead_workflow_id for update;
 select * into d from public.workflow_deliveries where id=p_delivery_id for update;
 if d.lease_until>now() and (d.state='running' or d.legacy) then return '{"state":"busy"}';end if;
 if d.state not in ('review','running') then return '{"state":"conflict"}';end if;
 if resolution='accepted' and d.started_at is null then return '{"state":"not_attempted"}';end if;
 if resolution='skip' and d.started_at is not null then return '{"state":"evidence_required"}';end if;
 next_state:=case when resolution='accepted' then 'accepted' when resolution='not_sent' and not d.legacy and d.deadline>now() and d.attempts<3 and w.status in ('active','paused') and w.current_step=d.step_number then 'queued' else 'skipped' end;
 update public.workflow_deliveries set state=next_state,lease_token=null,lease_until=null,started_at=case when next_state='accepted' then started_at else null end,
 provider_id=case when next_state='accepted' then trim(p_input->>'providerId') else provider_id end,accepted_at=case when next_state='accepted' then now() else accepted_at end,
 error_code=case when next_state='skipped' then 'reviewed_stop' else null end where id=d.id;
 update public.lead_workflows set processing_started_at=null,processing_expires_at=null where id=w.id;
 if next_state='accepted' then perform public.settle_workflow_delivery(d.id);
 elsif next_state='skipped' then
  update public.lead_workflows set status='stopped',next_action_at=null,updated_at=now() where id=w.id and status in ('active','paused');
  perform public.settle_workflow_delivery(d.id);
 end if;
 result:=jsonb_build_object('state','applied','deliveryState',next_state);
 insert into public.workflow_delivery_reviews(property_id,lead_id,delivery_id,actor_id,request_id,input,result)values(p_property_id,p_lead_id,p_delivery_id,p_actor_id,p_request_id,p_input,result);
 return result;
end; $$;

create function public.control_lead_workflow(p_property_id uuid,p_lead_id uuid,p_workflow_id uuid,p_actor_id uuid,p_action text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare w public.lead_workflows;target text;
begin
 if coalesce(p_action,'') not in ('pause','resume','stop') then raise exception 'Invalid workflow action';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=p_actor_id and p.id=p_property_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 perform 1 from public.leads where id=p_lead_id and property_id=p_property_id for update;if not found then return '{"state":"not_found"}';end if;
 select * into w from public.lead_workflows where id=p_workflow_id and lead_id=p_lead_id for update;if not found then return '{"state":"not_found"}';end if;
 target:=case p_action when 'pause' then 'paused' when 'resume' then 'active' else 'stopped' end;
 if w.status=target then return jsonb_build_object('state','applied','workflow',to_jsonb(w));end if;
 if w.status not in ('active','paused') then return '{"state":"conflict"}';end if;
 -- Existing older pauses erased due time; do not invent a new send schedule for them.
 if p_action='resume' and w.next_action_at is null then return '{"state":"timing_review"}';end if;
 update public.lead_workflows set status=target,updated_at=now() where id=w.id returning * into w;
 return jsonb_build_object('state','applied','workflow',to_jsonb(w));
end; $$;

DO $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('valid_followup_steps','settle_workflow_delivery','prepare_workflow_delivery','start_workflow_delivery','finish_workflow_delivery','pending_workflow_deliveries','review_workflow_delivery','control_lead_workflow') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end$$;
NOTIFY pgrst,'reload schema';
