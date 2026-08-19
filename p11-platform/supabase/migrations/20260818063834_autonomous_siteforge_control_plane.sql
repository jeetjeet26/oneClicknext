-- Autonomous SiteForge control plane
-- Removes direct authenticated mutations from route-managed website state,
-- records machine policy actors explicitly, and adds transactional execution budgets.

drop policy if exists "Users manage their org property websites"
  on public.property_websites;
drop policy if exists "Users can create websites for their properties"
  on public.property_websites;
drop policy if exists "Users can update their websites"
  on public.property_websites;

revoke insert, update, delete, truncate, references, trigger
  on public.property_websites from authenticated;
revoke all privileges on public.property_websites from anon;
grant select on public.property_websites to authenticated;

drop policy if exists "Users manage their org website assets"
  on public.website_assets;
drop policy if exists "Users can insert assets for their websites"
  on public.website_assets;

revoke insert, update, delete, truncate, references, trigger
  on public.website_assets from authenticated;
revoke all privileges on public.website_assets from anon;
grant select on public.website_assets to authenticated;

drop policy if exists "Users can create jobs for their websites"
  on public.siteforge_jobs;

revoke insert, update, delete, truncate, references, trigger
  on public.siteforge_jobs from authenticated;
revoke all privileges on public.siteforge_jobs from anon;
grant select on public.siteforge_jobs to authenticated;

alter table public.shared_policy_decisions
  add column if not exists actor_type text not null default 'system_policy'
    check (actor_type in ('system_policy', 'owner', 'emergency_operator'));

alter table public.shared_policy_decisions
  add column if not exists source_hash text,
  add column if not exists decided_at timestamptz not null default timezone('utc', now());

alter table public.shared_action_attempts
  add column if not exists model_metadata jsonb not null default '{}'::jsonb,
  add column if not exists deadline_at timestamptz,
  add column if not exists compensation_state text not null default 'not_required'
    check (
      compensation_state in (
        'not_required',
        'available',
        'requested',
        'executing',
        'succeeded',
        'failed'
      )
    );

create table if not exists public.shared_execution_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  website_id uuid references public.property_websites(id) on delete cascade,
  job_id uuid references public.shared_jobs(id) on delete cascade,
  policy_version text not null,
  status text not null default 'active'
    check (status in ('active', 'exhausted', 'closed', 'cancelled')),
  max_cost_cents integer not null default 80000 check (max_cost_cents >= 0),
  reserved_cost_cents integer not null default 0 check (reserved_cost_cents >= 0),
  used_cost_cents integer not null default 0 check (used_cost_cents >= 0),
  max_input_tokens bigint not null default 2000000 check (max_input_tokens >= 0),
  reserved_input_tokens bigint not null default 0 check (reserved_input_tokens >= 0),
  used_input_tokens bigint not null default 0 check (used_input_tokens >= 0),
  max_output_tokens bigint not null default 500000 check (max_output_tokens >= 0),
  reserved_output_tokens bigint not null default 0 check (reserved_output_tokens >= 0),
  used_output_tokens bigint not null default 0 check (used_output_tokens >= 0),
  max_model_attempts integer not null default 40 check (max_model_attempts >= 0),
  used_model_attempts integer not null default 0 check (used_model_attempts >= 0),
  max_browser_runs integer not null default 12 check (max_browser_runs >= 0),
  used_browser_runs integer not null default 0 check (used_browser_runs >= 0),
  max_provider_calls integer not null default 100 check (max_provider_calls >= 0),
  used_provider_calls integer not null default 0 check (used_provider_calls >= 0),
  max_repair_operations integer not null default 24 check (max_repair_operations >= 0),
  used_repair_operations integer not null default 0 check (used_repair_operations >= 0),
  max_wall_seconds integer not null default 21600 check (max_wall_seconds >= 0),
  started_at timestamptz not null default timezone('utc', now()),
  deadline_at timestamptz,
  model_policy jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (job_id),
  check (reserved_cost_cents + used_cost_cents <= max_cost_cents),
  check (reserved_input_tokens + used_input_tokens <= max_input_tokens),
  check (reserved_output_tokens + used_output_tokens <= max_output_tokens),
  check (used_model_attempts <= max_model_attempts),
  check (used_browser_runs <= max_browser_runs),
  check (used_provider_calls <= max_provider_calls),
  check (used_repair_operations <= max_repair_operations)
);

create index if not exists shared_execution_budgets_org_status_idx
  on public.shared_execution_budgets (org_id, status, created_at desc);
create index if not exists shared_execution_budgets_website_created_idx
  on public.shared_execution_budgets (website_id, created_at desc)
  where website_id is not null;

alter table public.shared_execution_budgets enable row level security;

drop policy if exists "Service role manages shared_execution_budgets"
  on public.shared_execution_budgets;
create policy "Service role manages shared_execution_budgets"
  on public.shared_execution_budgets
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all privileges on public.shared_execution_budgets from anon, authenticated;
grant all privileges on public.shared_execution_budgets to service_role;

create or replace function public.reserve_shared_execution_budget(
  p_budget_id uuid,
  p_cost_cents integer default 0,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0,
  p_model_attempts integer default 0,
  p_browser_runs integer default 0,
  p_provider_calls integer default 0,
  p_repair_operations integer default 0
)
returns public.shared_execution_budgets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated public.shared_execution_budgets;
begin
  if least(
    p_cost_cents,
    p_input_tokens,
    p_output_tokens,
    p_model_attempts,
    p_browser_runs,
    p_provider_calls,
    p_repair_operations
  ) < 0 then
    raise exception 'Budget reservations cannot be negative';
  end if;

  update public.shared_execution_budgets
  set
    reserved_cost_cents = reserved_cost_cents + p_cost_cents,
    reserved_input_tokens = reserved_input_tokens + p_input_tokens,
    reserved_output_tokens = reserved_output_tokens + p_output_tokens,
    used_model_attempts = used_model_attempts + p_model_attempts,
    used_browser_runs = used_browser_runs + p_browser_runs,
    used_provider_calls = used_provider_calls + p_provider_calls,
    used_repair_operations = used_repair_operations + p_repair_operations,
    updated_at = timezone('utc', now())
  where id = p_budget_id
    and status = 'active'
    and (deadline_at is null or deadline_at > timezone('utc', now()))
    and reserved_cost_cents + used_cost_cents + p_cost_cents <= max_cost_cents
    and reserved_input_tokens + used_input_tokens + p_input_tokens <= max_input_tokens
    and reserved_output_tokens + used_output_tokens + p_output_tokens <= max_output_tokens
    and used_model_attempts + p_model_attempts <= max_model_attempts
    and used_browser_runs + p_browser_runs <= max_browser_runs
    and used_provider_calls + p_provider_calls <= max_provider_calls
    and used_repair_operations + p_repair_operations <= max_repair_operations
  returning * into updated;

  if updated.id is null then
    raise exception 'Execution budget is exhausted, inactive, expired, or missing';
  end if;
  return updated;
end;
$$;

revoke all on function public.reserve_shared_execution_budget(
  uuid, integer, bigint, bigint, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_shared_execution_budget(
  uuid, integer, bigint, bigint, integer, integer, integer, integer
) to service_role;

create or replace function public.settle_shared_execution_budget(
  p_budget_id uuid,
  p_reserved_cost_cents integer default 0,
  p_used_cost_cents integer default 0,
  p_reserved_input_tokens bigint default 0,
  p_used_input_tokens bigint default 0,
  p_reserved_output_tokens bigint default 0,
  p_used_output_tokens bigint default 0
)
returns public.shared_execution_budgets
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated public.shared_execution_budgets;
begin
  if least(
    p_reserved_cost_cents,
    p_used_cost_cents,
    p_reserved_input_tokens,
    p_used_input_tokens,
    p_reserved_output_tokens,
    p_used_output_tokens
  ) < 0 then
    raise exception 'Budget settlements cannot be negative';
  end if;

  update public.shared_execution_budgets
  set
    reserved_cost_cents = reserved_cost_cents - p_reserved_cost_cents,
    used_cost_cents = used_cost_cents + p_used_cost_cents,
    reserved_input_tokens = reserved_input_tokens - p_reserved_input_tokens,
    used_input_tokens = used_input_tokens + p_used_input_tokens,
    reserved_output_tokens = reserved_output_tokens - p_reserved_output_tokens,
    used_output_tokens = used_output_tokens + p_used_output_tokens,
    updated_at = timezone('utc', now())
  where id = p_budget_id
    and reserved_cost_cents >= p_reserved_cost_cents
    and reserved_input_tokens >= p_reserved_input_tokens
    and reserved_output_tokens >= p_reserved_output_tokens
    and used_cost_cents + p_used_cost_cents <= max_cost_cents
    and used_input_tokens + p_used_input_tokens <= max_input_tokens
    and used_output_tokens + p_used_output_tokens <= max_output_tokens
  returning * into updated;

  if updated.id is null then
    raise exception 'Execution budget settlement is invalid or exceeds limits';
  end if;
  return updated;
end;
$$;

revoke all on function public.settle_shared_execution_budget(
  uuid, integer, integer, bigint, bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.settle_shared_execution_budget(
  uuid, integer, integer, bigint, bigint, bigint, bigint
) to service_role;
