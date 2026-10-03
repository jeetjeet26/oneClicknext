-- Recovery authority comes only from the current Auth session, never user metadata.
alter table public.account_credential_requests add column purpose text not null default 'change' check(purpose in('change','recovery'));
create function public.account_recovery_grant(p_actor_id uuid,p_session_id uuid)returns timestamptz language sql stable security definer set search_path=''as $$
 select max(a.created_at)+interval '15 minutes' from auth.mfa_amr_claims a join auth.sessions s on s.id=a.session_id
 where s.user_id=p_actor_id and s.id=p_session_id and a.authentication_method='recovery' and a.created_at>statement_timestamp()-interval '15 minutes'
 and a.created_at<=statement_timestamp() and public.account_session_source(p_actor_id,p_session_id)is not null
$$;
revoke all on function public.account_recovery_grant(uuid,uuid)from public,anon,authenticated;grant execute on function public.account_recovery_grant(uuid,uuid)to service_role;
create or replace function public.guard_account_credentials()returns trigger language plpgsql security invoker set search_path=''as $$
declare actor uuid;
begin
 actor:=case when tg_op='DELETE'then old.actor_id else new.actor_id end;
 if tg_op='DELETE'and not exists(select 1 from public.profiles where id=actor)then return old;end if;
 if tg_op='DELETE'or current_setting('p11.credential_actor',true)is distinct from actor::text then raise exception 'Use a recorded credential decision';end if;
 if tg_table_name='account_credential_events'and tg_op='UPDATE'then raise exception 'Credential evidence is immutable';end if;
 if tg_table_name='account_credential_requests'and tg_op='UPDATE'then
  if(new.id,new.actor_id,new.organization_snapshot,new.session_id,new.source_hash,new.claim_id,new.created_at,new.request_sequence,new.purpose)is distinct from(old.id,old.actor_id,old.organization_snapshot,old.session_id,old.source_hash,old.claim_id,old.created_at,old.request_sequence,old.purpose)then raise exception 'Credential request identity is immutable';end if;
 end if;
 return new;
end$$;
create function public.claim_account_recovery(p_id uuid,p_actor_id uuid,p_session_id uuid,p_aal text,p_source_hash text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare r public.account_credential_requests;src jsonb;organization uuid;claim uuid:=gen_random_uuid();
begin
 if p_id is null or coalesce(p_source_hash,'')!~'^[a-f0-9]{64}$'then raise exception 'Review the current recovery request';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,942));perform pg_advisory_xact_lock(hashtextextended(p_id::text,943));
 src:=public.account_session_source(p_actor_id,p_session_id);if src is null then return'{"state":"forbidden"}';end if;
 select *into r from public.account_credential_requests where id=p_id;
 if found then
  if r.actor_id<>p_actor_id then return'{"state":"not_found"}';end if;
  if r.state<>'cancelled'and(r.purpose<>'recovery'or r.source_hash<>p_source_hash)then return'{"state":"request_conflict"}';end if;
  return public.account_credential_receipt(p_id)||'{"state":"replayed"}';
 end if;
 if src->'requiresMfa'='true'::jsonb and p_aal is distinct from'aal2'then return'{"state":"mfa_required"}';end if;
 if public.account_recovery_grant(p_actor_id,p_session_id)is null then return'{"state":"recovery_required"}';end if;
 if exists(select 1 from public.account_credential_requests where actor_id=p_actor_id and session_id=p_session_id and purpose='recovery'and state='confirmed')then return'{"state":"recovery_consumed"}';end if;
 if public.knowledge_hash(public.account_credential_source(p_actor_id,p_session_id))<>p_source_hash then return'{"state":"credentials_changed"}';end if;
 if exists(select 1 from public.account_credential_requests where actor_id=p_actor_id and state in('verifying','changing','uncertain'))then return'{"state":"pending_request"}';end if;
 if(select count(*)from public.account_credential_requests where actor_id=p_actor_id and claim_id is not null and created_at>statement_timestamp()-interval'10 minutes')>=5 then return'{"state":"rate_limited"}';end if;
 select org_id into organization from public.profiles where id=p_actor_id;
 perform set_config('p11.credential_actor',p_actor_id::text,true);
 insert into public.account_credential_requests(id,actor_id,organization_snapshot,session_id,source_hash,claim_id,state,purpose)values(p_id,p_actor_id,organization,p_session_id,p_source_hash,claim,'changing','recovery');
 perform public.append_account_credential_event(p_id,'recovery_verified');
 perform public.append_account_credential_event(p_id,'reset_started');
 return public.account_credential_receipt(p_id)||jsonb_build_object('state','claimed','claimId',claim);
end$$;
revoke all on function public.claim_account_recovery(uuid,uuid,uuid,text,text)from public,anon,authenticated;grant execute on function public.claim_account_recovery(uuid,uuid,uuid,text,text)to service_role;
create or replace function public.record_account_credential_commit()returns trigger language plpgsql security definer set search_path=''as $$
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
   if r.purpose='recovery'and public.account_recovery_grant(r.actor_id,r.session_id)is null then raise exception 'The recovery grant is no longer valid';end if;
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
create or replace function public.read_account_credentials(p_actor_id uuid,p_session_id uuid,p_aal text,p_input jsonb default '{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare src jsonb;kind text:=coalesce(p_input->>'kind','current');items jsonb;events jsonb;total bigint;page_hash text;page_offset integer:=coalesce((p_input->>'offset')::int,0);r public.account_credential_requests;
begin
 src:=public.account_session_source(p_actor_id,p_session_id);if src is null then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','requestId','offset','expectedHash']<>'{}'or kind not in('current','history','detail')or page_offset not between 0 and 1000000 then raise exception 'Choose private credential history';end if;
 if kind='current'then return jsonb_build_object('state','ready','actorId',p_actor_id,'sourceHash',public.knowledge_hash(public.account_credential_source(p_actor_id,p_session_id)),'canChange',src->'requiresMfa'='false'::jsonb or p_aal='aal2','canRecover',public.account_recovery_grant(p_actor_id,p_session_id)is not null and not exists(select 1 from public.account_credential_requests where actor_id=p_actor_id and session_id=p_session_id and purpose='recovery'and state='confirmed'),'recoveryExpiresAt',public.account_recovery_grant(p_actor_id,p_session_id),'pendingRequestId',(select id from public.account_credential_requests where actor_id=p_actor_id and state in('verifying','changing','uncertain')order by request_sequence desc limit 1));end if;
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
