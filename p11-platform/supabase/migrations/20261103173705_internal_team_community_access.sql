-- Confirmed internal staff receive access when a community is created.
-- The internal_team_member marker lives in administrator-controlled app metadata.
create or replace function public.brain_grant_property_creator()
returns trigger language plpgsql security definer set search_path='' as $$
declare member record; grant_state jsonb;
begin
 if not exists(select 1 from public.profiles p where p.id=new.actor_id and p.org_id=new.org_id and p.role in('admin','manager'))then raise insufficient_privilege;end if;
 for member in
  select p.id from public.profiles p join auth.users u on u.id=p.id
  where p.org_id=new.org_id and (
   p.id=new.actor_id or (
    p.role in('admin','manager') and u.raw_app_meta_data->>'internal_team_member'='true'
    and coalesce(u.raw_app_meta_data->>'community_worker','false')<>'true'
    and u.email_confirmed_at is not null and u.deleted_at is null
    and(u.banned_until is null or u.banned_until<=statement_timestamp())
    and not exists(select 1 from public.client_portal_accounts c where c.user_id=p.id)
   )
  ) order by p.id
 loop
  insert into public.community_access_grants(actor_id,property_id,capabilities,granted_by)
  values(member.id,new.property_id,array['read','manage','generate','portfolio','download'],new.actor_id)
  on conflict(actor_id,property_id)do nothing
  returning to_jsonb(community_access_grants.*)into grant_state;
  if found then
   insert into public.community_access_events(actor_id,property_id,target_actor_id,after_state,reason)
   values(new.actor_id,new.property_id,member.id,grant_state,
    case when member.id=new.actor_id then 'Native property creation' else 'Automatic access for confirmed internal team member on community creation' end);
  end if;
 end loop;
 return new;
end$$;
revoke all on function public.brain_grant_property_creator() from public,anon,authenticated;
grant execute on function public.brain_grant_property_creator() to service_role;
