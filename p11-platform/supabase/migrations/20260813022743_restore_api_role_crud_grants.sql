-- Local resets must reproduce the Data API privileges present on the hosted
-- project. RLS remains the authorization boundary for both API roles.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;
grant usage, select on all sequences in schema public
  to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
