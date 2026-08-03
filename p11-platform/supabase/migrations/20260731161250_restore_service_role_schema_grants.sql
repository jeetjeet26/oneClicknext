-- The application service client is the trusted server-side administrative
-- boundary. Ensure a clean local reset reproduces Supabase's service-role
-- privileges instead of relying on hosted-project default grants.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;

-- Operator routes read the caller's own profile through the authenticated
-- client, with profiles_own_read/profiles_own_update enforcing row scope.
grant select, update on public.profiles to authenticated;
