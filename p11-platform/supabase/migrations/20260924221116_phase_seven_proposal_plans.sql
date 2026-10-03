-- Human-authored proposal records only. No executable jobs, approvals, budgets or provider effects.
create function public.agency_plan_document_valid(p_doc jsonb)returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare step jsonb;
begin
 if jsonb_typeof(p_doc)is distinct from'object' or p_doc-array['goal','successMeasure','steps']<>'{}'
 or jsonb_typeof(p_doc->'goal')is distinct from'string' or length(btrim(p_doc->>'goal'))not between 3 and 1000
 or jsonb_typeof(p_doc->'successMeasure')is distinct from'string' or length(btrim(p_doc->>'successMeasure'))not between 3 and 1000
 or jsonb_typeof(p_doc->'steps')is distinct from'array' then return false;end if;
 if jsonb_array_length(p_doc->'steps')not between 1 and 8 then return false;end if;
 for step in select value from jsonb_array_elements(p_doc->'steps')loop
  if jsonb_typeof(step)is distinct from'object' or step-array['action','detail']<>'{}'
   or coalesce(step->>'action','')not in('inspect_work','verify_receipt','review_inputs','prepare_followup')
   or jsonb_typeof(step->'detail')is distinct from'string' or length(btrim(step->>'detail'))not between 3 and 1200 then return false;end if;
 end loop;return true;
end$$;
create table public.agency_plan_revisions(
 id uuid primary key,
 property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),
 product text not null check(product=any(public.agency_observation_products())),
 kind text not null check(kind in('save','cancel_unused')),
 input jsonb not null,input_hash text not null,
 previous_id uuid references public.agency_plan_revisions(id),revision integer,
 plan jsonb,evidence jsonb,reason text,status text check(status in('draft','reviewed','withdrawn')),
 policy jsonb not null default '{"mode":"proposal_only","vocabularyVersion":"human-review-v1","allowedActions":["inspect_work","verify_receipt","review_inputs","prepare_followup"],"executionAuthorized":false}',
 created_at timestamptz not null default clock_timestamp(),sequence bigint generated always as identity,
 check((kind='save'and plan is not null and public.agency_plan_document_valid(plan)and evidence is not null and status is not null and reason is not null and length(reason)between 3 and 2000 and revision is not null and revision>0)
 or(kind='cancel_unused'and plan is null and evidence is null and status is null and reason is null and revision is null and previous_id is null))
);
create unique index agency_plan_revision_number on public.agency_plan_revisions(property_id,org_id,product,revision)where kind='save';
create index agency_plan_history on public.agency_plan_revisions(property_id,org_id,product,sequence desc);
create index agency_plan_actor on public.agency_plan_revisions(actor_id);
create index agency_plan_org on public.agency_plan_revisions(org_id);
create index agency_plan_previous on public.agency_plan_revisions(previous_id);
alter table public.agency_plan_revisions enable row level security;
revoke all on public.agency_plan_revisions from public,anon,authenticated;
grant select,insert,delete on public.agency_plan_revisions to service_role;
grant usage,select on sequence public.agency_plan_revisions_sequence_seq to service_role;
create trigger agency_plan_immutable before update or delete on public.agency_plan_revisions for each row execute function public.protect_shared_action_history();

create function public.read_agency_plan(p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;actor_role text;items jsonb;record public.agency_plan_revisions;latest public.agency_plan_revisions;boundary bigint;product_name text;kind text;
begin
 select p.org_id,u.role into organization,actor_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id for share of p,u;
 if organization is null then return '{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object' or p_input-array['product','kind','decisionId','before']<>'{}' then return '{"state":"invalid"}';end if;
 product_name:=p_input->>'product';kind:=coalesce(p_input->>'kind','board');
 if coalesce(product_name,'')<>all(public.agency_observation_products())then return '{"state":"invalid"}';end if;
 if kind='decision' then
  if p_input?'before' or coalesce(p_input->>'decisionId','')!~'^[a-fA-F0-9-]{36}$' then return '{"state":"invalid"}';end if;
  select * into record from public.agency_plan_revisions where id=(p_input->>'decisionId')::uuid and property_id=p_property_id and org_id=organization and product=product_name and actor_id=p_actor_id;
  if not found then return '{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','propertyId',p_property_id,'product',product_name,'decisionId',record.id,'record',to_jsonb(record));
 elsif kind not in('board','history')or p_input?'decisionId'or(kind='board'and p_input?'before')then return '{"state":"invalid"}';end if;
 if p_input?'before'and coalesce(p_input->>'before','')!~'^[1-9][0-9]{0,18}$'then return '{"state":"invalid"}';end if;
 boundary:=coalesce((p_input->>'before')::bigint,9223372036854775807);
 select coalesce(jsonb_agg(to_jsonb(r)order by r.sequence desc),'[]')into items from(select * from public.agency_plan_revisions where property_id=p_property_id and org_id=organization and product=product_name and sequence<boundary order by sequence desc limit 21)r;
 if kind='board'then select r.* into latest from public.agency_plan_revisions r where property_id=p_property_id and org_id=organization and product=product_name and r.kind='save'order by sequence desc limit 1;end if;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'product',product_name,'mode','proposal_only','canManage',actor_role in('admin','manager'),
 'current',case when kind='board'and latest.id is not null then to_jsonb(latest)end,
 'evidence',case when kind='board'then public.agency_observation_evidence(p_property_id,organization,product_name)end,
 'items',case when jsonb_array_length(items)>20 then items-20 else items end,'nextBefore',case when jsonb_array_length(items)>20 then items->19->>'sequence'end);
exception when invalid_text_representation or numeric_value_out_of_range then return '{"state":"invalid"}';
end$$;

create function public.save_agency_plan(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;record public.agency_plan_revisions;latest public.agency_plan_revisions;facts jsonb;input_digest text;kind text;product_name text;previous uuid;status_name text;
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')for share of p,u;
 if organization is null then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or length(p_input::text)>24000 then return '{"state":"invalid"}';end if;
 kind:=p_input->>'operation';product_name:=p_input->>'product';status_name:=p_input->>'status';
 if coalesce(product_name,'')<>all(public.agency_observation_products())then return '{"state":"invalid"}';end if;
 if kind='save'then
  if p_input-array['operation','product','previousId','sourceHash','plan','status','reason']<>'{}'
   or not(p_input?'previousId')or(jsonb_typeof(p_input->'previousId')not in('string','null'))
   or coalesce(p_input->>'sourceHash','')!~'^[a-f0-9]{64}$'or not public.agency_plan_document_valid(p_input->'plan')
   or coalesce(status_name,'')not in('draft','reviewed','withdrawn')or jsonb_typeof(p_input->'reason')is distinct from'string'
   or coalesce(length(btrim(p_input->>'reason')),0)not between 3 and 2000 then return '{"state":"invalid"}';end if;
  if p_input->>'previousId'is not null and(p_input->>'previousId')!~'^[a-fA-F0-9-]{36}$'then return '{"state":"invalid"}';end if;
  begin previous:=(p_input->>'previousId')::uuid;exception when invalid_text_representation then return '{"state":"invalid"}';end;
 elsif kind='cancel_unused'then
  if p_input-array['operation','product','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then return '{"state":"invalid"}';end if;
 else return '{"state":"invalid"}';end if;
 input_digest:=encode(extensions.digest(p_input::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,13));
 select * into record from public.agency_plan_revisions where id=p_id;
 if found then
  if(record.property_id,record.org_id,record.actor_id,record.product)is distinct from(p_property_id,organization,p_actor_id,product_name)then return '{"state":"request_conflict"}';end if;
  if kind<>'cancel_unused'and record.kind='cancel_unused'then return '{"state":"decision_cancelled"}';end if;
  if kind<>'cancel_unused'and record.input is distinct from p_input then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','propertyId',p_property_id,'product',product_name,'decisionId',p_id,'record',to_jsonb(record));
 end if;
 if kind='save'then
  select r.* into latest from public.agency_plan_revisions r where property_id=p_property_id and org_id=organization and product=product_name and r.kind='save'order by sequence desc limit 1;
  if previous is distinct from latest.id then return '{"state":"revision_changed"}';end if;
  if(latest.id is null or latest.status='withdrawn')and status_name<>'draft'then return '{"state":"draft_required"}';end if;
  -- Review the saved revision exactly; changed content must first become a new draft.
  if status_name in('reviewed','withdrawn')and p_input->'plan'is distinct from latest.plan then return '{"state":"draft_required"}';end if;
  facts:=public.agency_observation_evidence(p_property_id,organization,product_name);
  if facts->>'sourceHash'is distinct from p_input->>'sourceHash'then return '{"state":"evidence_changed"}';end if;
 end if;
 insert into public.agency_plan_revisions(id,property_id,org_id,actor_id,product,kind,input,input_hash,previous_id,revision,plan,evidence,reason,status)
 values(p_id,p_property_id,organization,p_actor_id,product_name,kind,p_input,input_digest,previous,case when kind='save'then coalesce(latest.revision,0)+1 end,
 case when kind='save'then p_input->'plan'end,facts,case when kind='save'then p_input->>'reason'end,status_name)returning * into record;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_id,organization,p_property_id,p_actor_id,'console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,after_state,result)
 values(p_id,p_id,organization,p_property_id,p_actor_id,'agency',case when kind='cancel_unused'then'agency.plan.cancelled'when status_name='reviewed'then'agency.plan.reviewed'when status_name='withdrawn'then'agency.plan.withdrawn'else'agency.plan.drafted'end,
 'server_confirmed','succeeded',jsonb_build_object('revisionId',p_id,'previousId',previous,'product',product_name,'sourceHash',facts->>'sourceHash'),
 jsonb_build_object('status',status_name,'revision',record.revision),jsonb_build_object('revisionId',p_id,'mode','proposal_only','executionAuthorized',false));
 return jsonb_build_object('state','saved','propertyId',p_property_id,'product',product_name,'decisionId',p_id,'record',to_jsonb(record));
end$$;
revoke all on function public.agency_plan_document_valid(jsonb),public.read_agency_plan(uuid,uuid,jsonb),public.save_agency_plan(uuid,uuid,uuid,jsonb)from public,anon,authenticated;
grant execute on function public.agency_plan_document_valid(jsonb),public.read_agency_plan(uuid,uuid,jsonb),public.save_agency_plan(uuid,uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
