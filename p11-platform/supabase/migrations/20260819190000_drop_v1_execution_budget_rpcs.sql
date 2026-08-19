-- Drop the superseded v1 execution-budget RPCs. All callers use the _v2
-- functions (utils/services/execution-budget.ts); keeping both invited drift.

drop function if exists public.reserve_shared_execution_budget(
  uuid, integer, bigint, bigint, integer, integer, integer, integer
);

drop function if exists public.settle_shared_execution_budget(
  uuid, integer, integer, bigint, bigint, bigint, bigint
);
