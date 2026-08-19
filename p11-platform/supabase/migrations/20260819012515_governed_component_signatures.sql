alter table public.siteforge_component_versions
  add column signature text,
  add column signature_algorithm text,
  add column signing_key_id text;

alter table public.siteforge_component_versions
  add constraint siteforge_component_versions_signature_identity_check
  check (
    signature ~ '^[a-f0-9]{64}$'
    and signature_algorithm = 'hmac-sha256'
    and nullif(btrim(signing_key_id), '') is not null
  );

comment on column public.siteforge_component_versions.signature is
  'HMAC-SHA256 signature over the immutable governed component package identity.';
comment on column public.siteforge_component_versions.signing_key_id is
  'Operator-controlled signing-key identity used to verify package provenance.';
