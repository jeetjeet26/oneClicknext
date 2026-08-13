alter table public.siteforge_client_decisions
  add column certification_evidence_id uuid
    references public.siteforge_certification_evidence(id) on delete restrict,
  add column certification_report_hash text,
  add column canonical_url text,
  add column certified_at timestamptz;

alter table public.siteforge_client_decisions
  add constraint siteforge_client_decisions_certification_binding_check
  check (
    (
      certification_evidence_id is null
      and certification_report_hash is null
      and canonical_url is null
      and certified_at is null
    )
    or
    (
      certification_evidence_id is not null
      and certification_report_hash ~ '^[a-f0-9]{64}$'
      and canonical_url ~ '^https://'
      and certified_at is not null
    )
  );

create index siteforge_client_decisions_certification_evidence_idx
  on public.siteforge_client_decisions (certification_evidence_id)
  where certification_evidence_id is not null;
