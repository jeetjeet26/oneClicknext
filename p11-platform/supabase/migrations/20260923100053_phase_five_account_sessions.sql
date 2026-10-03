-- Private account-owned session decisions. Never retain access/refresh tokens or auth secrets.
create table public.account_session_requests(
 id uuid primary key,actor_id uuid not null references public.profiles(id)on delete cascade,
 organization_snapshot uuid,session_id uuid,scope text check(scope in('local','others')),
 source_hash text,input_hash text not null,reviewed_sessions jsonb not null default '[]',
 state text not null check(state in('claimed','acknowledged','rejected','uncertain','observed','cancelled')),
 claim_id uuid,provider_result text check(provider_result in('acknowledged','rejected','uncertain')),
 observation jsonb,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 request_sequence bigint generated always as identity unique
);
create table public.account_session_events(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.account_session_requests(id)on delete cascade,
 actor_id uuid not null references public.profiles(id)on delete cascade,kind text not null,
 facts jsonb not null,created_at timestamptz not null default clock_timestamp(),
 event_sequence bigint generated always as identity unique
);
create index account_session_request_owner on public.account_session_requests(actor_id,request_sequence desc);
create index account_session_event_request on public.account_session_events(request_id,event_sequence);
create index account_session_event_owner on public.account_session_events(actor_id,event_sequence);
alter table public.account_session_requests enable row level security;
alter table public.account_session_events enable row level security;
revoke all on public.account_session_requests,public.account_session_events from public,anon,authenticated;
grant all on public.account_session_requests,public.account_session_events to service_role;
grant usage,select on sequence public.account_session_requests_request_sequence_seq,public.account_session_events_event_sequence_seq to service_role;

-- Narrow server-only projections avoid granting the application role any auth table access.
create function public.account_session_source(p_actor_id uuid,p_session_id uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('actorId',u.id,'sessionId',p_session_id,'requiresMfa',exists(select 1 from auth.mfa_factors f where f.user_id=u.id and f.status='verified'),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'createdAt',s.created_at,'lastSeenAt',coalesce(s.refreshed_at,s.updated_at),'expiresAt',s.not_after,'agent',left(s.user_agent,200),'current',s.id=p_session_id)order by s.created_at,s.id)from auth.sessions s where s.user_id=u.id and(s.not_after is null or s.not_after>statement_timestamp())),'[]'::jsonb))
 from auth.users u where u.id=p_actor_id and u.deleted_at is null and u.email_confirmed_at is not null and(u.banned_until is null or u.banned_until<=statement_timestamp())
 and exists(select 1 from auth.sessions s where s.id=p_session_id and s.user_id=u.id and(s.not_after is null or s.not_after>statement_timestamp()))
$$;
create function public.account_session_ids(p_actor_id uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(s.id order by s.id),'[]')from auth.sessions s where s.user_id=p_actor_id and(s.not_after is null or s.not_after>statement_timestamp())
$$;
create function public.account_session_hash(p_source jsonb)returns text language sql immutable security invoker set search_path=''as $$
 select public.knowledge_hash(jsonb_build_object('actorId',p_source->'actorId','sessionId',p_source->'sessionId','requiresMfa',p_source->'requiresMfa','ids',(select coalesce(jsonb_agg(x->'id'order by x->>'id'),'[]')from jsonb_array_elements(p_source->'sessions')x)))
$$;
create function public.guard_account_sessions()returns trigger language plpgsql security invoker set search_path=''as $$
declare actor uuid;
begin
 actor:=case when tg_op='DELETE'then old.actor_id else new.actor_id end;
 if tg_op='DELETE'and not exists(select 1 from public.profiles where id=actor)then return old;end if;
 if tg_op='DELETE'or current_setting('p11.security_actor',true)is distinct from actor::text then raise exception 'Use a recorded account session decision';end if;
 if tg_table_name='account_session_events'and tg_op='UPDATE'then raise exception 'Session evidence is immutable';end if;
 if tg_table_name='account_session_requests'and tg_op='UPDATE'then
  if(new.id,new.actor_id,new.organization_snapshot,new.session_id,new.scope,new.source_hash,new.input_hash,new.reviewed_sessions,new.claim_id,new.created_at,new.request_sequence)is distinct from(old.id,old.actor_id,old.organization_snapshot,old.session_id,old.scope,old.source_hash,old.input_hash,old.reviewed_sessions,old.claim_id,old.created_at,old.request_sequence)then raise exception 'Session request identity is immutable';end if;
 end if;return new;
end$$;
create trigger account_session_request_guard before insert or update or delete on public.account_session_requests for each row execute function public.guard_account_sessions();
create trigger account_session_event_guard before insert or update or delete on public.account_session_events for each row execute function public.guard_account_sessions();

create function public.append_account_session_event(p_id uuid,p_kind text,p_facts jsonb)returns void language plpgsql security invoker set search_path=''as $$
declare r public.account_session_requests;eid uuid:=gen_random_uuid();
begin
 select *into r from public.account_session_requests where id=p_id;if not found then raise exception 'Session request required';end if;
 insert into public.account_session_events(id,request_id,actor_id,kind,facts)values(eid,r.id,r.actor_id,p_kind,p_facts);
 -- Private account history survives membership changes. Only safe summaries enter a real organization.
 if r.organization_snapshot is not null and exists(select 1 from public.organizations where id=r.organization_snapshot)then
  insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(eid,r.organization_snapshot,null,r.actor_id,'console');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result)
  values(eid,eid,r.organization_snapshot,null,r.actor_id,'settings','security.session_'||p_kind,'server_confirmed',case when p_kind='acknowledged'then'succeeded'when p_kind='rejected'then'failed'else'observed'end,
  jsonb_build_object('requestId',r.id,'scope',r.scope),'{}','{}',jsonb_build_object('outcome',p_kind));
 end if;
end$$;
create function public.account_session_receipt(p_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('requestId',r.id,'actorId',r.actor_id,'scope',r.scope,'status',r.state,'providerResult',r.provider_result,'observation',r.observation,'createdAt',r.created_at,'updatedAt',r.updated_at,'reviewedCount',jsonb_array_length(r.reviewed_sessions))from public.account_session_requests r where r.id=p_id
$$;

-- Creation is the execution claim. A replay NEVER receives the claim token or calls the provider again.
create function public.claim_account_session(p_id uuid,p_actor_id uuid,p_session_id uuid,p_aal text,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_session_requests;src jsonb;scope_value text:=p_input->>'scope';digest text;token uuid:=gen_random_uuid();targets jsonb;organization uuid;
begin
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or p_input-array['scope','sourceHash','confirmed']<>'{}'or scope_value is null or scope_value not in('local','others')or p_input->'confirmed'is distinct from'true'::jsonb or coalesce(p_input->>'sourceHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the exact session scope';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,940));perform pg_advisory_xact_lock(hashtextextended(p_id::text,941));
 src:=public.account_session_source(p_actor_id,p_session_id);if src is null then return'{"state":"forbidden"}';end if;
 digest:=public.knowledge_hash(p_input);
 select *into r from public.account_session_requests where id=p_id;
 if found then
  if r.actor_id<>p_actor_id then return'{"state":"not_found"}';end if;
  if r.state='cancelled'then return public.account_session_receipt(p_id)||'{"state":"replayed"}';end if;
  if r.input_hash<>digest then return'{"state":"request_conflict"}';end if;
  return public.account_session_receipt(p_id)||'{"state":"replayed"}';
 end if;
 if scope_value='others'and src->'requiresMfa'='true'::jsonb and p_aal is distinct from'aal2'then return'{"state":"mfa_required"}';end if;
 if scope_value='local'and exists(select 1 from public.account_session_requests where actor_id=p_actor_id and session_id=p_session_id and scope='local'and state not in('rejected','cancelled'))then return'{"state":"existing_request"}';end if;
 if public.account_session_hash(src)<>p_input->>'sourceHash'then return'{"state":"sessions_changed"}';end if;
 select coalesce(jsonb_agg(x->'id'order by x->>'id'),'[]')into targets from jsonb_array_elements(src->'sessions')x where (scope_value='local'and x->>'id'=p_session_id::text)or(scope_value='others'and x->>'id'<>p_session_id::text);
 if targets='[]'::jsonb then return'{"state":"no_other_sessions"}';end if;
 select org_id into organization from public.profiles where id=p_actor_id;
 perform set_config('p11.security_actor',p_actor_id::text,true);
 insert into public.account_session_requests(id,actor_id,organization_snapshot,session_id,scope,source_hash,input_hash,reviewed_sessions,state,claim_id)values(p_id,p_actor_id,organization,p_session_id,scope_value,p_input->>'sourceHash',digest,targets,'claimed',token);
 perform public.append_account_session_event(p_id,'claimed',jsonb_build_object('reviewedCount',jsonb_array_length(targets)));
 return public.account_session_receipt(p_id)||jsonb_build_object('state','claimed','claimId',token);
end$$;

-- This server receipt uses the original claim, including after the provider removes the current session.
create function public.finish_account_session(p_id uuid,p_actor_id uuid,p_claim_id uuid,p_outcome text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_session_requests;
begin
 if p_outcome is null or p_outcome not in('acknowledged','rejected','uncertain')then raise exception 'Use the bounded provider outcome';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,940));
 select *into r from public.account_session_requests where id=p_id for update;
 if not found or(r.actor_id,r.claim_id)is distinct from(p_actor_id,p_claim_id)or p_claim_id is null then return'{"state":"not_found"}';end if;
 if r.provider_result is not null then
  if r.provider_result<>p_outcome then return'{"state":"request_conflict"}';end if;
  return public.account_session_receipt(p_id)||'{"state":"replayed"}';
 end if;
 perform set_config('p11.security_actor',p_actor_id::text,true);
 update public.account_session_requests set state=p_outcome,provider_result=p_outcome,updated_at=clock_timestamp()where id=p_id;
 perform public.append_account_session_event(p_id,p_outcome,'{}');
 return public.account_session_receipt(p_id)||'{"state":"saved"}';
end$$;

create function public.review_account_session(p_id uuid,p_actor_id uuid,p_session_id uuid,p_operation text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_session_requests;ids jsonb;observation_value jsonb;remaining integer;organization uuid;
begin
 if p_id is null or p_operation is null or p_operation not in('check','cancel_unused')then raise exception 'Choose a session recovery decision';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,940));perform pg_advisory_xact_lock(hashtextextended(p_id::text,941));
 if public.account_session_source(p_actor_id,p_session_id)is null then return'{"state":"forbidden"}';end if;
 select *into r from public.account_session_requests where id=p_id for update;
 if not found then
  if p_operation='check'then return'{"state":"not_found"}';end if;
  perform set_config('p11.security_actor',p_actor_id::text,true);select org_id into organization from public.profiles where id=p_actor_id;
  insert into public.account_session_requests(id,actor_id,organization_snapshot,input_hash,state)values(p_id,p_actor_id,organization,public.knowledge_hash(jsonb_build_object('cancelledRequest',p_id)),'cancelled');
  perform public.append_account_session_event(p_id,'cancelled','{}');return public.account_session_receipt(p_id)||'{"state":"saved"}';
 end if;
 if r.actor_id<>p_actor_id then return'{"state":"not_found"}';end if;
 if p_operation='cancel_unused'or r.state in('cancelled','acknowledged','rejected')then return public.account_session_receipt(p_id)||'{"state":"replayed"}';end if;
 ids:=public.account_session_ids(p_actor_id);
 select count(*)into remaining from jsonb_array_elements(r.reviewed_sessions)x where ids @> jsonb_build_array(x);
 observation_value:=jsonb_build_object('reviewedRemaining',remaining,'reviewedAbsent',remaining=0,'otherSessionsNow',(select count(*)from jsonb_array_elements(ids)x where x#>>'{}'<>p_session_id::text));
 if r.observation is distinct from observation_value then
  perform set_config('p11.security_actor',p_actor_id::text,true);
  update public.account_session_requests set observation=observation_value,state=case when remaining=0 then'observed'else state end,updated_at=clock_timestamp()where id=p_id;
  perform public.append_account_session_event(p_id,'observed',observation_value);
 end if;
 return public.account_session_receipt(p_id)||'{"state":"saved"}';
end$$;

create function public.read_account_sessions(p_actor_id uuid,p_session_id uuid,p_aal text,p_input jsonb default '{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare src jsonb;kind text:=coalesce(p_input->>'kind','current');r public.account_session_requests;items jsonb;total bigint;page_hash text;page_offset integer:=coalesce((p_input->>'offset')::int,0);events jsonb;
begin
 src:=public.account_session_source(p_actor_id,p_session_id);if src is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','requestId','offset','expectedHash']<>'{}'or kind not in('current','history','detail')or page_offset not between 0 and 1000000 then raise exception 'Choose supported session history';end if;
 if kind='current'then
  return src||jsonb_build_object('state','ready','sourceHash',public.account_session_hash(src),'canRevoke',src->'requiresMfa'='false'::jsonb or p_aal='aal2');
 elsif kind='detail'then
  select *into r from public.account_session_requests where id=(p_input->>'requestId')::uuid and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'facts',e.facts,'createdAt',e.created_at)order by e.event_sequence),'[]')into events from public.account_session_events e where e.request_id=r.id;
  return public.account_session_receipt(r.id)||jsonb_build_object('state','ready','events',events);
 end if;
 select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(id,state,updated_at)order by request_sequence),'[]'))into total,page_hash from public.account_session_requests where actor_id=p_actor_id;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>page_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(public.account_session_receipt(q.id)order by q.request_sequence desc),'[]')into items from(select id,request_sequence from public.account_session_requests where actor_id=p_actor_id order by request_sequence desc limit 20 offset page_offset)q;
 return jsonb_build_object('state','ready','actorId',p_actor_id,'items',items,'total',total,'pageHash',page_hash,'offset',page_offset);
end$$;
revoke all on function public.account_session_source(uuid,uuid)from public,anon,authenticated;grant execute on function public.account_session_source(uuid,uuid)to service_role;
revoke all on function public.account_session_ids(uuid)from public,anon,authenticated;grant execute on function public.account_session_ids(uuid)to service_role;
revoke all on function public.account_session_hash(jsonb)from public,anon,authenticated;grant execute on function public.account_session_hash(jsonb)to service_role;
revoke all on function public.guard_account_sessions()from public,anon,authenticated;grant execute on function public.guard_account_sessions()to service_role;
revoke all on function public.append_account_session_event(uuid,text,jsonb)from public,anon,authenticated;grant execute on function public.append_account_session_event(uuid,text,jsonb)to service_role;
revoke all on function public.account_session_receipt(uuid)from public,anon,authenticated;grant execute on function public.account_session_receipt(uuid)to service_role;
revoke all on function public.claim_account_session(uuid,uuid,uuid,text,jsonb)from public,anon,authenticated;grant execute on function public.claim_account_session(uuid,uuid,uuid,text,jsonb)to service_role;
revoke all on function public.finish_account_session(uuid,uuid,uuid,text)from public,anon,authenticated;grant execute on function public.finish_account_session(uuid,uuid,uuid,text)to service_role;
revoke all on function public.review_account_session(uuid,uuid,uuid,text)from public,anon,authenticated;grant execute on function public.review_account_session(uuid,uuid,uuid,text)to service_role;
revoke all on function public.read_account_sessions(uuid,uuid,text,jsonb)from public,anon,authenticated;grant execute on function public.read_account_sessions(uuid,uuid,text,jsonb)to service_role;
