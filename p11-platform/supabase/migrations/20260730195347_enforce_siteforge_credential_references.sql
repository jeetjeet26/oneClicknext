alter table public.property_websites
  drop constraint if exists property_websites_no_plaintext_wp_credentials;

alter table public.property_websites
  add constraint property_websites_no_plaintext_wp_credentials
  check (wp_credentials is null);
