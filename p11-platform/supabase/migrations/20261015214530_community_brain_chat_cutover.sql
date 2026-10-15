begin;

-- A suspension after adoption must never silently restore an older facts prompt.
alter table public.community_brain_settings add column chat_activated_at timestamptz;
update public.community_brain_settings set chat_activated_at=clock_timestamp()
where context_enabled and 'chat'=any(consumers);

create function public.brain_remember_chat_adoption() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.chat_activated_at is not null then
  new.chat_activated_at:=old.chat_activated_at;
 elsif new.context_enabled and 'chat'=any(new.consumers) then
  new.chat_activated_at:=clock_timestamp();
 else new.chat_activated_at:=null;
 end if;
 return new;
end$$;
create trigger brain_remember_chat_adoption before insert or update on public.community_brain_settings
for each row execute function public.brain_remember_chat_adoption();

create function public.brain_chat_release(p_config_id uuid,p_session_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare pid uuid;s public.community_brain_settings;
begin
 select w.property_id into pid from public.widget_sessions w
 join public.lumaleasing_config l on l.property_id=w.property_id
 where w.id=p_session_id and l.id=p_config_id and l.is_active
 and w.session_end is null and w.last_activity_at>statement_timestamp()-interval '48 hours';
 if pid is null then raise insufficient_privilege using message='Chat session is unavailable';end if;
 select *into s from public.community_brain_settings where property_id=pid;
 if not found then raise exception 'Community release state is missing';end if;
 return jsonb_build_object('propertyId',pid,'revision',s.policy_revision,'mode',
 case when s.context_enabled and 'chat'=any(s.consumers) then 'brain'
 when s.chat_activated_at is null then 'legacy' else 'withheld' end);
end$$;
revoke all on function public.brain_chat_release(uuid,uuid),public.brain_remember_chat_adoption() from public,anon,authenticated,community_brain_worker;
grant execute on function public.brain_chat_release(uuid,uuid) to service_role;

-- Keep a bounded, immutable migration receipt without replacing old source rows.
create table public.community_adoption_receipts(
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id),
 actor_id uuid not null references auth.users(id),
 source_snapshot_hash text not null check(source_snapshot_hash~'^[a-f0-9]{64}$'),
 manifest jsonb not null check(jsonb_typeof(manifest)='object'),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.community_adoption_receipts enable row level security;
revoke all on public.community_adoption_receipts from public,anon,authenticated,community_brain_worker;
grant select,insert on public.community_adoption_receipts to service_role;
create trigger brain_adoption_receipt_immutable before update or delete on public.community_adoption_receipts
for each row execute function public.guard_siteforge_brief_history();

-- Migrated facts name their exact evidence. Withdrawing/replacing that source
-- immediately removes those facts as well, before background indexing runs.
do $$declare definition text;begin
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure)into definition;
 if position('where d.kind=''fact'' and d.status=''approved'''in definition)=0 then raise exception 'Canonical fact predicate changed; review migration';end if;
 definition:=replace(definition,'where d.kind=''fact'' and d.status=''approved''',
 'where d.kind=''fact'' and d.status=''approved'' and (not(d.payload?''sourceEvidenceId'') or public.brain_evidence_eligible((d.payload->>''sourceEvidenceId'')::uuid,d.property_id,p_purpose,''public''))');
 execute definition;
end$$;

-- A retry must not replay a pre-cutover or withdrawn factual answer. The native
-- request receipt stays immutable; the caller receives the existing review state.
alter function public.claim_recorded_luma_request(uuid,uuid,text,text,text,text)
 rename to _brain_claim_recorded_luma_request_v1;
revoke all on function public._brain_claim_recorded_luma_request_v1(uuid,uuid,text,text,text,text) from public,anon,authenticated,service_role;
create function public.claim_recorded_luma_request(p_property_id uuid,p_request_id uuid,p_operation text,p_raw_input text,p_actor text,p_key_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;source jsonb;request jsonb;current_context jsonb;release jsonb;begin
 result:=public._brain_claim_recorded_luma_request_v1(p_property_id,p_request_id,p_operation,p_raw_input,p_actor,p_key_hash);
 if p_operation='chat' and result->>'state'='completed'
 and exists(select 1 from public.community_brain_settings where property_id=p_property_id and chat_activated_at is not null)
 and jsonb_typeof(result->'response'->'content')='string' then
  select i.source into source from public.luma_model_intents i where i.property_id=p_property_id and i.request_id=p_request_id and i.purpose='answer';
  request:=source->'communityRequest';
  begin
   if request is null or source->'assistantContext'->'chatRelease'->>'mode' is distinct from 'brain' then return '{"state":"review"}'::jsonb;end if;
   release:=public.brain_chat_release((request->>'configId')::uuid,(request->>'sessionId')::uuid);
   if release->>'mode'<>'brain' or release->>'propertyId'<>p_property_id::text
    or release->>'revision' is distinct from source->'assistantContext'->'chatRelease'->>'revision' then return '{"state":"review"}'::jsonb;end if;
   current_context:=public.brain_public_context((request->>'configId')::uuid,(request->>'sessionId')::uuid,request->>'query');
   current_context:=jsonb_build_object('propertyId',p_property_id,'canonical',(current_context->'canonical')-'asOf','evidence',current_context->'evidence','currentDate',left(current_context->>'asOf',10));
   if current_context is distinct from source->'assistantContext'->'contextJson' then return '{"state":"review"}'::jsonb;end if;
  exception when others then return '{"state":"review"}'::jsonb;
  end;
 end if;
 return result;
end$$;
revoke all on function public.claim_recorded_luma_request(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_recorded_luma_request(uuid,uuid,text,text,text,text) to service_role;

commit;
