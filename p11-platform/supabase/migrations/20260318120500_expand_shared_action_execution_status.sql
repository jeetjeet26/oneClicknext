alter table public.shared_action_attempts
  drop constraint if exists shared_action_attempts_execution_status_check;

alter table public.shared_action_attempts
  add constraint shared_action_attempts_execution_status_check
  check (
    execution_status in (
      'queued',
      'pending_approval',
      'approved_pending_execution',
      'executing',
      'executed',
      'failed',
      'cancelled',
      'reversed'
    )
  );
