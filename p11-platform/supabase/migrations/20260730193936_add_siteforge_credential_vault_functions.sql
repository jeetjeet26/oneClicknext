create extension if not exists supabase_vault with schema vault;

create or replace function public.store_siteforge_credential_secret(
  p_secret text,
  p_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  if length(coalesce(p_secret, '')) < 10 then
    raise exception 'Credential secret is empty or invalid';
  end if;
  select vault.create_secret(
    p_secret,
    'siteforge-' || p_name || '-' || gen_random_uuid()::text,
    p_description
  )
  into v_secret_id;
  return v_secret_id;
end;
$$;

create or replace function public.get_siteforge_credential_secret(
  p_secret_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;
  select decrypted_secret
  into v_secret
  from vault.decrypted_secrets
  where id = p_secret_id;
  if v_secret is null then
    raise exception 'SiteForge credential secret not found';
  end if;
  return v_secret;
end;
$$;

revoke all on function public.store_siteforge_credential_secret(text, text, text) from public, anon, authenticated;
revoke all on function public.get_siteforge_credential_secret(uuid) from public, anon, authenticated;
grant execute on function public.store_siteforge_credential_secret(text, text, text) to service_role;
grant execute on function public.get_siteforge_credential_secret(uuid) to service_role;

comment on function public.store_siteforge_credential_secret is
  'Stores encrypted SiteForge deployment credentials in Supabase Vault and returns only an opaque reference.';
