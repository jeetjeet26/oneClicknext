-- Provider secrets are server-only. Safe connection metadata is exposed by the
-- authorized API serializers, never by direct browser access to the secret row.
revoke all on table public.integration_credentials from public, anon, authenticated;
grant select, insert, update, delete on table public.integration_credentials to service_role;

-- Ad links select accounts reachable with the server's shared provider tokens.
-- Browser writes would bypass the platform-operator gate on account linking.
-- Preserve community-scoped reads; mutations go through the authorized server.
revoke all on table public.ad_account_connections from public, anon, authenticated;
grant select on table public.ad_account_connections to authenticated;
grant select, insert, update, delete on table public.ad_account_connections to service_role;
