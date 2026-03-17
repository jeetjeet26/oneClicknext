-- Remove same-org profile read policy to eliminate recursive RLS risks.
-- All current app authorization paths rely on own-profile reads plus
-- service-role access for org-wide operations.

drop policy if exists "profiles_org_read" on public.profiles;
drop function if exists public.current_user_org_id();
