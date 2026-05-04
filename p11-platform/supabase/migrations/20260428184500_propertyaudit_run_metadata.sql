alter table public.geo_runs
  add column if not exists prompt_source text not null default 'generated',
  add column if not exists access_mode text not null default 'URLOnly',
  add column if not exists measurement_mode text not null default 'natural',
  add column if not exists provider_failure_reason text,
  add column if not exists run_metadata jsonb not null default '{}';

comment on column public.geo_runs.prompt_source is
  'Prompt source for this PropertyAudit run: client, generated, or hybrid.';

comment on column public.geo_runs.access_mode is
  'Client access mode for actionability: URLOnly, CMSOrEditor, or ImplementationPartner.';

comment on column public.geo_runs.measurement_mode is
  'Measurement mode used by the run, such as natural or structured.';

comment on column public.geo_runs.provider_failure_reason is
  'Normalized failure reason for operational reporting, e.g. missing_provider_key or provider_unavailable.';

comment on column public.geo_runs.run_metadata is
  'Additional PropertyAudit runtime metadata such as selected surfaces, dispatch mode, and preflight details.';
