-- Credential bytes remain exclusively with Auth. App history retains bounded decisions only.
create table public.account_credential_requests(
 id uuid primary key,actor_id uuid not null references public.profiles(id)on delete cascade,
 organization_snapshot uuid,session_id uuid,source_hash text,claim_id uuid,
 state text not null check(state in('verifying','changing','confirmed','verification_failed','rejected','uncertain','cancelled')),
 cleanup_outcome text check(cleanup_outcome in('confirmed','not_created','unconfirmed')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 request_sequence bigint generated always as identity unique
);
create table public.account_credential_events(
 id uuid primary key default gen_random_uuid(),request_id uuid references public.account_credential_requests(id)on delete cascade,
 actor_id uuid not null references public.profiles(id)on delete cascade,kind text not null,
 provider_transaction bigint,created_at timestamptz not null default clock_timestamp(),event_sequence bigint generated always as identity unique
);
create index account_credential_request_owner on public.account_credential_requests(actor_id,request_sequence desc);
create index account_credential_event_owner on public.account_credential_events(actor_id,event_sequence desc);
create index account_credential_event_request on public.account_credential_events(request_id,event_sequence);
create unique index account_credential_provider_transaction on public.account_credential_events(actor_id,provider_transaction)where provider_transaction is not null;
alter table public.account_credential_requests enable row level security;
alter table public.account_credential_events enable row level security;
revoke all on public.account_credential_requests,public.account_credential_events from public,anon,authenticated;
grant all on public.account_credential_requests,public.account_credential_events to service_role;
grant usage,select on sequence public.account_credential_requests_request_sequence_seq,public.account_credential_events_event_sequence_seq to service_role;

create function public.guard_account_credentials()returns trigger language plpgsql security invoker set search_path=''as $$
declare actor uuid;
begin
 actor:=case when tg_op='DELETE'then old.actor_id else new.actor_id end;
 if tg_op='DELETE'and not exists(select 1 from public.profiles where id=actor)then return old;end if;
 if tg_op='DELETE'or current_setting('p11.credential_actor',true)is distinct from actor::text then raise exception 'Use a recorded credential decision';end if;
 if tg_table_name='account_credential_events'and tg_op='UPDATE'then raise exception 'Credential evidence is immutable';end if;
 if tg_table_name='account_credential_requests'and tg_op='UPDATE'then
  if(new.id,new.actor_id,new.organization_snapshot,new.session_id,new.source_hash,new.claim_id,new.created_at,new.request_sequence)is distinct from(old.id,old.actor_id,old.organization_snapshot,old.session_id,old.source_hash,old.claim_id,old.created_at,old.request_sequence)then raise exception 'Credential request identity is immutable';end if;
 end if;
 return new;
end$$;
create trigger account_credential_request_guard before insert or update or delete on public.account_credential_requests for each row execute function public.guard_account_credentials();
create trigger account_credential_event_guard before insert or update or delete on public.account_credential_events for each row execute function public.guard_account_credentials();
create function public.account_credential_receipt(p_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('requestId',r.id,'actorId',r.actor_id,'status',r.state,'cleanupOutcome',r.cleanup_outcome,'createdAt',r.created_at,'updatedAt',r.updated_at)from public.account_credential_requests r where r.id=p_id
$$;
create function public.append_account_credential_event(p_id uuid,p_kind text,p_transaction bigint default null)returns void language plpgsql security invoker set search_path=''as $$
declare r public.account_credential_requests;eid uuid:=gen_random_uuid();
begin
 select *into r from public.account_credential_requests where id=p_id;if not found then raise exception 'Credential request required';end if;
 insert into public.account_credential_events(id,request_id,actor_id,kind,provider_transaction)values(eid,r.id,r.actor_id,p_kind,p_transaction);
 if r.organization_snapshot is not null and exists(select 1 from public.organizations where id=r.organization_snapshot)then
  insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(eid,r.organization_snapshot,null,r.actor_id,'console');
  insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result)values(eid,eid,r.organization_snapshot,null,r.actor_id,'settings','security.password_'||p_kind,'server_confirmed',case when p_kind='confirmed'then'succeeded'when p_kind in('verification_failed','rejected')then'failed'else'observed'end,jsonb_build_object('requestId',r.id),'{}','{}',jsonb_build_object('outcome',p_kind));
 end if;
end$$;
create function public.account_credential_source(p_actor_id uuid,p_session_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('actorId',p_actor_id,'sessionId',p_session_id,'requiresMfa',public.account_session_source(p_actor_id,p_session_id)->'requiresMfa','revision',coalesce((select max(event_sequence)from public.account_credential_events where actor_id=p_actor_id),0))
$$;
create function public.claim_account_credential(p_id uuid,p_actor_id uuid,p_session_id uuid,p_aal text,p_source_hash text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_credential_requests;src jsonb;organization uuid;claim uuid:=gen_random_uuid();
begin
 if p_id is null or coalesce(p_source_hash,'')!~'^[a-f0-9]{64}$'then raise exception 'Review the current credential request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,942));perform pg_advisory_xact_lock(hashtextextended(p_id::text,943));
 src:=public.account_session_source(p_actor_id,p_session_id);if src is null then return'{"state":"forbidden"}';end if;
 select *into r from public.account_credential_requests where id=p_id;
 if found then
  if r.actor_id<>p_actor_id then return'{"state":"not_found"}';end if;
  if r.state<>'cancelled'and r.source_hash<>p_source_hash then return'{"state":"request_conflict"}';end if;
  return public.account_credential_receipt(p_id)||'{"state":"replayed"}';
 end if;
 if src->'requiresMfa'='true'::jsonb and p_aal is distinct from'aal2'then return'{"state":"mfa_required"}';end if;
 if public.knowledge_hash(public.account_credential_source(p_actor_id,p_session_id))<>p_source_hash then return'{"state":"credentials_changed"}';end if;
 if exists(select 1 from public.account_credential_requests where actor_id=p_actor_id and state in('verifying','changing','uncertain'))then return'{"state":"pending_request"}';end if;
 if(select count(*)from public.account_credential_requests where actor_id=p_actor_id and claim_id is not null and created_at>statement_timestamp()-interval'10 minutes')>=5 then return'{"state":"rate_limited"}';end if;
 select org_id into organization from public.profiles where id=p_actor_id;
 perform set_config('p11.credential_actor',p_actor_id::text,true);
 insert into public.account_credential_requests(id,actor_id,organization_snapshot,session_id,source_hash,claim_id,state)values(p_id,p_actor_id,organization,p_session_id,p_source_hash,claim,'verifying');
 perform public.append_account_credential_event(p_id,'verification_started');
 return public.account_credential_receipt(p_id)||jsonb_build_object('state','claimed','claimId',claim);
end$$;
create function public.advance_account_credential(p_id uuid,p_actor_id uuid,p_claim_id uuid,p_aal text,p_verified boolean,p_cleanup text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_credential_requests;src jsonb;next_state text;
begin
 if p_cleanup is null or p_cleanup not in('confirmed','not_created','unconfirmed')or p_verified is null then raise exception 'Supply bounded verification evidence';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,942));select *into r from public.account_credential_requests where id=p_id for update;
 if not found or(r.actor_id,r.claim_id)is distinct from(p_actor_id,p_claim_id)or p_claim_id is null then return'{"state":"not_found"}';end if;
 if r.state<>'verifying'then return public.account_credential_receipt(p_id)||'{"state":"replayed"}';end if;
 src:=public.account_session_source(p_actor_id,r.session_id);
 next_state:=case when not p_verified or p_cleanup<>'confirmed'then'verification_failed'when src is null or(src->'requiresMfa'='true'::jsonb and p_aal is distinct from'aal2')then'rejected'else'changing'end;
 perform set_config('p11.credential_actor',p_actor_id::text,true);
 update public.account_credential_requests set state=next_state,cleanup_outcome=p_cleanup,updated_at=clock_timestamp()where id=p_id;
 perform public.append_account_credential_event(p_id,case when next_state='changing'then'change_started'else next_state end);
 return public.account_credential_receipt(p_id)||jsonb_build_object('state',case when next_state='changing'then'execute'else'saved'end);
end$$;
create function public.finish_account_credential(p_id uuid,p_actor_id uuid,p_claim_id uuid,p_outcome text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_credential_requests;
begin
 if p_outcome is null or p_outcome not in('rejected','uncertain')then raise exception 'Use bounded unconfirmed provider outcome';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,942));select *into r from public.account_credential_requests where id=p_id for update;
 if not found or(r.actor_id,r.claim_id)is distinct from(p_actor_id,p_claim_id)or p_claim_id is null then return'{"state":"not_found"}';end if;
 if r.state not in('changing','uncertain')or r.state=p_outcome then return public.account_credential_receipt(p_id)||'{"state":"replayed"}';end if;
 perform set_config('p11.credential_actor',p_actor_id::text,true);
 update public.account_credential_requests set state=p_outcome,updated_at=clock_timestamp()where id=p_id;
 perform public.append_account_credential_event(p_id,p_outcome);
 return public.account_credential_receipt(p_id)||'{"state":"saved"}';
end$$;

-- Deferred until the Auth transaction has written both the password and correlation marker.
-- A user-metadata marker alone is not evidence or authorization. Actual password storage
-- must change in this transaction and match a previously authorized private execution claim.
create function public.record_account_credential_commit()returns trigger language plpgsql security definer set search_path=''as $$
declare marker text;r public.account_credential_requests;transaction_id bigint:=txid_current();
begin
 if not exists(select 1 from public.profiles where id=new.id)then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.id::text,942));
 if exists(select 1 from public.account_credential_events where actor_id=new.id and provider_transaction=transaction_id)then return new;end if;
 select raw_user_meta_data->>'p11_credential_request'into marker from auth.users where id=new.id;
 if marker is distinct from old.raw_user_meta_data->>'p11_credential_request'and coalesce(marker,'')~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'then
  select *into r from public.account_credential_requests where actor_id=new.id and claim_id=marker::uuid for update;
  if found then
   if r.state not in('changing','uncertain')then raise exception 'This credential request is no longer authorized';end if;
   perform set_config('p11.credential_actor',new.id::text,true);
   update public.account_credential_requests set state='confirmed',updated_at=clock_timestamp()where id=r.id;
   perform public.append_account_credential_event(r.id,'confirmed',transaction_id);
   return new;
  end if;
 end if;
 -- Hold an uncorrelated write while execution is outstanding, including provider contract drift.
 if exists(select 1 from public.account_credential_requests where actor_id=new.id and state in('changing','uncertain'))then raise exception 'Resolve the pending credential request before another password write';end if;
 -- Out-of-band credential storage changes are observations, with no invented user intent.
 perform set_config('p11.credential_actor',new.id::text,true);
 insert into public.account_credential_events(actor_id,kind,provider_transaction)values(new.id,'provider_record_changed',transaction_id);
 return new;
end$$;
create constraint trigger recorded_account_credential_commit after update on auth.users deferrable initially deferred for each row when(old.encrypted_password is distinct from new.encrypted_password)execute function public.record_account_credential_commit();

create function public.review_account_credential(p_id uuid,p_actor_id uuid,p_session_id uuid,p_operation text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_credential_requests;organization uuid;
begin
 if p_id is null or p_operation is null or p_operation not in('check','cancel')then raise exception 'Choose a credential recovery decision';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,942));perform pg_advisory_xact_lock(hashtextextended(p_id::text,943));
 if public.account_session_source(p_actor_id,p_session_id)is null then return'{"state":"forbidden"}';end if;
 select *into r from public.account_credential_requests where id=p_id for update;
 if found and r.actor_id<>p_actor_id then return'{"state":"not_found"}';end if;
 if found and(p_operation='check'or r.state in('confirmed','cancelled','rejected','verification_failed'))then return public.account_credential_receipt(p_id)||'{"state":"replayed"}';end if;
 if not found and p_operation='check'then return'{"state":"not_found"}';end if;
 perform set_config('p11.credential_actor',p_actor_id::text,true);
 if r.id is null then
  select org_id into organization from public.profiles where id=p_actor_id;
  insert into public.account_credential_requests(id,actor_id,organization_snapshot,state)values(p_id,p_actor_id,organization,'cancelled');
 else update public.account_credential_requests set state='cancelled',updated_at=clock_timestamp()where id=p_id;end if;
 perform public.append_account_credential_event(p_id,'cancelled');
 return public.account_credential_receipt(p_id)||'{"state":"saved"}';
end$$;
create function public.read_account_credentials(p_actor_id uuid,p_session_id uuid,p_aal text,p_input jsonb default '{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare src jsonb;kind text:=coalesce(p_input->>'kind','current');items jsonb;events jsonb;total bigint;page_hash text;page_offset integer:=coalesce((p_input->>'offset')::int,0);r public.account_credential_requests;
begin
 src:=public.account_session_source(p_actor_id,p_session_id);if src is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','requestId','offset','expectedHash']<>'{}'or kind not in('current','history','detail')or page_offset not between 0 and 1000000 then raise exception 'Choose private credential history';end if;
 if kind='current'then return jsonb_build_object('state','ready','actorId',p_actor_id,'sourceHash',public.knowledge_hash(public.account_credential_source(p_actor_id,p_session_id)),'canChange',src->'requiresMfa'='false'::jsonb or p_aal='aal2','pendingRequestId',(select id from public.account_credential_requests where actor_id=p_actor_id and state in('verifying','changing','uncertain')order by request_sequence desc limit 1));end if;
 if kind='detail'then
  select *into r from public.account_credential_requests where id=(p_input->>'requestId')::uuid and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'createdAt',e.created_at)order by e.event_sequence),'[]')into events from public.account_credential_events e where e.request_id=r.id;
  return public.account_credential_receipt(r.id)||jsonb_build_object('state','ready','events',events);
 end if;
 select count(*),public.knowledge_hash(coalesce(jsonb_agg(jsonb_build_array(e.id,e.kind)order by e.event_sequence),'[]'))into total,page_hash from public.account_credential_events e where e.actor_id=p_actor_id;
 if p_input->>'expectedHash'is not null and p_input->>'expectedHash'<>page_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'requestId',q.request_id,'kind',q.kind,'createdAt',q.created_at)order by q.event_sequence desc),'[]')into items from(select *from public.account_credential_events where actor_id=p_actor_id order by event_sequence desc limit 20 offset page_offset)q;
 return jsonb_build_object('state','ready','actorId',p_actor_id,'items',items,'total',total,'pageHash',page_hash,'offset',page_offset);
end$$;
revoke all on function public.guard_account_credentials()from public,anon,authenticated;grant execute on function public.guard_account_credentials()to service_role;
revoke all on function public.account_credential_receipt(uuid)from public,anon,authenticated;grant execute on function public.account_credential_receipt(uuid)to service_role;
revoke all on function public.append_account_credential_event(uuid,text,bigint)from public,anon,authenticated;grant execute on function public.append_account_credential_event(uuid,text,bigint)to service_role;
revoke all on function public.account_credential_source(uuid,uuid)from public,anon,authenticated;grant execute on function public.account_credential_source(uuid,uuid)to service_role;
revoke all on function public.claim_account_credential(uuid,uuid,uuid,text,text)from public,anon,authenticated;grant execute on function public.claim_account_credential(uuid,uuid,uuid,text,text)to service_role;
revoke all on function public.advance_account_credential(uuid,uuid,uuid,text,boolean,text)from public,anon,authenticated;grant execute on function public.advance_account_credential(uuid,uuid,uuid,text,boolean,text)to service_role;
revoke all on function public.finish_account_credential(uuid,uuid,uuid,text)from public,anon,authenticated;grant execute on function public.finish_account_credential(uuid,uuid,uuid,text)to service_role;
revoke all on function public.record_account_credential_commit()from public,anon,authenticated;grant execute on function public.record_account_credential_commit()to service_role;
revoke all on function public.review_account_credential(uuid,uuid,uuid,text)from public,anon,authenticated;grant execute on function public.review_account_credential(uuid,uuid,uuid,text)to service_role;
revoke all on function public.read_account_credentials(uuid,uuid,text,jsonb)from public,anon,authenticated;grant execute on function public.read_account_credentials(uuid,uuid,text,jsonb)to service_role;
