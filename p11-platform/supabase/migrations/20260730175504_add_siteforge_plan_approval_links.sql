alter table public.siteforge_plans
  add column if not exists approval_action_attempt_id uuid
    references public.shared_action_attempts(id) on delete set null,
  add column if not exists confirmed_approval_id uuid
    references public.shared_approvals(id) on delete set null,
  add column if not exists decision_reason text;

alter table public.siteforge_plan_versions
  add column if not exists conversation_history jsonb not null default '[]'::jsonb;

create index if not exists siteforge_plans_approval_action_idx
  on public.siteforge_plans (approval_action_attempt_id)
  where approval_action_attempt_id is not null;

comment on column public.siteforge_plans.approval_action_attempt_id is
  'Shared action proposal whose decision controls confirmation of the current plan revision.';

comment on column public.siteforge_plans.confirmed_approval_id is
  'Durable shared approval record that confirmed the immutable plan version.';
