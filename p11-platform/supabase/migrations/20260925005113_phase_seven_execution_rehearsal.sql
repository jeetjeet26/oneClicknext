-- Rehearsal executor: effects are hard-disabled in the active console and hosted databases.
create table public.agency_execution_scopes(
 property_id uuid primary key references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 allowed_targets jsonb not null,expires_at timestamptz not null,max_actions integer not null check(max_actions between 1 and 2),
 used_actions integer not null default 0 check(used_actions>=0),used_reversals integer not null default 0 check(used_reversals>=0),
 check(used_actions<=max_actions and used_reversals<=used_actions),created_at timestamptz not null default clock_timestamp()
);
alter table public.agency_execution_scopes enable row level security;
revoke all on public.agency_execution_scopes from public,anon,authenticated,service_role;
grant select on public.agency_execution_scopes to service_role;
grant update(used_actions,used_reversals)on public.agency_execution_scopes to service_role;
create index agency_execution_scope_org on public.agency_execution_scopes(org_id);
create table public.agency_execution_runs(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),
 plan_revision uuid not null references public.agency_plan_revisions(id),created_by uuid not null references public.profiles(id),authorized_by uuid references public.profiles(id),
 spec jsonb not null,spec_hash text not null,contract_hash text not null,status text not null check(status in('prepared','authorized','running','paused','completed','stopped','reversing','reversed','attention')),
 version integer not null default 1,applied_count integer not null default 0,reversed_count integer not null default 0,interventions integer not null default 0,
 issue text,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 check(applied_count between 0 and 2 and reversed_count between 0 and applied_count)
);
create table public.agency_execution_steps(
 id uuid primary key,run_id uuid not null references public.agency_execution_runs(id)on delete cascade,ordinal integer not null check(ordinal between 0 and 1),
 action text not null check(action in('lead.note.add','market.alert.dismiss')),target_id uuid not null,source_hash text not null,input jsonb not null,
 status text not null default 'pending'check(status in('pending','applied','reversed')),native_id uuid not null unique,undo_id uuid not null unique,
 receipt jsonb,after_hash text,undo_receipt jsonb,applied_at timestamptz,reversed_at timestamptz,unique(run_id,ordinal)
);
create table public.agency_execution_commands(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 run_id uuid references public.agency_execution_runs(id)on delete cascade,input jsonb not null,input_hash text not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity
);
create index agency_execution_run_property on public.agency_execution_runs(property_id,org_id,created_at desc,id);
create index agency_execution_run_plan on public.agency_execution_runs(plan_revision);
create index agency_execution_run_author on public.agency_execution_runs(created_by);
create index agency_execution_run_authorizer on public.agency_execution_runs(authorized_by);
create index agency_execution_run_org on public.agency_execution_runs(org_id);
create index agency_execution_command_run on public.agency_execution_commands(run_id);
create index agency_execution_command_property on public.agency_execution_commands(property_id,org_id,sequence desc);
create index agency_execution_command_org on public.agency_execution_commands(org_id);
create index agency_execution_command_actor on public.agency_execution_commands(actor_id);
alter table public.agency_execution_runs enable row level security;
alter table public.agency_execution_steps enable row level security;
alter table public.agency_execution_commands enable row level security;
revoke all on public.agency_execution_runs,public.agency_execution_steps,public.agency_execution_commands from public,anon,authenticated,service_role;
grant select,insert,update,delete on public.agency_execution_runs,public.agency_execution_steps to service_role;
grant select,insert,delete on public.agency_execution_commands to service_role;
grant usage,select on sequence public.agency_execution_commands_sequence_seq to service_role;
create trigger agency_execution_command_immutable before update or delete on public.agency_execution_commands for each row execute function public.protect_shared_action_history();

create function public.guard_agency_execution_spec()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_table_name='agency_execution_runs' then
  if(to_jsonb(new)-array['status','authorized_by','version','applied_count','reversed_count','interventions','issue','updated_at'])is distinct from(to_jsonb(old)-array['status','authorized_by','version','applied_count','reversed_count','interventions','issue','updated_at'])then raise exception 'Execution specification is immutable'using errcode='55000';end if;
 else
  if(to_jsonb(new)-array['status','receipt','after_hash','undo_receipt','applied_at','reversed_at'])is distinct from(to_jsonb(old)-array['status','receipt','after_hash','undo_receipt','applied_at','reversed_at'])then raise exception 'Execution step is immutable'using errcode='55000';end if;
 end if;return new;
end$$;
create trigger agency_execution_run_spec before update on public.agency_execution_runs for each row execute function public.guard_agency_execution_spec();
create trigger agency_execution_step_spec before update on public.agency_execution_steps for each row execute function public.guard_agency_execution_spec();
revoke all on function public.guard_agency_execution_spec()from public,anon,authenticated;
grant execute on function public.guard_agency_execution_spec()to service_role;

create function public.agency_execution_contract()returns text language sql stable security invoker set search_path=''as $$
 select encode(extensions.digest(string_agg(pg_get_functiondef(p.oid),E'\n'order by p.proname),'sha256'),'hex')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('agency_execution_contract','agency_execution_source','operate_agency_execution','guard_agency_execution_spec','save_lead_note','guard_lead_note_record','guard_tracked_lead_activity','review_marketvision_alerts','guard_marketvision_alert_version','marketvision_decision_start','marketvision_decision_finish','append_shared_action_event')
$$;
create function public.agency_execution_source(p_property uuid,p_org uuid,p_action text,p_target uuid)returns text language plpgsql stable security invoker set search_path=''as $$
declare body jsonb;
begin
 if not exists(select 1 from public.properties where id=p_property and org_id=p_org)then return null;end if;
 if p_action='lead.note.add'then select to_jsonb(l)into body from public.leads l where l.id=p_target and l.property_id=p_property;
 elsif p_action='market.alert.dismiss'then
  select to_jsonb(a)into body from public.market_alerts a where a.id=p_target and a.property_id=p_property and not coalesce(a.is_dismissed,false)
   and exists(select 1 from public.marketvision_decisions d where d.property_id=p_property and d.org_id=p_org and d.kind='alert.created'and d.resource_id=a.id);
 end if;
 if body is null then return null;end if;return encode(extensions.digest(body::text,'sha256'),'hex');
end$$;
-- Only the local rehearsal operator (postgres) can register disposable targets. No application RPC can enable a scope.
create function public.register_agency_rehearsal(p_property uuid,p_org uuid,p_targets jsonb,p_limit integer default 2)returns void language plpgsql security invoker set search_path=''as $$
declare item jsonb;
begin
 if current_database()!~'^phase7_execution_[0-9]{8}$'or session_user<>'postgres'then raise exception 'Disposable local execution database required';end if;
 if jsonb_typeof(p_targets)is distinct from'array'or jsonb_array_length(p_targets)not between 1 and 2 or p_limit not between 1 and 2 then raise exception 'Bounded rehearsal targets required';end if;
 for item in select value from jsonb_array_elements(p_targets)loop
  if jsonb_typeof(item)is distinct from'object'or item-array['action','targetId']<>'{}'or coalesce(item->>'action','')not in('lead.note.add','market.alert.dismiss')or public.agency_execution_source(p_property,p_org,item->>'action',(item->>'targetId')::uuid)is null then raise exception 'Valid local target required';end if;
 end loop;
 insert into public.agency_execution_scopes(property_id,org_id,allowed_targets,expires_at,max_actions)values(p_property,p_org,p_targets,clock_timestamp()+interval'1 hour',p_limit);
end$$;

create function public.read_agency_execution(p_property_id uuid,p_actor_id uuid,p_input jsonb default '{}')returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;actor_role text;r public.agency_execution_runs;c public.agency_execution_commands;items jsonb;enabled boolean;boundary bigint;
begin
 select p.org_id,u.role into organization,actor_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id for share of p,u;
 if organization is null then return '{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','runId','decisionId','before']<>'{}'then return '{"state":"invalid"}';end if;
 if coalesce(p_input->>'kind','board')='decision'and(coalesce(p_input->>'decisionId','')!~'^[a-fA-F0-9-]{36}$'or p_input?'runId'or p_input?'before')then return '{"state":"invalid"}';end if;
 if p_input->>'kind'='run'and(coalesce(p_input->>'runId','')!~'^[a-fA-F0-9-]{36}$'or p_input?'decisionId'or p_input?'before')then return '{"state":"invalid"}';end if;
 if coalesce(p_input->>'kind','board')in('board','history')and(p_input?'runId'or p_input?'decisionId'or(p_input?'before'and(coalesce(p_input->>'before','')!~'^[1-9][0-9]{0,18}$'or coalesce(p_input->>'kind','board')<>'history')))then return '{"state":"invalid"}';end if;
 enabled:=current_database()~'^phase7_execution_[0-9]{8}$'and exists(select 1 from public.agency_execution_scopes s where s.property_id=p_property_id and s.org_id=organization and s.expires_at>statement_timestamp());
 if p_input->>'kind'='decision'then
  select *into c from public.agency_execution_commands where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=organization and actor_id=p_actor_id;
  if not found then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'decisionId',c.id,'record',to_jsonb(c));
 elsif p_input->>'kind'='run'then
  select *into r from public.agency_execution_runs where id=(p_input->>'runId')::uuid and property_id=p_property_id and org_id=organization;
  if not found then return '{"state":"not_found"}';end if;
  select coalesce(jsonb_agg(to_jsonb(s)order by s.ordinal),'[]')into items from public.agency_execution_steps s where run_id=r.id;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'enabled',enabled,'canManage',actor_role in('admin','manager'),'run',to_jsonb(r),'steps',items,'cost',jsonb_build_object('providerCalls',0,'providerSpendUsd',0,'businessOutcome','unmeasured'));
 elsif coalesce(p_input->>'kind','board')not in('board','history')then return '{"state":"invalid"}';end if;
 boundary:=coalesce((p_input->>'before')::bigint,9223372036854775807);
 select coalesce(jsonb_agg(to_jsonb(x)order by x.sequence desc),'[]')into items from(select cmd.id,cmd.run_id,cmd.input->>'operation'operation,cmd.result,cmd.created_at,cmd.sequence from public.agency_execution_commands cmd where cmd.property_id=p_property_id and cmd.org_id=organization and cmd.sequence<boundary order by cmd.sequence desc limit 21)x;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'enabled',enabled,'canManage',actor_role in('admin','manager'),'mode','local_rehearsal_only','items',case when jsonb_array_length(items)>20 then items-20 else items end,'nextBefore',case when jsonb_array_length(items)>20 then items->19->>'sequence'end);
exception when invalid_text_representation or numeric_value_out_of_range then return '{"state":"invalid"}';
end$$;

create function public.operate_agency_execution(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;c public.agency_execution_commands;r public.agency_execution_runs;scope public.agency_execution_scopes;plan public.agency_plan_revisions;
 s public.agency_execution_steps;item jsonb;result jsonb;v_receipt jsonb;source text;operation text;event_name text;run_id uuid;ordinal integer:=0;spec_hash text;note public.lead_note_records;activity public.lead_activities;alert public.market_alerts;v_after_hash text;blocked text;native_id uuid;changed boolean:=false;
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')for share of p,u;
 if organization is null then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>16000 then return '{"state":"invalid"}';end if;
 operation:=p_input->>'operation';
 if operation='prepare'then
  if p_input-array['operation','planRevision','steps','reason']<>'{}'or jsonb_typeof(p_input->'steps')is distinct from'array'then return '{"state":"invalid"}';end if;
  if coalesce(p_input->>'planRevision','')!~'^[a-fA-F0-9-]{36}$'or jsonb_array_length(p_input->'steps')not between 1 and 2 then return '{"state":"invalid"}';end if;
 elsif operation='cancel_unused'then
  if p_input-array['operation','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then return '{"state":"invalid"}';end if;
 elsif operation in('authorize','advance','pause','resume','stop','reverse')then
  if p_input-array['operation','runId','expectedVersion','specHash','reason']<>'{}'or jsonb_typeof(p_input->'expectedVersion')is distinct from'number'or coalesce(p_input->>'expectedVersion','')!~'^[1-9][0-9]{0,8}$'or coalesce(p_input->>'runId','')!~'^[a-fA-F0-9-]{36}$'or coalesce(p_input->>'specHash','')!~'^[a-f0-9]{64}$'then return '{"state":"invalid"}';end if;
 else return '{"state":"invalid"}';end if;
 if operation<>'cancel_unused'and(jsonb_typeof(p_input->'reason')is distinct from'string'or coalesce(length(btrim(p_input->>'reason')),0)not between 3 and 2000)then return '{"state":"invalid"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,14));
 select *into c from public.agency_execution_commands where id=p_id;
 if found then
  if(c.property_id,c.org_id,c.actor_id)is distinct from(p_property_id,organization,p_actor_id)then return '{"state":"request_conflict"}';end if;
  if operation<>'cancel_unused'and c.input->>'operation'='cancel_unused'then return '{"state":"decision_cancelled"}';end if;
  if operation<>'cancel_unused'and c.input is distinct from p_input then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','propertyId',p_property_id,'decisionId',p_id,'record',to_jsonb(c));
 end if;
 -- This cannot be enabled by an environment variable, a plan, a model, or a console manager.
 if current_database()!~'^phase7_execution_[0-9]{8}$'then return '{"state":"execution_disabled"}';end if;
 select *into scope from public.agency_execution_scopes where property_id=p_property_id and org_id=organization for update;
 if not found then return '{"state":"execution_disabled"}';end if;
 if operation='prepare'then
  if scope.expires_at<=clock_timestamp()then return '{"state":"scope_expired"}';end if;
  select p.*into plan from public.agency_plan_revisions p where p.id=(p_input->>'planRevision')::uuid and p.property_id=p_property_id and p.org_id=organization and p.kind='save'and p.status='reviewed';
  if not found or exists(select 1 from public.agency_plan_revisions newer where newer.property_id=p_property_id and newer.org_id=organization and newer.product=plan.product and newer.kind='save'and newer.sequence>plan.sequence)then return '{"state":"plan_changed"}';end if;
  if plan.evidence->>'sourceHash'is distinct from public.agency_observation_evidence(p_property_id,organization,plan.product)->>'sourceHash'then return '{"state":"evidence_changed"}';end if;
  for item in select value from jsonb_array_elements(p_input->'steps')loop
   if jsonb_typeof(item)is distinct from'object'or item-array['action','targetId','sourceHash','content']<>'{}'or coalesce(item->>'action','')not in('lead.note.add','market.alert.dismiss')or coalesce(item->>'targetId','')!~'^[a-fA-F0-9-]{36}$'or coalesce(item->>'sourceHash','')!~'^[a-f0-9]{64}$'then return '{"state":"invalid"}';end if;
   if not scope.allowed_targets@>jsonb_build_array(jsonb_build_object('action',item->>'action','targetId',item->>'targetId'))then return '{"state":"target_denied"}';end if;
   if item->>'action'='lead.note.add'and(jsonb_typeof(item->'content')is distinct from'string'or coalesce(length(btrim(item->>'content')),0)not between 1 and 2000)then return '{"state":"invalid"}';end if;
   if item->>'action'='market.alert.dismiss'and item?'content'then return '{"state":"invalid"}';end if;
   source:=public.agency_execution_source(p_property_id,organization,item->>'action',(item->>'targetId')::uuid);
   if source is null or source is distinct from item->>'sourceHash'then return '{"state":"source_changed"}';end if;
  end loop;
  if(select count(distinct(value->>'action',value->>'targetId'))from jsonb_array_elements(p_input->'steps'))<>jsonb_array_length(p_input->'steps')then return '{"state":"invalid"}';end if;
  spec_hash:=encode(extensions.digest(jsonb_build_object('planRevision',plan.id,'steps',p_input->'steps','allowedTargets',scope.allowed_targets,'expiresAt',scope.expires_at,'maxActions',scope.max_actions,'contract',public.agency_execution_contract())::text,'sha256'),'hex');
  insert into public.agency_execution_runs(id,property_id,org_id,plan_revision,created_by,spec,spec_hash,contract_hash,status)values(p_id,p_property_id,organization,plan.id,p_actor_id,p_input,spec_hash,public.agency_execution_contract(),'prepared')returning *into r;
  for item in select value from jsonb_array_elements(p_input->'steps')loop
   insert into public.agency_execution_steps(id,run_id,ordinal,action,target_id,source_hash,input,native_id,undo_id)values(gen_random_uuid(),r.id,ordinal,item->>'action',(item->>'targetId')::uuid,item->>'sourceHash',item,gen_random_uuid(),gen_random_uuid());ordinal:=ordinal+1;
  end loop;run_id:=r.id;
 elsif operation<>'cancel_unused'then
  select *into r from public.agency_execution_runs where id=(p_input->>'runId')::uuid and property_id=p_property_id and org_id=organization for update;
  if not found then return '{"state":"not_found"}';end if;run_id:=r.id;
  if r.version is distinct from(p_input->>'expectedVersion')::integer or r.spec_hash is distinct from p_input->>'specHash'then return '{"state":"run_changed"}';end if;
  if operation in('authorize','resume','advance')then
   if scope.expires_at<=clock_timestamp()then blocked:='scope_expired';
   elsif r.contract_hash is distinct from public.agency_execution_contract()then blocked:='adapter_changed';
   elsif not exists(select 1 from public.agency_plan_revisions p where p.id=r.plan_revision and p.status='reviewed'and not exists(select 1 from public.agency_plan_revisions n where n.property_id=p.property_id and n.org_id=p.org_id and n.product=p.product and n.kind='save'and n.sequence>p.sequence))then blocked:='plan_changed';
   elsif operation='authorize'and exists(select 1 from public.agency_plan_revisions p where p.id=r.plan_revision and p.evidence->>'sourceHash'is distinct from public.agency_observation_evidence(p_property_id,organization,p.product)->>'sourceHash')then blocked:='evidence_changed';
   elsif r.authorized_by is not null and not exists(select 1 from public.profiles u where u.id=r.authorized_by and u.org_id=organization and u.role in('admin','manager'))then blocked:='authorization_revoked';end if;
  end if;
  if blocked is not null then r.status:='attention';r.issue:=blocked;
  elsif operation='authorize'and r.status='prepared'then
   for s in select *from public.agency_execution_steps where agency_execution_steps.run_id=r.id order by agency_execution_steps.ordinal loop
    if s.source_hash is distinct from public.agency_execution_source(p_property_id,organization,s.action,s.target_id)then blocked:='source_changed';exit;end if;
   end loop;
   if blocked is not null then r.status:='attention';r.issue:=blocked;else r.status:='authorized';r.authorized_by:=p_actor_id;end if;
  elsif operation='pause'and r.status in('authorized','running')then r.status:='paused';r.interventions:=r.interventions+1;
  elsif operation='resume'and r.status='paused'then r.status:='running';r.interventions:=r.interventions+1;
  elsif operation='stop'and r.status in('prepared','authorized','running','paused','attention')then r.status:='stopped';r.interventions:=r.interventions+1;
  elsif operation='advance'and r.status in('authorized','running')then
   select *into s from public.agency_execution_steps where agency_execution_steps.run_id=r.id and status='pending'order by agency_execution_steps.ordinal limit 1 for update;
   if not found then return '{"state":"state_changed"}';end if;
   if scope.used_actions>=scope.max_actions then r.status:='attention';r.issue:='budget_exhausted';
   elsif not scope.allowed_targets@>jsonb_build_array(jsonb_build_object('action',s.action,'targetId',s.target_id))then r.status:='attention';r.issue:='target_denied';
   else
    -- Lock the exact native target before verifying its source and applying the effect.
    if s.action='lead.note.add'then perform 1 from public.leads where id=s.target_id and property_id=p_property_id for update;
    else perform 1 from public.market_alerts where id=s.target_id and property_id=p_property_id for update;end if;
    if s.source_hash is distinct from public.agency_execution_source(p_property_id,organization,s.action,s.target_id)then r.status:='attention';r.issue:='source_changed';
    else
     begin
      if s.action='lead.note.add'then v_receipt:=public.save_lead_note(s.native_id,p_property_id,s.target_id,r.authorized_by,jsonb_build_object('action','add','content',s.input->>'content','reason','Bounded local agency rehearsal '||r.id));
      else select *into alert from public.market_alerts where id=s.target_id;v_receipt:=public.review_marketvision_alerts(s.native_id,p_property_id,r.authorized_by,jsonb_build_object('action','dismiss','alerts',jsonb_build_array(jsonb_build_object('id',s.target_id,'expectedVersion',alert.version)),'reason','Bounded local agency rehearsal '||r.id));end if;
      if v_receipt->>'state'not in('saved','replayed')then raise exception 'Native effect was not confirmed';end if;
      if s.action='lead.note.add'then v_after_hash:=v_receipt->>'sourceHash';else select encode(extensions.digest(to_jsonb(a)::text,'sha256'),'hex')into v_after_hash from public.market_alerts a where a.id=s.target_id;end if;
      update public.agency_execution_steps set status='applied',receipt=v_receipt,after_hash=v_after_hash,applied_at=clock_timestamp()where id=s.id;
      update public.agency_execution_scopes set used_actions=used_actions+1 where property_id=p_property_id;
      r.applied_count:=r.applied_count+1;r.status:=case when r.applied_count=jsonb_array_length(r.spec->'steps')then'completed'else'running'end;native_id:=s.native_id;changed:=true;
     exception when others then r.status:='attention';r.issue:='native_effect_failed';end;
    end if;
   end if;
  elsif operation='reverse'and r.status in('running','paused','completed','stopped','attention','reversing')then
   if r.contract_hash is distinct from public.agency_execution_contract()then r.status:='attention';r.issue:='adapter_changed';
   else
    select *into s from public.agency_execution_steps where agency_execution_steps.run_id=r.id and status='applied'order by agency_execution_steps.ordinal desc limit 1 for update;
    if not found then return '{"state":"state_changed"}';end if;
    if s.action='lead.note.add'then
     select *into activity from public.lead_activities where id=s.native_id and lead_id=s.target_id for update;select *into note from public.lead_note_records where id=s.native_id and property_id=p_property_id and org_id=organization for update;
     source:=case when note.id is not null and note.state='active'then public.crm_configuration_hash(to_jsonb(activity))end;
    else select *into alert from public.market_alerts where id=s.target_id and property_id=p_property_id for update;source:=case when alert.id is not null then encode(extensions.digest(to_jsonb(alert)::text,'sha256'),'hex')end;end if;
    if source is null or source is distinct from s.after_hash then r.status:='attention';r.issue:='compensation_conflict';
    else
     begin
      if s.action='lead.note.add'then v_receipt:=public.save_lead_note(s.undo_id,p_property_id,s.target_id,p_actor_id,jsonb_build_object('action','withdraw','noteId',s.native_id,'expectedVersion',note.version,'sourceHash',source,'reason','Reverse bounded agency rehearsal '||r.id));
      else v_receipt:=public.review_marketvision_alerts(s.undo_id,p_property_id,p_actor_id,jsonb_build_object('action','restore','alerts',jsonb_build_array(jsonb_build_object('id',s.target_id,'expectedVersion',alert.version)),'reason','Reverse bounded agency rehearsal '||r.id));end if;
      if v_receipt->>'state'not in('saved','replayed')then raise exception 'Compensation not confirmed';end if;
      update public.agency_execution_steps set status='reversed',undo_receipt=v_receipt,reversed_at=clock_timestamp()where id=s.id;
      update public.agency_execution_scopes set used_reversals=used_reversals+1 where property_id=p_property_id;
      r.reversed_count:=r.reversed_count+1;r.status:=case when r.reversed_count=r.applied_count then'reversed'else'reversing'end;r.issue:=null;r.interventions:=r.interventions+1;native_id:=s.undo_id;changed:=true;
     exception when others then r.status:='attention';r.issue:='compensation_failed';end;
    end if;
   end if;
  else return '{"state":"state_changed"}';end if;
  update public.agency_execution_runs set status=r.status,authorized_by=r.authorized_by,version=version+1,applied_count=r.applied_count,reversed_count=r.reversed_count,interventions=r.interventions,issue=r.issue,updated_at=clock_timestamp()where id=r.id returning *into r;
 end if;
 result:=jsonb_build_object('runId',run_id,'status',r.status,'version',r.version,'appliedCount',r.applied_count,'reversedCount',r.reversed_count,'interventions',r.interventions,'issue',r.issue,'nativeReceiptId',native_id,'stepId',s.id,'ordinal',s.ordinal,'mode','local_rehearsal_only','nativeEffect',changed,'providerCalls',0,'providerSpendUsd',0,'businessOutcome','unmeasured');
 insert into public.agency_execution_commands(id,property_id,org_id,actor_id,run_id,input,input_hash,result)values(p_id,p_property_id,organization,p_actor_id,run_id,p_input,encode(extensions.digest(p_input::text,'sha256'),'hex'),result)returning *into c;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_id,organization,p_property_id,p_actor_id,case when operation in('advance','reverse')then'workflow'else'console'end);
 event_name:=case operation when'prepare'then'agency.execution.prepared'when'authorize'then'agency.execution.authorized'when'advance'then'agency.execution.advanced'when'pause'then'agency.execution.paused'when'resume'then'agency.execution.resumed'when'stop'then'agency.execution.stopped'when'reverse'then'agency.execution.reversed'else'agency.execution.cancelled'end;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,after_state,result)values(p_id,p_id,organization,p_property_id,p_actor_id,'agency',event_name,'server_confirmed','succeeded',jsonb_build_object('runId',run_id,'inputHash',c.input_hash,'authorizedBy',r.authorized_by),jsonb_build_object('status',r.status,'version',r.version),result||jsonb_build_object('actorKind',case when operation in('advance','reverse')then'system'else'human'end,'source','local_rehearsal','executionAuthorizedForLive',false));
 return jsonb_build_object('state','saved','propertyId',p_property_id,'decisionId',p_id,'record',to_jsonb(c));
exception when invalid_text_representation or numeric_value_out_of_range then return '{"state":"invalid"}';
end$$;
revoke all on function public.agency_execution_contract(),public.agency_execution_source(uuid,uuid,text,uuid),public.register_agency_rehearsal(uuid,uuid,jsonb,integer),public.read_agency_execution(uuid,uuid,jsonb),public.operate_agency_execution(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
revoke all on function public.register_agency_rehearsal(uuid,uuid,jsonb,integer)from service_role;
grant execute on function public.agency_execution_contract(),public.agency_execution_source(uuid,uuid,text,uuid),public.read_agency_execution(uuid,uuid,jsonb),public.operate_agency_execution(uuid,uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
