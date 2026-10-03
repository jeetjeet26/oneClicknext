-- Organization-scoped team decisions. Invitation links never send an email automatically.
alter table public.shared_action_episodes alter column property_id drop not null;
alter table public.shared_action_events alter column property_id drop not null;
alter table public.shared_action_events add constraint organization_action_scope check(property_id is not null or (product in('team','settings')and shared_job_ref is null and shared_attempt_ref is null and context_snapshot_ref is null));
create or replace function public.protect_shared_action_history()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and ((old.property_id is not null and not exists(select 1 from public.properties where id=old.property_id))or(old.property_id is null and not exists(select 1 from public.organizations where id=old.org_id)))then return old;end if;
 raise exception 'Action history is immutable'using errcode='55000';
end$$;

create table public.team_workspaces(org_id uuid primary key references public.organizations(id)on delete cascade,revision bigint not null default 1,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create table public.team_invitations(id uuid primary key,org_id uuid not null references public.organizations(id)on delete cascade,created_by uuid not null references public.profiles(id),issuer_id uuid not null references public.profiles(id),email text not null,role text not null check(role in('admin','manager','viewer')),token_hash text not null check(token_hash~'^[a-f0-9]{64}$'),revision bigint not null default 1,status text not null default'pending'check(status in('pending','accepted','declined','revoked')),expires_at timestamptz not null,accepted_by uuid references public.profiles(id),accepted_at timestamptz,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create unique index team_invitation_token on public.team_invitations(token_hash);
create index team_invitation_org on public.team_invitations(org_id,created_at desc,id);
create table public.team_decisions(id uuid primary key,org_id uuid not null references public.organizations(id)on delete cascade,actor_id uuid not null references public.profiles(id),target_id uuid,kind text not null check(kind in('role_changed','member_removed','invitation_created','invitation_rotated','invitation_revoked','invitation_accepted','invitation_declined','invitation_copy_reported','join_cancelled','cancelled')),input jsonb not null,input_hash text not null,before_state jsonb not null,after_state jsonb not null,result jsonb not null,decision_sequence bigint generated always as identity,created_at timestamptz not null default clock_timestamp());
create index team_decision_org on public.team_decisions(org_id,decision_sequence desc);
create index team_decision_actor on public.team_decisions(actor_id,decision_sequence desc);
create index team_decision_target on public.team_decisions(target_id,decision_sequence desc);
alter table public.team_workspaces enable row level security;
alter table public.team_invitations enable row level security;
alter table public.team_decisions enable row level security;
revoke all on public.team_workspaces,public.team_invitations,public.team_decisions from public,anon,authenticated;
grant all on public.team_workspaces,public.team_invitations,public.team_decisions to service_role;
grant usage,select on sequence public.team_decisions_decision_sequence_seq to service_role;

create function public.team_member_view(p_id uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',p.id,'orgId',p.org_id,'name',p.full_name,'role',p.role,'email',u.email,'emailConfirmed',u.email_confirmed_at is not null,'accessBlocked',u.deleted_at is not null or (u.banned_until is not null and u.banned_until>statement_timestamp()),'createdAt',p.created_at)from public.profiles p join auth.users u on u.id=p.id where p.id=p_id
$$;
create function public.team_roster(p_org_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select coalesce(jsonb_agg(public.team_member_view(p.id)order by p.created_at,p.id),'[]')from public.profiles p where p.org_id=p_org_id
$$;
create function public.team_admin_current(p_org_id uuid,p_actor_id uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor_id and p.org_id=p_org_id and p.role='admin'and u.email_confirmed_at is not null and u.deleted_at is null and(u.banned_until is null or u.banned_until<=statement_timestamp()))
$$;
create function public.team_invitation_view(p_row public.team_invitations)returns jsonb language sql stable security invoker set search_path=''as $$
 select case when p_row.id is null then null else jsonb_build_object('id',p_row.id,'orgId',p_row.org_id,'createdBy',p_row.created_by,'issuerId',p_row.issuer_id,'email',p_row.email,'role',p_row.role,'revision',p_row.revision,'status',p_row.status,'effectiveStatus',case when p_row.status='pending'and p_row.expires_at<=statement_timestamp()then'expired'else p_row.status end,'expiresAt',p_row.expires_at,'acceptedBy',p_row.accepted_by,'acceptedAt',p_row.accepted_at,'createdAt',p_row.created_at,'issuerAuthorized',public.team_admin_current(p_row.org_id,p_row.issuer_id))end
$$;
create function public.team_invitation_hash(p_row public.team_invitations)returns text language sql stable security invoker set search_path=''as $$select public.knowledge_hash(public.team_invitation_view(p_row))$$;
create function public.guard_team_state()returns trigger language plpgsql security invoker set search_path=''as $$
declare organization uuid;
begin
 organization:=case when tg_op='DELETE'then old.org_id else new.org_id end;
 if tg_op='DELETE'and not exists(select 1 from public.organizations where id=organization)then return old;end if;
 if tg_table_name='team_decisions'then raise exception 'Retain the team decision';end if;
 if tg_op='DELETE'or current_setting('p11.team_scope',true)is distinct from organization::text then raise exception 'Use a recorded team decision';end if;
 if tg_op='UPDATE'then
  if tg_table_name='team_invitations'then if(new.id,new.org_id,new.created_by,new.email,new.role,new.created_at)is distinct from(old.id,old.org_id,old.created_by,old.email,old.role,old.created_at)then raise exception 'Invitation identity is immutable';end if;end if;
  if tg_table_name='team_workspaces'and(new.org_id,new.created_at)is distinct from(old.org_id,old.created_at)then raise exception 'Team ownership is immutable';end if;
 end if;return new;
end$$;
create trigger team_decision_immutable before update or delete on public.team_decisions for each row execute function public.guard_team_state();
create trigger team_invitation_guard before insert or update or delete on public.team_invitations for each row execute function public.guard_team_state();
create trigger team_workspace_guard before insert or update or delete on public.team_workspaces for each row execute function public.guard_team_state();
create function public.guard_recorded_membership()returns trigger language plpgsql security invoker set search_path=''as $$
declare organization uuid;
begin
 if tg_op='DELETE'then
  if public.team_member_view(old.id)is null then return old;end if;
  if exists(select 1 from public.team_workspaces where org_id=old.org_id)then raise exception 'Retain the member account and review removal of organization access';end if;return old;
 end if;
 if tg_op='INSERT'or(new.org_id,new.role)is distinct from(old.org_id,old.role)then
  for organization in select org_id from public.team_workspaces where org_id=new.org_id or (tg_op='UPDATE'and org_id=old.org_id)loop
   if current_setting('p11.team_scope',true)is distinct from organization::text then raise exception 'Use a recorded team access decision';end if;
  end loop;
 end if;return new;
end$$;
create trigger recorded_team_membership before insert or update or delete on public.profiles for each row execute function public.guard_recorded_membership();

create function public.append_team_action(p_decision_id uuid)returns void language plpgsql security invoker set search_path=''as $$
declare decision public.team_decisions;action_name text;event public.shared_action_events;
begin
 select *into decision from public.team_decisions where id=p_decision_id;if not found then raise exception 'Retained team decision required';end if;
 action_name:='team.'||decision.kind;
 select *into event from public.shared_action_events where id=decision.id;
 if found then
  if(event.org_id,event.property_id,event.actor_id,event.product,event.action,event.request)is distinct from(decision.org_id,null::uuid,decision.actor_id,'team'::text,action_name,jsonb_build_object('decisionId',decision.id,'inputHash',decision.input_hash))then raise exception 'Team action identity conflict';end if;return;
 end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(decision.id,decision.org_id,null,decision.actor_id,'console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result)values(decision.id,decision.id,decision.org_id,null,decision.actor_id,'team',action_name,case when decision.kind='invitation_copy_reported'then'browser_observed'else'server_confirmed'end,case when decision.kind='invitation_copy_reported'then'observed'else'succeeded'end,jsonb_build_object('decisionId',decision.id,'inputHash',decision.input_hash),jsonb_build_object('hash',public.knowledge_hash(decision.before_state)),jsonb_build_object('hash',public.knowledge_hash(decision.after_state)),decision.result);
end$$;

create function public.decide_team_access(p_id uuid,p_org_id uuid,p_actor_id uuid,p_input jsonb,p_token_hash text default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare operation text:=p_input->>'operation';decision_kind text;prior public.team_decisions;invitation public.team_invitations;target uuid;roster jsonb;member jsonb;before_value jsonb;after_value jsonb;result jsonb;admin_count integer;next_role text;days integer;email_value text;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and org_id=p_org_id)then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>16384 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 3 and 2000 or operation is null or operation not in('change_role','remove_member','create_invitation','rotate_invitation','revoke_invitation','cancel_unused')then raise exception 'Review the team decision and reason';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text,937));
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,938));
 perform 1 from public.profiles where id=p_actor_id and org_id=p_org_id for share;if not found then return'{"state":"forbidden"}';end if;
 select *into prior from public.team_decisions where id=p_id;
 if found then
  if(prior.org_id,prior.actor_id)is distinct from(p_org_id,p_actor_id)then return'{"state":"request_conflict"}';end if;
  if prior.kind='cancelled'and operation<>'cancel_unused'then return'{"state":"decision_cancelled"}';end if;
  if operation<>'cancel_unused'and prior.input<>p_input then return'{"state":"request_conflict"}';end if;
  if prior.kind='cancelled'and prior.input<>p_input then return'{"state":"request_conflict"}';end if;
  return prior.result||'{"state":"replayed"}';
 end if;
 if not public.team_admin_current(p_org_id,p_actor_id)then return'{"state":"forbidden"}';end if;
 if operation='cancel_unused'then
  if p_input-array['operation','reason','inputHash']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused request digest';end if;
  decision_kind:='cancelled';before_value:='{}';after_value:='{}';
 else
  if p_input->'confirmed'is distinct from'true'::jsonb then raise exception 'Confirm the exact team access decision';end if;
  if operation in('change_role','remove_member')then
   if p_input-array['operation','reason','confirmed','memberId','memberHash','rosterHash','role']<>'{}'or coalesce(p_input->>'memberHash','')!~'^[a-f0-9]{64}$'or coalesce(p_input->>'rosterHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the exact member and team roster';end if;
   target:=(p_input->>'memberId')::uuid;
   perform 1 from public.profiles where id=target and org_id=p_org_id for update;if not found then return'{"state":"not_found"}';end if;
   member:=public.team_member_view(target);if member is null then return'{"state":"not_found"}';end if;roster:=public.team_roster(p_org_id);
   if public.knowledge_hash(member)is distinct from p_input->>'memberHash'or public.knowledge_hash(roster)is distinct from p_input->>'rosterHash'then return'{"state":"team_changed"}';end if;
   next_role:=case when operation='remove_member'then'viewer'else p_input->>'role'end;
   if next_role is null or next_role not in('admin','manager','viewer')or(operation='remove_member'and p_input?'role')then raise exception 'Choose a supported member role';end if;
   if operation='remove_member'and target=p_actor_id then return'{"state":"self_removal"}';end if;
   if operation='change_role'and next_role=member->>'role'then return'{"state":"no_change"}';end if;
   select count(*)into admin_count from public.profiles where org_id=p_org_id and public.team_admin_current(p_org_id,id);
   if member->>'role'='admin'and(operation='remove_member'or next_role<>'admin')and not exists(select 1 from public.profiles where org_id=p_org_id and id<>target and public.team_admin_current(p_org_id,id))then return'{"state":"last_admin"}';end if;
   before_value:=jsonb_build_object('member',member,'rosterHash',public.knowledge_hash(roster),'availableAdmins',admin_count);
   perform set_config('p11.team_scope',p_org_id::text,true);
   if operation='remove_member'then update public.profiles set org_id=null,role='viewer'where id=target;decision_kind:='member_removed';else update public.profiles set role=next_role where id=target;decision_kind:='role_changed';end if;
   after_value:=jsonb_build_object('member',public.team_member_view(target),'rosterHash',public.knowledge_hash(public.team_roster(p_org_id)));
  elsif operation='create_invitation'then
   if p_input-array['operation','reason','confirmed','email','role','expiresInDays']<>'{}'or jsonb_typeof(p_input->'email')is distinct from'string'or coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then raise exception 'Review the invitation recipient and role';end if;
   email_value:=lower(btrim(p_input->>'email'));next_role:=p_input->>'role';
   if length(email_value)not between 3 and 254 or email_value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'or next_role is null or next_role not in('admin','manager','viewer')or jsonb_typeof(p_input->'expiresInDays')is distinct from'number'or(p_input->>'expiresInDays')!~'^[0-9]+$'then raise exception 'Use a valid email, role and expiration';end if;
   days:=(p_input->>'expiresInDays')::integer;if days not between 1 and 14 then raise exception 'Invitations can last one to fourteen days';end if;
   if exists(select 1 from public.profiles m where m.org_id=p_org_id and lower(public.team_member_view(m.id)->>'email')=email_value)then return'{"state":"already_member"}';end if;
   if exists(select 1 from public.team_invitations where org_id=p_org_id and email=email_value and status='pending'and expires_at>statement_timestamp())then return'{"state":"invitation_exists"}';end if;
   before_value:='{}';target:=p_id;perform set_config('p11.team_scope',p_org_id::text,true);
   insert into public.team_invitations(id,org_id,created_by,issuer_id,email,role,token_hash,expires_at)values(target,p_org_id,p_actor_id,p_actor_id,email_value,next_role,p_token_hash,clock_timestamp()+make_interval(days=>days))returning *into invitation;
   after_value:=jsonb_build_object('invitation',public.team_invitation_view(invitation));decision_kind:='invitation_created';
  else
   if p_input-array['operation','reason','confirmed','invitationId','invitationHash','expiresInDays']<>'{}'or coalesce(p_input->>'invitationHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the exact saved invitation';end if;
   target:=(p_input->>'invitationId')::uuid;select *into invitation from public.team_invitations where id=target and org_id=p_org_id for update;if not found then return'{"state":"not_found"}';end if;
   if public.team_invitation_hash(invitation)is distinct from p_input->>'invitationHash'then return'{"state":"invitation_changed"}';end if;
   if invitation.status<>'pending'then return'{"state":"invitation_finished"}';end if;
   before_value:=jsonb_build_object('invitation',public.team_invitation_view(invitation));perform set_config('p11.team_scope',p_org_id::text,true);
   if operation='rotate_invitation'then
    if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'or jsonb_typeof(p_input->'expiresInDays')is distinct from'number'or(p_input->>'expiresInDays')!~'^[0-9]+$'then raise exception 'Review a replacement invitation lifetime';end if;
    days:=(p_input->>'expiresInDays')::integer;if days not between 1 and 14 then raise exception 'Invitations can last one to fourteen days';end if;
    update public.team_invitations set token_hash=p_token_hash,issuer_id=p_actor_id,revision=revision+1,expires_at=clock_timestamp()+make_interval(days=>days),updated_at=clock_timestamp()where id=target returning *into invitation;decision_kind:='invitation_rotated';
   else
    if p_input?'expiresInDays'then raise exception 'Review invitation revocation without a new lifetime';end if;
    update public.team_invitations set status='revoked',revision=revision+1,updated_at=clock_timestamp()where id=target returning *into invitation;decision_kind:='invitation_revoked';
   end if;after_value:=jsonb_build_object('invitation',public.team_invitation_view(invitation));
  end if;
 end if;
 perform set_config('p11.team_scope',p_org_id::text,true);
 insert into public.team_workspaces(org_id)values(p_org_id)on conflict(org_id)do update set revision=team_workspaces.revision+1,updated_at=clock_timestamp();
 result:=jsonb_build_object('state','saved','orgId',p_org_id,'decisionId',p_id,'targetId',target,'kind',decision_kind,'membershipRevoked',decision_kind='member_removed','emailSent',false,'cancelled',decision_kind='cancelled');
 insert into public.team_decisions(id,org_id,actor_id,target_id,kind,input,input_hash,before_state,after_state,result)values(p_id,p_org_id,p_actor_id,target,decision_kind,p_input,public.knowledge_hash(p_input),before_value,after_value,result);
 perform public.append_team_action(p_id);perform set_config('p11.team_scope','',true);return result;
end$$;

create function public.read_team_access(p_actor_id uuid,p_org_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare reader_role text;read_kind text:=coalesce(p_input->>'kind','members');off integer:=coalesce((p_input->>'offset')::integer,0);rows jsonb;items jsonb;row_hash text;total integer;member jsonb;decision public.team_decisions;invitation public.team_invitations;roster jsonb;
begin
 select role into reader_role from public.profiles where id=p_actor_id and org_id=p_org_id;if not found then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','memberId','invitationId','decisionId','offset','expectedHash']<>'{}'or read_kind not in('members','member','invitations','invitation','history','history_detail','decision')or off not between 0 and 1000000 then raise exception 'Choose a team member or saved decision';end if;
 if read_kind='decision'then
  select *into decision from public.team_decisions where id=(p_input->>'decisionId')::uuid and org_id=p_org_id and actor_id=p_actor_id;if not found then return'{"state":"not_found"}';end if;return decision.result||'{"state":"ready"}';
 end if;
 if read_kind not in('members','member')and not public.team_admin_current(p_org_id,p_actor_id)then return'{"state":"forbidden"}';end if;
 if read_kind='member'then
  if not exists(select 1 from public.profiles where id=(p_input->>'memberId')::uuid and org_id=p_org_id)then return'{"state":"not_found"}';end if;
  member:=public.team_member_view((p_input->>'memberId')::uuid);if member is null then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','orgId',p_org_id,'canManage',public.team_admin_current(p_org_id,p_actor_id),'member',member,'memberHash',public.knowledge_hash(member),'rosterHash',public.knowledge_hash(public.team_roster(p_org_id)));
 elsif read_kind='invitation'then
  select *into invitation from public.team_invitations where id=(p_input->>'invitationId')::uuid and org_id=p_org_id;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','orgId',p_org_id,'invitation',public.team_invitation_view(invitation),'invitationHash',public.team_invitation_hash(invitation));
 elsif read_kind='history_detail'then
  select *into decision from public.team_decisions where id=(p_input->>'decisionId')::uuid and org_id=p_org_id;if not found then return'{"state":"not_found"}';end if;
  return jsonb_build_object('state','ready','orgId',p_org_id,'decision',to_jsonb(decision));
 elsif read_kind='members'then rows:=public.team_roster(p_org_id);
 elsif read_kind='invitations'then select coalesce(jsonb_agg(public.team_invitation_view(i)order by i.created_at desc,i.id),'[]')into rows from public.team_invitations i where i.org_id=p_org_id;
 else select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'actorId',d.actor_id,'targetId',d.target_id,'kind',d.kind,'reason',d.input->>'reason','createdAt',d.created_at)order by d.decision_sequence desc),'[]')into rows from public.team_decisions d where d.org_id=p_org_id;end if;
 total:=jsonb_array_length(rows);row_hash:=public.knowledge_hash(rows);if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from row_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v.value order by n),'[]')into items from jsonb_array_elements(rows)with ordinality v(value,n)where n>off and n<=off+20;
 return jsonb_build_object('state','ready','orgId',p_org_id,'organizationName',(select name from public.organizations where id=p_org_id),'actorId',p_actor_id,'canManage',public.team_admin_current(p_org_id,p_actor_id),'items',items,'total',total,'pageHash',row_hash,'nextOffset',case when off+20<total then off+20 end);
end$$;

create function public.team_join_context(p_actor_id uuid,p_token_hash text)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare invitation public.team_invitations;recipient jsonb;organization jsonb;evidence jsonb;
begin
 if coalesce(p_token_hash,'')!~'^[a-f0-9]{64}$'then return'{"state":"invitation_unavailable"}';end if;
 select *into invitation from public.team_invitations where token_hash=p_token_hash;if not found then return'{"state":"invitation_unavailable"}';end if;
 recipient:=public.team_member_view(p_actor_id);
 if recipient is null or recipient->'accessBlocked'='true'::jsonb or recipient->'emailConfirmed'is distinct from'true'::jsonb then return'{"state":"verified_account_required"}';end if;
 if lower(recipient->>'email')is distinct from invitation.email then return'{"state":"recipient_mismatch"}';end if;
 if invitation.status<>'pending'or invitation.expires_at<=statement_timestamp()then return'{"state":"invitation_unavailable"}';end if;
 if not public.team_admin_current(invitation.org_id,invitation.issuer_id)then return'{"state":"issuer_unavailable"}';end if;
 select jsonb_build_object('id',id,'name',name)into organization from public.organizations where id=invitation.org_id;if organization is null then return'{"state":"invitation_unavailable"}';end if;
 evidence:=jsonb_build_object('invitation',public.team_invitation_view(invitation),'organization',organization,'recipient',recipient);
 return jsonb_build_object('state','ready','orgId',invitation.org_id,'organization',organization,'invitation',public.team_invitation_view(invitation),'recipient',recipient,'invitationHash',public.knowledge_hash(evidence),'canJoin',recipient->'orgId'='null'::jsonb,'alreadyMember',coalesce(recipient->>'orgId'=invitation.org_id::text,false));
end$$;

create function public.read_team_join(p_actor_id uuid,p_token_hash text default null,p_decision_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare decision public.team_decisions;
begin
 if p_decision_id is not null then
  select *into decision from public.team_decisions where id=p_decision_id and actor_id=p_actor_id and kind in('invitation_accepted','invitation_declined','join_cancelled');if not found then return'{"state":"not_found"}';end if;
  return decision.result||jsonb_build_object('state','ready','currentlyMember',exists(select 1 from public.profiles where id=p_actor_id and org_id=decision.org_id));
 end if;
 return public.team_join_context(p_actor_id,p_token_hash);
end$$;

create function public.decide_team_join(p_id uuid,p_actor_id uuid,p_token_hash text,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior public.team_decisions;invitation public.team_invitations;context jsonb;result jsonb;before_value jsonb;after_value jsonb;decision_kind text;operation text:=p_input->>'operation';organization uuid;
begin
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>16384 or p_input-array['operation','reason','invitationHash','confirmed']<>'{}'or operation is null or operation not in('accept','decline')or p_input->'confirmed'is distinct from'true'::jsonb or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 3 and 2000 or coalesce(p_input->>'invitationHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review and confirm the exact invitation';end if;
 -- Resolve the organization before taking the same locks used by administrators.
 select *into prior from public.team_decisions where id=p_id;
 if found then organization:=prior.org_id;else select org_id into organization from public.team_invitations where token_hash=p_token_hash;end if;
 if organization is null then return'{"state":"invitation_unavailable"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(organization::text,937));perform pg_advisory_xact_lock(hashtextextended(p_id::text,938));
 select *into prior from public.team_decisions where id=p_id;
 if found then
  if prior.actor_id=p_actor_id and prior.kind='join_cancelled'then return'{"state":"decision_cancelled"}';end if;
  if prior.actor_id<>p_actor_id or prior.kind not in('invitation_accepted','invitation_declined')or prior.input<>p_input then return'{"state":"request_conflict"}';end if;
  return prior.result||jsonb_build_object('state','replayed','currentlyMember',exists(select 1 from public.profiles where id=p_actor_id and org_id=prior.org_id));
 end if;
 select *into invitation from public.team_invitations where token_hash=p_token_hash and org_id=organization for update;if not found then return'{"state":"invitation_unavailable"}';end if;
 perform 1 from public.profiles where id in(p_actor_id,invitation.issuer_id)order by id for update;
 context:=public.team_join_context(p_actor_id,p_token_hash);if context->>'state'<>'ready'then return context;end if;
 if context->>'invitationHash'is distinct from p_input->>'invitationHash'then return'{"state":"invitation_changed"}';end if;
 if operation='accept'and context->'canJoin'is distinct from'true'::jsonb then return jsonb_build_object('state',case when context->'alreadyMember'='true'::jsonb then'already_member'else'other_organization'end);end if;
 before_value:=jsonb_build_object('invitation',context->'invitation','member',context->'recipient','organization',context->'organization');perform set_config('p11.team_scope',organization::text,true);
 if operation='accept'then
  update public.profiles set org_id=organization,role=invitation.role where id=p_actor_id and org_id is null;if not found then raise exception 'The account membership changed';end if;
  update public.team_invitations set status='accepted',accepted_by=p_actor_id,accepted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()where id=invitation.id returning *into invitation;decision_kind:='invitation_accepted';
 else update public.team_invitations set status='declined',revision=revision+1,updated_at=clock_timestamp()where id=invitation.id returning *into invitation;decision_kind:='invitation_declined';end if;
 update public.team_workspaces set revision=revision+1,updated_at=clock_timestamp()where org_id=organization;
 after_value:=jsonb_build_object('invitation',public.team_invitation_view(invitation),'member',public.team_member_view(p_actor_id),'organization',context->'organization');
 result:=jsonb_build_object('state','saved','orgId',organization,'decisionId',p_id,'targetId',invitation.id,'kind',decision_kind,'membershipGranted',decision_kind='invitation_accepted','emailSent',false);
 insert into public.team_decisions(id,org_id,actor_id,target_id,kind,input,input_hash,before_state,after_state,result)values(p_id,organization,p_actor_id,invitation.id,decision_kind,p_input,public.knowledge_hash(p_input),before_value,after_value,result);
 perform public.append_team_action(p_id);perform set_config('p11.team_scope','',true);return result;
end$$;

revoke all on function public.protect_shared_action_history() from public,anon,authenticated;grant execute on function public.protect_shared_action_history() to service_role;
revoke all on function public.team_member_view(uuid) from public,anon,authenticated;grant execute on function public.team_member_view(uuid) to service_role;
revoke all on function public.team_roster(uuid) from public,anon,authenticated;grant execute on function public.team_roster(uuid) to service_role;
revoke all on function public.team_admin_current(uuid,uuid) from public,anon,authenticated;grant execute on function public.team_admin_current(uuid,uuid) to service_role;
revoke all on function public.team_invitation_view(public.team_invitations) from public,anon,authenticated;grant execute on function public.team_invitation_view(public.team_invitations) to service_role;
revoke all on function public.team_invitation_hash(public.team_invitations) from public,anon,authenticated;grant execute on function public.team_invitation_hash(public.team_invitations) to service_role;
revoke all on function public.guard_team_state() from public,anon,authenticated;grant execute on function public.guard_team_state() to service_role;
revoke all on function public.guard_recorded_membership() from public,anon,authenticated;grant execute on function public.guard_recorded_membership() to service_role;
revoke all on function public.append_team_action(uuid) from public,anon,authenticated;grant execute on function public.append_team_action(uuid) to service_role;
revoke all on function public.decide_team_access(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;grant execute on function public.decide_team_access(uuid,uuid,uuid,jsonb,text) to service_role;
revoke all on function public.read_team_access(uuid,uuid,jsonb) from public,anon,authenticated;grant execute on function public.read_team_access(uuid,uuid,jsonb) to service_role;
revoke all on function public.team_join_context(uuid,text) from public,anon,authenticated;grant execute on function public.team_join_context(uuid,text) to service_role;
revoke all on function public.read_team_join(uuid,text,uuid) from public,anon,authenticated;grant execute on function public.read_team_join(uuid,text,uuid) to service_role;
revoke all on function public.decide_team_join(uuid,uuid,text,jsonb) from public,anon,authenticated;grant execute on function public.decide_team_join(uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';

create function public.report_team_invitation_copy(p_id uuid,p_org_id uuid,p_actor_id uuid,p_source_decision_id uuid,p_outcome text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare source_decision public.team_decisions;prior public.team_decisions;input_value jsonb;before_value jsonb;after_value jsonb;result jsonb;current_link boolean;
begin
 if not public.team_admin_current(p_org_id,p_actor_id)then return'{"state":"forbidden"}';end if;
 if p_id is null or p_source_decision_id is null or p_outcome is null or p_outcome not in('copied','failed')then raise exception 'Report the browser copy outcome';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text,937));perform pg_advisory_xact_lock(hashtextextended(p_id::text,938));
 perform 1 from public.profiles where id=p_actor_id and org_id=p_org_id and role='admin'for share;if not found then return'{"state":"forbidden"}';end if;
 input_value:=jsonb_build_object('operation','report_link_copy','sourceDecisionId',p_source_decision_id,'outcome',p_outcome,'reason','Browser reported invitation-link copy result');
 select *into prior from public.team_decisions where id=p_id;
 if found then
  if(prior.org_id,prior.actor_id,prior.input)is distinct from(p_org_id,p_actor_id,input_value)then return'{"state":"request_conflict"}';end if;return prior.result||'{"state":"replayed"}';
 end if;
 select *into source_decision from public.team_decisions where id=p_source_decision_id and org_id=p_org_id and actor_id=p_actor_id and kind in('invitation_created','invitation_rotated');if not found then return'{"state":"not_found"}';end if;
 select exists(select 1 from public.team_invitations i where i.id=source_decision.target_id and i.revision=(source_decision.after_state->'invitation'->>'revision')::bigint and i.status='pending'and i.expires_at>statement_timestamp()and public.team_admin_current(i.org_id,i.issuer_id))into current_link;
 before_value:=jsonb_build_object('sourceDecisionId',p_source_decision_id,'invitationId',source_decision.target_id,'revision',source_decision.after_state->'invitation'->'revision');after_value:=jsonb_build_object('browserOutcome',p_outcome,'linkStillCurrent',current_link);
 result:=jsonb_build_object('state','saved','orgId',p_org_id,'decisionId',p_id,'targetId',source_decision.target_id,'kind','invitation_copy_reported','copyReported',p_outcome,'linkStillCurrent',current_link,'emailSent',false);
 insert into public.team_decisions(id,org_id,actor_id,target_id,kind,input,input_hash,before_state,after_state,result)values(p_id,p_org_id,p_actor_id,source_decision.target_id,'invitation_copy_reported',input_value,public.knowledge_hash(input_value),before_value,after_value,result);
 perform public.append_team_action(p_id);return result;
end$$;
revoke all on function public.report_team_invitation_copy(uuid,uuid,uuid,uuid,text)from public,anon,authenticated;grant execute on function public.report_team_invitation_copy(uuid,uuid,uuid,uuid,text)to service_role;
notify pgrst,'reload schema';

create function public.cancel_team_join(p_id uuid,p_actor_id uuid,p_token_hash text,p_input_hash text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior public.team_decisions;invitation public.team_invitations;organization uuid;recipient jsonb;input_value jsonb;result jsonb;
begin
 if p_id is null or coalesce(p_input_hash,'')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused invitation request';end if;
 select *into prior from public.team_decisions where id=p_id;
 if found then organization:=prior.org_id;else select org_id into organization from public.team_invitations where token_hash=p_token_hash;end if;
 if organization is null then return'{"state":"invitation_unavailable"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(organization::text,937));perform pg_advisory_xact_lock(hashtextextended(p_id::text,938));
 select *into prior from public.team_decisions where id=p_id;
 if found then
  if prior.actor_id<>p_actor_id or prior.kind not in('invitation_accepted','invitation_declined','join_cancelled')then return'{"state":"request_conflict"}';end if;
  if prior.kind='join_cancelled'and prior.input->>'inputHash'is distinct from p_input_hash then return'{"state":"request_conflict"}';end if;
  return prior.result||jsonb_build_object('state','replayed','currentlyMember',exists(select 1 from public.profiles where id=p_actor_id and org_id=prior.org_id));
 end if;
 select *into invitation from public.team_invitations where token_hash=p_token_hash and org_id=organization;if not found then return'{"state":"invitation_unavailable"}';end if;
 recipient:=public.team_member_view(p_actor_id);if recipient is null or recipient->'emailConfirmed'is distinct from'true'::jsonb or recipient->'accessBlocked'='true'::jsonb or lower(recipient->>'email')is distinct from invitation.email then return'{"state":"recipient_mismatch"}';end if;
 input_value:=jsonb_build_object('operation','cancel_unused','inputHash',p_input_hash,'reason','Recipient cancelled only the unused invitation decision');
 result:=jsonb_build_object('state','saved','orgId',organization,'decisionId',p_id,'targetId',invitation.id,'kind','join_cancelled','cancelled',true,'membershipGranted',false,'emailSent',false);
 insert into public.team_decisions(id,org_id,actor_id,target_id,kind,input,input_hash,before_state,after_state,result)values(p_id,organization,p_actor_id,invitation.id,'join_cancelled',input_value,public.knowledge_hash(input_value),jsonb_build_object('invitation',public.team_invitation_view(invitation)),jsonb_build_object('unusedRequestCancelled',true),result);
 perform public.append_team_action(p_id);return result;
end$$;
revoke all on function public.cancel_team_join(uuid,uuid,text,text)from public,anon,authenticated;grant execute on function public.cancel_team_join(uuid,uuid,text,text)to service_role;
notify pgrst,'reload schema';
