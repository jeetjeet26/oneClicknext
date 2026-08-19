-- Bind ForgeStudio's product-specific revision/publication history to the
-- shared P2 action, approval, policy, and outcome ledger.

alter table public.social_content_revisions
  add column if not exists shared_action_attempt_id uuid
    references public.shared_action_attempts(id) on delete set null;

alter table public.social_publications
  add column if not exists shared_action_attempt_id uuid
    references public.shared_action_attempts(id) on delete set null;

alter table public.social_publication_attempts
  add column if not exists shared_action_attempt_id uuid
    references public.shared_action_attempts(id) on delete set null;

create unique index if not exists social_content_revisions_shared_action_attempt_uidx
  on public.social_content_revisions(shared_action_attempt_id)
  where shared_action_attempt_id is not null;

create unique index if not exists social_publications_shared_action_attempt_uidx
  on public.social_publications(shared_action_attempt_id)
  where shared_action_attempt_id is not null;

create index if not exists social_publication_attempts_shared_action_attempt_idx
  on public.social_publication_attempts(shared_action_attempt_id)
  where shared_action_attempt_id is not null;
