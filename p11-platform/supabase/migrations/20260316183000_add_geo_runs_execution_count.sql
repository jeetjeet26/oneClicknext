alter table public.geo_runs
  add column if not exists execution_count integer;

update public.geo_runs
set execution_count = 1
where execution_count is null;

alter table public.geo_runs
  alter column execution_count set default 1;

alter table public.geo_runs
  alter column execution_count set not null;

comment on column public.geo_runs.execution_count is
  'How many independent executions to run for each query in this PropertyAudit run.';
