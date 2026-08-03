do $$
declare
  v_website record;
  v_secret_id uuid;
begin
  for v_website in
    select id, wp_credentials
    from public.property_websites
    where wp_credentials is not null
      and wordpress_credential_ref is null
  loop
    select vault.create_secret(
      v_website.wp_credentials::text,
      'siteforge-legacy-' || v_website.id::text || '-' || gen_random_uuid()::text,
      'Migrated legacy SiteForge WordPress credential'
    )
    into v_secret_id;

    update public.property_websites
    set wordpress_credential_ref = 'supabase-vault:' || v_secret_id::text
    where id = v_website.id;
  end loop;
end
$$;

update public.property_websites
set wp_credentials = null
where wp_credentials is not null;

comment on column public.property_websites.wp_credentials is
  'Deprecated compatibility column. Must remain null; use wordpress_credential_ref backed by Supabase Vault.';
