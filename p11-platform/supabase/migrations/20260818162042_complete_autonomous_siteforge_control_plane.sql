-- Finish service-only SiteForge writes and idempotent autonomous budget events.

drop policy if exists "Users can create blueprint versions for their websites"
  on public.siteforge_blueprint_versions;
revoke insert, update, delete, truncate, references, trigger
  on public.siteforge_blueprint_versions from authenticated;
revoke all privileges on public.siteforge_blueprint_versions from anon;
grant select on public.siteforge_blueprint_versions to authenticated;

drop policy if exists "Managers decide SiteForge runtime extension requests"
  on public.siteforge_runtime_extension_requests;
revoke insert, update, delete, truncate, references, trigger
  on public.siteforge_runtime_extension_requests from authenticated;
revoke all privileges on public.siteforge_runtime_extension_requests from anon;
grant select on public.siteforge_runtime_extension_requests to authenticated;

alter table public.shared_policy_decisions
  alter column actor_type set default 'legacy';

alter table public.shared_policy_decisions
  drop constraint if exists shared_policy_decisions_actor_type_check;
alter table public.shared_policy_decisions
  add constraint shared_policy_decisions_actor_type_check
  check (
    actor_type in (
      'legacy',
      'system_policy',
      'owner',
      'emergency_operator'
    )
  );

update public.shared_policy_decisions
set actor_type = 'legacy'
where actor_type = 'system_policy'
  and source_hash is null;

alter table public.shared_policy_decisions
  add column if not exists enforcement_outcome text
    check (
      enforcement_outcome in ('allow', 'deny', 'require_approval')
    ),
  add column if not exists evaluator text;

alter table public.shared_policy_decisions
  drop constraint if exists shared_policy_decisions_source_hash_check;
alter table public.shared_policy_decisions
  add constraint shared_policy_decisions_source_hash_check
  check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$');

create unique index if not exists
  shared_policy_decisions_system_idempotency_idx
on public.shared_policy_decisions (
  action_attempt_id,
  policy_name,
  policy_version,
  source_hash
)
where actor_type = 'system_policy'
  and source_hash is not null;

create table if not exists public.shared_execution_budget_events (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null
    references public.shared_execution_budgets(id) on delete cascade,
  event_type text not null
    check (event_type in ('reserve', 'settle', 'release', 'close')),
  idempotency_key text not null,
  usage_delta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (budget_id, event_type, idempotency_key)
);

create index if not exists shared_execution_budget_events_budget_created_idx
  on public.shared_execution_budget_events (budget_id, created_at desc);

alter table public.shared_execution_budget_events enable row level security;
create policy "Service role manages shared_execution_budget_events"
  on public.shared_execution_budget_events for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
revoke all privileges on public.shared_execution_budget_events
  from anon, authenticated;
grant all privileges on public.shared_execution_budget_events to service_role;

create or replace function public.reserve_shared_execution_budget_v2(
  p_budget_id uuid,
  p_idempotency_key text,
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
  event_id uuid;
  updated public.shared_execution_budgets;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Budget idempotency key is required';
  end if;
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

  insert into public.shared_execution_budget_events (
    budget_id,
    event_type,
    idempotency_key,
    usage_delta
  )
  values (
    p_budget_id,
    'reserve',
    p_idempotency_key,
    jsonb_build_object(
      'costCents', p_cost_cents,
      'inputTokens', p_input_tokens,
      'outputTokens', p_output_tokens,
      'modelAttempts', p_model_attempts,
      'browserRuns', p_browser_runs,
      'providerCalls', p_provider_calls,
      'repairOperations', p_repair_operations
    )
  )
  on conflict (budget_id, event_type, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select * into updated
    from public.shared_execution_budgets
    where id = p_budget_id;
    if updated.id is null then
      raise exception 'Execution budget is missing';
    end if;
    return updated;
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
    delete from public.shared_execution_budget_events where id = event_id;
    raise exception 'Execution budget is exhausted, inactive, expired, or missing';
  end if;
  return updated;
end;
$$;

revoke all on function public.reserve_shared_execution_budget_v2(
  uuid, text, integer, bigint, bigint, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.reserve_shared_execution_budget_v2(
  uuid, text, integer, bigint, bigint, integer, integer, integer, integer
) to service_role;

create or replace function public.settle_shared_execution_budget_v2(
  p_budget_id uuid,
  p_idempotency_key text,
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
  event_id uuid;
  updated public.shared_execution_budgets;
begin
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Budget idempotency key is required';
  end if;
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

  insert into public.shared_execution_budget_events (
    budget_id,
    event_type,
    idempotency_key,
    usage_delta
  )
  values (
    p_budget_id,
    'settle',
    p_idempotency_key,
    jsonb_build_object(
      'reservedCostCents', p_reserved_cost_cents,
      'usedCostCents', p_used_cost_cents,
      'reservedInputTokens', p_reserved_input_tokens,
      'usedInputTokens', p_used_input_tokens,
      'reservedOutputTokens', p_reserved_output_tokens,
      'usedOutputTokens', p_used_output_tokens
    )
  )
  on conflict (budget_id, event_type, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select * into updated
    from public.shared_execution_budgets
    where id = p_budget_id;
    if updated.id is null then
      raise exception 'Execution budget is missing';
    end if;
    return updated;
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
    delete from public.shared_execution_budget_events where id = event_id;
    raise exception 'Execution budget settlement is invalid or exceeds limits';
  end if;
  return updated;
end;
$$;

revoke all on function public.settle_shared_execution_budget_v2(
  uuid, text, integer, integer, bigint, bigint, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.settle_shared_execution_budget_v2(
  uuid, text, integer, integer, bigint, bigint, bigint, bigint
) to service_role;
