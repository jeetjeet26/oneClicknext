-- Reviewed property facts, creative direction, imported observations and measured decisions.
-- Additive only: existing CRM, chatbot, inventory and marketing facts are untouched.
create table public.property_intelligence_documents (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id), kind text not null check(kind in('fact','creative','batch','recommendation','experiment')),
 key text not null check(key ~ '^[a-zA-Z0-9_.:-]{1,160}$'), payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=2000000),
 status text not null default 'draft' check(status in('draft','approved','withdrawn','implemented','measured','dismissed')),
 revision integer not null default 1 check(revision>0), locked boolean not null default false,
 actor_id uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(property_id,kind,key)
);
create table public.property_intelligence_changes (
 id uuid primary key, property_id uuid not null references public.properties(id) on delete cascade, org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id), input jsonb not null, before_value jsonb, after_value jsonb not null, result jsonb not null,
 created_at timestamptz not null default now()
);
create trigger property_intelligence_history_immutable before update or delete on public.property_intelligence_changes for each row execute function public.protect_shared_action_history();
create index on public.property_intelligence_documents(property_id,kind,status);
create index on public.property_intelligence_changes(property_id,created_at desc);
alter table public.property_intelligence_documents enable row level security;
alter table public.property_intelligence_changes enable row level security;
revoke all on public.property_intelligence_documents,public.property_intelligence_changes from public,anon,authenticated;
grant select,insert,update,delete on public.property_intelligence_documents to service_role;
grant select,insert on public.property_intelligence_changes to service_role;
create function public.decide_property_intelligence(p_id uuid,p_actor_id uuid,p_property_id uuid,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare org uuid; d public.property_intelligence_documents; old public.property_intelligence_changes;
 k text:=p_input->>'kind'; item_key text:=p_input->>'key'; op text:=p_input->>'operation'; before_doc jsonb; result jsonb; next_status text;
begin
 select p.org_id into org from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id and a.role in('admin','manager');
 if org is null or not private.delivery_access(p_actor_id,p_property_id,true,true) then return '{"state":"forbidden"}'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,0));
 select * into old from public.property_intelligence_changes where id=p_id;
 if found then
  if old.property_id<>p_property_id or old.actor_id<>p_actor_id or old.input<>p_input then return '{"state":"request_conflict"}';end if;
  return old.result||'{"state":"replayed"}'::jsonb;
 end if;
 if k not in('fact','creative','batch','recommendation','experiment') or item_key is null or item_key!~'^[a-zA-Z0-9_.:-]{1,160}$' or length(trim(coalesce(p_input->>'reason','')))<3 then return '{"state":"invalid_input"}';end if;
 select * into d from public.property_intelligence_documents where property_id=p_property_id and kind=k and key=item_key for update;
 if coalesce(d.revision,0)<>(p_input->>'expectedRevision')::integer then return '{"state":"changed"}'; end if;
 before_doc:=case when d.id is not null then to_jsonb(d) end;
 if op='save' then
  if d.locked then return '{"state":"locked"}';end if;
  if d.status in('implemented','measured') or (k='experiment' and d.status='approved') then return '{"state":"frozen"}';end if;
  if jsonb_typeof(p_input->'payload')<>'object' or octet_length((p_input->'payload')::text)>2000000 then return '{"state":"invalid_input"}';end if;
  if d.id is null then
   insert into public.property_intelligence_documents(property_id,org_id,kind,key,payload,actor_id)values(p_property_id,org,k,item_key,p_input->'payload',p_actor_id) returning * into d;
  else
   update public.property_intelligence_documents set payload=p_input->'payload',status='draft',revision=revision+1,actor_id=p_actor_id,updated_at=now() where id=d.id returning * into d;
  end if;
 else
  if d.id is null then return '{"state":"not_found"}';end if;
  if op in('lock','unlock') then
   if k not in('fact','creative') then return '{"state":"invalid_transition"}';end if;
   update public.property_intelligence_documents set locked=(op='lock'),revision=revision+1,actor_id=p_actor_id,updated_at=now() where id=d.id returning * into d;
  else
   next_status:=case op when 'approve' then 'approved' when 'withdraw' then 'withdrawn' when 'implement' then 'implemented' when 'measure' then 'measured' when 'dismiss' then 'dismissed' end;
   if next_status is null or (op='approve' and d.status<>'draft') or (op='withdraw' and d.status not in('approved','draft')) or (op='implement' and (k<>'recommendation' or d.status<>'approved')) or (op='measure' and ((k='recommendation' and d.status<>'implemented') or (k='experiment' and d.status<>'approved') or k not in('recommendation','experiment'))) or (op='dismiss' and (k<>'recommendation' or d.status not in('draft','approved'))) then return '{"state":"invalid_transition"}';end if;
   if k='experiment' and op='approve' and (d.payload->>'start')::date<=current_date then return '{"state":"preregister_required"}';end if;
   if k in('experiment','recommendation') and d.payload->>'releaseEvent' is not null and not exists(select 1 from public.shared_action_events where id=(d.payload->>'releaseEvent')::uuid and property_id=p_property_id and org_id=org and evidence='server_confirmed' and phase='succeeded' and action in('site.delivery.recorded','site.delivery.reviewed','knowledge.source.published','knowledge.facts.published','property.setup.saved','property.unit.approved','luma.configuration.saved','crm.mapping.approved','studio.configuration.saved','review.publication.reported','integration.account.replaced','pipeline.import.finished'))then return '{"state":"invalid_evidence"}';end if;
   if op='implement' and d.payload->>'releaseEvent' is null then return '{"state":"invalid_evidence"}';end if;
   if op='measure' and k='recommendation' then
    if length(trim(coalesce(p_input#>>'{payload,result}','')))<3 or not exists(select 1 from public.shared_action_events where id=(p_input#>>'{payload,measurementEvent}')::uuid and property_id=p_property_id and org_id=org and evidence='server_confirmed' and phase='succeeded' and action in('bi.query.executed','delivery.outcomes','tour.outcome.recorded','studio.metrics.reviewed','studio.attribution.reviewed','audit.run_reviewed') and created_at>=d.updated_at)then return '{"state":"invalid_evidence"}';end if;
   end if;
   if op='measure' and k='experiment' and ((d.payload->>'end')::date>=current_date or p_input#>>'{payload,evaluation,ready}' is distinct from 'true')then return '{"state":"invalid_evidence"}';end if;
   update public.property_intelligence_documents set status=next_status,payload=case when op='measure' then payload||(p_input->'payload') else payload end,revision=revision+1,actor_id=p_actor_id,updated_at=now() where id=d.id returning * into d;
  end if;
 end if;
 result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'document',to_jsonb(d));
 insert into public.property_intelligence_changes(id,property_id,org_id,actor_id,input,before_value,after_value,result)values(p_id,p_property_id,org,p_actor_id,p_input,before_doc,to_jsonb(d),result);
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_id,org,p_property_id,p_actor_id,'console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result)
 values(p_id,p_id,org,p_property_id,p_actor_id,'platform','intelligence.'||k||'.'||op,'server_confirmed','succeeded',jsonb_build_object('commandId',p_id,'reason',p_input->>'reason'),jsonb_build_object('revision',before_doc->'revision','status',before_doc->'status'),jsonb_build_object('documentId',d.id,'revision',d.revision,'status',d.status),jsonb_build_object('recorded',true,'externalExecution',false));
 return result;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return '{"state":"invalid_input"}';
end $$;
revoke all on function public.decide_property_intelligence(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.decide_property_intelligence(uuid,uuid,uuid,jsonb) to service_role;
