-- Recorded organization and personal console settings. Provider credentials are not settings payloads.
create table public.account_settings_workspaces(org_id uuid primary key references public.organizations(id)on delete cascade,revision bigint not null default 1,created_at timestamptz not null default clock_timestamp());
create table public.account_profile_workspaces(actor_id uuid primary key references public.profiles(id)on delete cascade,profile_recorded boolean not null default false,preferences_recorded boolean not null default false,updated_at timestamptz not null default clock_timestamp());
create table public.account_settings_decisions(id uuid primary key,org_id uuid not null references public.organizations(id)on delete cascade,actor_id uuid not null references public.profiles(id),kind text not null check(kind in('organization_saved','profile_saved','preferences_saved','cancelled')),section text not null check(section in('organization','personal')),input jsonb not null,input_hash text not null,before_state jsonb not null,after_state jsonb not null,result jsonb not null,decision_sequence bigint generated always as identity unique,created_at timestamptz not null default clock_timestamp());
create index account_settings_history on public.account_settings_decisions(org_id,section,decision_sequence desc);
create index account_personal_history on public.account_settings_decisions(actor_id,decision_sequence desc);
alter table public.account_settings_workspaces enable row level security;
alter table public.account_profile_workspaces enable row level security;
alter table public.account_settings_decisions enable row level security;
revoke all on public.account_settings_workspaces,public.account_profile_workspaces,public.account_settings_decisions from anon,authenticated;
grant all on public.account_settings_workspaces,public.account_profile_workspaces,public.account_settings_decisions to service_role;
grant usage,select on sequence public.account_settings_decisions_decision_sequence_seq to service_role;

create function public.account_organization_source(p_org_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('name',o.name,'timezone',o.settings->'timezone')from public.organizations o where o.id=p_org_id
$$;
create function public.account_personal_source(p_actor_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('fullName',p.full_name,'theme',p.preferences->'theme','accentColor',p.preferences->'accent_color')from public.profiles p where p.id=p_actor_id
$$;
create function public.account_actor_current(p_actor_id uuid,p_org_id uuid)returns boolean language sql stable security invoker set search_path=''as $$
 select coalesce(public.team_member_view(p_actor_id)->>'orgId'=p_org_id::text and public.team_member_view(p_actor_id)->'emailConfirmed'='true'::jsonb and public.team_member_view(p_actor_id)->'accessBlocked'='false'::jsonb,false)
$$;
create function public.guard_account_settings_history()returns trigger language plpgsql security invoker set search_path=''as $$
declare organization uuid;actor uuid;
begin
 if tg_table_name='account_profile_workspaces'then
  actor:=case when tg_op='DELETE'then old.actor_id else new.actor_id end;
  if tg_op='DELETE'and not exists(select 1 from public.profiles where id=actor)then return old;end if;
  if tg_op='DELETE'or current_setting('p11.account_actor',true)is distinct from actor::text then raise exception 'Use a recorded personal settings decision';end if;
  if tg_op='UPDATE'and new.actor_id<>old.actor_id then raise exception 'Personal settings identity is immutable';end if;
  return new;
 end if;
 organization:=case when tg_op='DELETE'then old.org_id else new.org_id end;
 if tg_op='DELETE'and not exists(select 1 from public.organizations where id=organization)then return old;end if;
 if tg_table_name='account_settings_decisions'then raise exception 'Account settings decisions are immutable';end if;
 if tg_op='DELETE'or current_setting('p11.account_scope',true)is distinct from organization::text then raise exception 'Use a recorded organization settings decision';end if;
 if tg_op='UPDATE'and new.org_id<>old.org_id then raise exception 'Organization settings identity is immutable';end if;
 return new;
end$$;
create trigger account_settings_decisions_immutable before update or delete on public.account_settings_decisions for each row execute function public.guard_account_settings_history();
create trigger account_settings_workspace_guard before insert or update or delete on public.account_settings_workspaces for each row execute function public.guard_account_settings_history();
create trigger account_profile_workspace_guard before insert or update or delete on public.account_profile_workspaces for each row execute function public.guard_account_settings_history();
create function public.guard_recorded_account_fields()returns trigger language plpgsql security definer set search_path=''as $$
declare workspace public.account_profile_workspaces;
begin
 if tg_table_name='organizations'then
  if(new.name,new.settings->'timezone')is distinct from(old.name,old.settings->'timezone')and exists(select 1 from public.account_settings_workspaces where org_id=old.id)and current_setting('p11.account_scope',true)is distinct from old.id::text then raise exception 'Use a recorded organization settings decision';end if;
 else
  select *into workspace from public.account_profile_workspaces where actor_id=old.id;
  if found and current_setting('p11.account_actor',true)is distinct from old.id::text then
   if workspace.profile_recorded and new.full_name is distinct from old.full_name then raise exception 'Use a recorded profile decision';end if;
   if workspace.preferences_recorded and(new.preferences->'theme',new.preferences->'accent_color')is distinct from(old.preferences->'theme',old.preferences->'accent_color')then raise exception 'Use a recorded appearance decision';end if;
  end if;
 end if;return new;
end$$;
create trigger recorded_organization_settings before update on public.organizations for each row execute function public.guard_recorded_account_fields();
create trigger recorded_personal_settings before update on public.profiles for each row execute function public.guard_recorded_account_fields();
-- Auth updates preserve first-time signup metadata; adopted console names have a recorded owner.
create or replace function public.handle_user_update()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from public.account_profile_workspaces where actor_id=new.id and profile_recorded)then
  update public.profiles set full_name=coalesce(new.raw_user_meta_data->>'full_name',full_name)where id=new.id;
 end if;return new;
end$$;

create function public.append_account_settings_action(p_id uuid)returns void language plpgsql security invoker set search_path=''as $$
declare decision public.account_settings_decisions;event public.shared_action_events;action_name text;
begin
 select *into decision from public.account_settings_decisions where id=p_id;if not found then raise exception 'Retained settings decision required';end if;action_name:='settings.'||decision.kind;
 select *into event from public.shared_action_events where id=p_id;
 if found then
  if(event.org_id,event.property_id,event.actor_id,event.product,event.action,event.request)is distinct from(decision.org_id,null::uuid,decision.actor_id,'settings'::text,action_name,jsonb_build_object('decisionId',decision.id,'inputHash',decision.input_hash))then raise exception 'Settings action identity conflict';end if;return;
 end if;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_id,decision.org_id,null,decision.actor_id,'console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result)values(p_id,p_id,decision.org_id,null,decision.actor_id,'settings',action_name,'server_confirmed','succeeded',jsonb_build_object('decisionId',p_id,'inputHash',decision.input_hash),jsonb_build_object('hash',public.knowledge_hash(decision.before_state)),jsonb_build_object('hash',public.knowledge_hash(decision.after_state)),decision.result);
end$$;

create function public.decide_account_settings(p_id uuid,p_org_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare operation text:=p_input->>'operation';section_value text:=p_input->>'section';prior public.account_settings_decisions;kind_value text;before_value jsonb;after_value jsonb;source_hash text;result jsonb;profile public.profiles;name_value text;timezone_value text;theme_value text;accent_value text;
begin
 if not public.account_actor_current(p_actor_id,p_org_id)then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or octet_length(p_input::text)>16384 or jsonb_typeof(p_input->'reason')is distinct from'string'or length(btrim(p_input->>'reason'))not between 3 and 2000 or operation is null or operation not in('save_organization','save_profile','save_preferences','cancel_unused')or section_value is null or section_value not in('organization','personal')then raise exception 'Review the settings decision';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text,937));perform pg_advisory_xact_lock(hashtextextended(p_id::text,939));
 select *into profile from public.profiles where id=p_actor_id and org_id=p_org_id for update;if not found or not public.account_actor_current(p_actor_id,p_org_id)then return'{"state":"forbidden"}';end if;
 select *into prior from public.account_settings_decisions where id=p_id;
 if found then
  if(prior.org_id,prior.actor_id,prior.section)is distinct from(p_org_id,p_actor_id,section_value)then return'{"state":"request_conflict"}';end if;
  if prior.kind='cancelled'and operation<>'cancel_unused'then return'{"state":"decision_cancelled"}';end if;
  if(operation<>'cancel_unused'or prior.kind='cancelled')and prior.input<>p_input then return'{"state":"request_conflict"}';end if;
  return prior.result||'{"state":"replayed"}';
 end if;
 if section_value='organization'and coalesce(profile.role,'')not in('admin','manager')then return'{"state":"forbidden"}';end if;
 if(operation='save_organization'and section_value<>'organization')or(operation in('save_profile','save_preferences')and section_value<>'personal')then raise exception 'Choose the matching settings section';end if;
 if operation='cancel_unused'then
  if p_input-array['operation','section','inputHash','reason']<>'{}'or coalesce(p_input->>'inputHash','')!~'^[a-f0-9]{64}$'then raise exception 'Review the unused settings request';end if;kind_value:='cancelled';before_value:='{}';after_value:='{}';
 else
  if p_input->'confirmed'is distinct from'true'::jsonb or coalesce(p_input->>'sourceHash','')!~'^[a-f0-9]{64}$'then raise exception 'Confirm the exact saved settings';end if;
  if section_value='organization'then
   perform 1 from public.organizations where id=p_org_id for update;before_value:=public.account_organization_source(p_org_id);
  else before_value:=public.account_personal_source(p_actor_id);end if;
  source_hash:=public.knowledge_hash(before_value);if source_hash is distinct from p_input->>'sourceHash'then return'{"state":"settings_changed"}';end if;
  perform set_config('p11.account_scope',p_org_id::text,true);perform set_config('p11.account_actor',p_actor_id::text,true);
  if operation='save_organization'then
   if p_input-array['operation','section','sourceHash','confirmed','reason','name','timezone']<>'{}'or jsonb_typeof(p_input->'name')is distinct from'string'or length(btrim(p_input->>'name'))not between 2 and 120 or jsonb_typeof(p_input->'timezone')is distinct from'string'or not exists(select 1 from pg_timezone_names where name=p_input->>'timezone')then raise exception 'Supply an organization name and recognized time zone';end if;
   name_value:=btrim(p_input->>'name');timezone_value:=p_input->>'timezone';
   update public.organizations set name=name_value,settings=case when jsonb_typeof(settings)='object'then settings else'{}'end||jsonb_build_object('timezone',timezone_value)where id=p_org_id;
   insert into public.account_settings_workspaces(org_id)values(p_org_id)on conflict(org_id)do update set revision=public.account_settings_workspaces.revision+1;
   kind_value:='organization_saved';after_value:=public.account_organization_source(p_org_id);
  elsif operation='save_profile'then
   if p_input-array['operation','section','sourceHash','confirmed','reason','fullName']<>'{}'or jsonb_typeof(p_input->'fullName')is distinct from'string'or length(btrim(p_input->>'fullName'))not between 1 and 120 then raise exception 'Supply the reviewed display name';end if;
   update public.profiles set full_name=btrim(p_input->>'fullName')where id=p_actor_id;
   insert into public.account_profile_workspaces(actor_id,profile_recorded)values(p_actor_id,true)on conflict(actor_id)do update set profile_recorded=true,updated_at=clock_timestamp();
   kind_value:='profile_saved';after_value:=public.account_personal_source(p_actor_id);
  else
   theme_value:=p_input->>'theme';accent_value:=p_input->>'accentColor';
   if p_input-array['operation','section','sourceHash','confirmed','reason','theme','accentColor']<>'{}'or theme_value is null or theme_value not in('light','dark','system')or accent_value is null or accent_value not in('indigo','purple','blue','emerald')then raise exception 'Choose supported console appearance';end if;
   update public.profiles set preferences=case when jsonb_typeof(preferences)='object'then preferences else'{}'end||jsonb_build_object('theme',theme_value,'accent_color',accent_value)where id=p_actor_id;
   insert into public.account_profile_workspaces(actor_id,preferences_recorded)values(p_actor_id,true)on conflict(actor_id)do update set preferences_recorded=true,updated_at=clock_timestamp();
   kind_value:='preferences_saved';after_value:=public.account_personal_source(p_actor_id);
  end if;
 end if;
 result:=jsonb_build_object('state','saved','orgId',p_org_id,'actorId',p_actor_id,'decisionId',p_id,'kind',kind_value,'section',section_value,'sourceHash',public.knowledge_hash(after_value),'cancelled',kind_value='cancelled');
 insert into public.account_settings_decisions(id,org_id,actor_id,kind,section,input,input_hash,before_state,after_state,result)values(p_id,p_org_id,p_actor_id,kind_value,section_value,p_input,public.knowledge_hash(p_input),before_value,after_value,result);
 perform public.append_account_settings_action(p_id);perform set_config('p11.account_scope','',true);perform set_config('p11.account_actor','',true);return result;
end$$;

create function public.read_account_settings(p_actor_id uuid,p_org_id uuid,p_input jsonb default'{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare read_kind text:=coalesce(p_input->>'kind','current');section_value text:=coalesce(p_input->>'section','personal');off integer:=coalesce((p_input->>'offset')::integer,0);decision public.account_settings_decisions;organization jsonb;personal jsonb;rows jsonb;items jsonb;row_hash text;total integer;profile public.profiles;
begin
 if not public.account_actor_current(p_actor_id,p_org_id)then return'{"state":"forbidden"}';end if;
 if jsonb_typeof(p_input)is distinct from'object'or p_input-array['kind','section','offset','expectedHash','decisionId']<>'{}'or read_kind not in('current','history','detail','decision')or section_value not in('organization','personal')or off not between 0 and 1000000 then raise exception 'Choose saved account settings';end if;
 select *into profile from public.profiles where id=p_actor_id and org_id=p_org_id;
 if read_kind='current'then
  organization:=public.account_organization_source(p_org_id);personal:=public.account_personal_source(p_actor_id);
  return jsonb_build_object('state','ready','orgId',p_org_id,'actorId',p_actor_id,'canManageOrganization',coalesce(profile.role,'')in('admin','manager'),'organization',organization,'organizationHash',public.knowledge_hash(organization),'personal',personal,'personalHash',public.knowledge_hash(personal),'email',public.team_member_view(p_actor_id)->'email','role',profile.role,'subscriptionTier',(select subscription_tier from public.organizations where id=p_org_id));
 elsif read_kind in('detail','decision')then
  select *into decision from public.account_settings_decisions where id=(p_input->>'decisionId')::uuid and org_id=p_org_id and section=section_value and(section='organization'or actor_id=p_actor_id)and(read_kind='detail'or actor_id=p_actor_id);if not found then return'{"state":"not_found"}';end if;
  if read_kind='decision'then return decision.result||'{"state":"ready"}';end if;
  return jsonb_build_object('state','ready','orgId',p_org_id,'actorId',p_actor_id,'decision',to_jsonb(decision));
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'actorId',d.actor_id,'kind',d.kind,'section',d.section,'reason',d.input->>'reason','createdAt',d.created_at)order by d.decision_sequence desc),'[]')into rows from public.account_settings_decisions d where d.org_id=p_org_id and d.section=section_value and(section_value='organization'or d.actor_id=p_actor_id);
 total:=jsonb_array_length(rows);row_hash:=public.knowledge_hash(rows);if p_input?'expectedHash'and p_input->>'expectedHash'is distinct from row_hash then return'{"state":"history_changed"}';end if;
 select coalesce(jsonb_agg(v.value order by n),'[]')into items from jsonb_array_elements(rows)with ordinality v(value,n)where n>off and n<=off+20;
 return jsonb_build_object('state','ready','orgId',p_org_id,'actorId',p_actor_id,'section',section_value,'items',items,'total',total,'pageHash',row_hash,'nextOffset',case when off+20<total then off+20 end);
end$$;

revoke all on function public.account_organization_source(uuid)from public,anon,authenticated;grant execute on function public.account_organization_source(uuid)to service_role;
revoke all on function public.account_personal_source(uuid)from public,anon,authenticated;grant execute on function public.account_personal_source(uuid)to service_role;
revoke all on function public.account_actor_current(uuid,uuid)from public,anon,authenticated;grant execute on function public.account_actor_current(uuid,uuid)to service_role;
revoke all on function public.guard_account_settings_history()from public,anon,authenticated;grant execute on function public.guard_account_settings_history()to service_role;
revoke all on function public.guard_recorded_account_fields()from public,anon,authenticated;grant execute on function public.guard_recorded_account_fields()to service_role;
revoke all on function public.handle_user_update()from public,anon,authenticated;grant execute on function public.handle_user_update()to service_role;
revoke all on function public.append_account_settings_action(uuid)from public,anon,authenticated;grant execute on function public.append_account_settings_action(uuid)to service_role;
revoke all on function public.decide_account_settings(uuid,uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.decide_account_settings(uuid,uuid,uuid,jsonb)to service_role;
revoke all on function public.read_account_settings(uuid,uuid,jsonb)from public,anon,authenticated;grant execute on function public.read_account_settings(uuid,uuid,jsonb)to service_role;
notify pgrst,'reload schema';
