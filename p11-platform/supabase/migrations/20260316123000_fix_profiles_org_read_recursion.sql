-- Fix recursive RLS evaluation on profiles_org_read.
-- The previous policy queried `profiles` from inside a `profiles` policy,
-- which can trigger "infinite recursion detected in policy for relation profiles".

create or replace function public.current_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.org_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

drop policy if exists "profiles_org_read" on public.profiles;
create policy "profiles_org_read" on public.profiles
for select
using (
  auth.role() = 'service_role'
  or org_id = public.current_user_org_id()
);

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_org_read'
      and (
        coalesce(qual, '') ilike '%from profiles%'
        or coalesce(with_check, '') ilike '%from profiles%'
      )
  ) then
    raise exception 'profiles_org_read remains recursive after migration';
  end if;
end
$$;
