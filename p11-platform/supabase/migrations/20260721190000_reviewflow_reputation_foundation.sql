-- ReviewFlow reputation-to-operations foundation.
--
-- 1. Reconciles migration replay truth with the live schema for review tables.
-- 2. Adds source-truth/provenance metadata to reviews.
-- 3. Adds governance columns to review_responses (shared action linkage,
--    decision rationale, deterministic active-response ordering, provider
--    execution evidence that replaces posting-audit tickets).
-- 4. Introduces versioned review intelligence (review_analyses).
-- 5. Introduces first-class reputation cases + immutable case event timeline.
-- 6. Allows 'partial' cron_job_runs status for honest cron reporting.

-- ---------------------------------------------------------------------------
-- 1. Replay-truth reconciliation
-- ---------------------------------------------------------------------------

-- reviews.topics is jsonb in the live schema; older replays created text[].
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'reviews'
      and column_name = 'topics'
      and data_type = 'ARRAY'
  ) then
    alter table public.reviews
      alter column topics type jsonb
      using coalesce(to_jsonb(topics), '[]'::jsonb);
    alter table public.reviews
      alter column topics set default '[]'::jsonb;
  end if;
end $$;

alter table public.review_platform_connections
  add column if not exists refresh_token text,
  add column if not exists next_sync_at timestamptz;

alter table public.review_responses
  add column if not exists rejected_reason text,
  add column if not exists generation_prompt text,
  add column if not exists platform_response_id text,
  add column if not exists created_by uuid references public.profiles(id);

-- Replay-only cleanup: live schema uses rejected_reason, not rejection_reason.
alter table public.review_responses
  drop column if exists rejection_reason;

alter table public.reviewflow_config
  add column if not exists auto_analyze_reviews boolean default true,
  add column if not exists auto_generate_responses boolean default false,
  add column if not exists auto_respond_min_rating integer default 4;

-- ---------------------------------------------------------------------------
-- 2. Source-truth metadata on reviews
-- ---------------------------------------------------------------------------

alter table public.reviews
  add column if not exists content_fingerprint text,
  add column if not exists retrieval_method text,
  add column if not exists source_completeness text default 'unknown',
  add column if not exists last_observed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_retrieval_method_check'
  ) then
    alter table public.reviews
      add constraint reviews_retrieval_method_check
      check (
        retrieval_method is null
        or retrieval_method in ('provider_api', 'scraper', 'manual', 'csv_import')
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'reviews_source_completeness_check'
  ) then
    alter table public.reviews
      add constraint reviews_source_completeness_check
      check (source_completeness in ('complete', 'sample', 'degraded', 'unknown'));
  end if;
end $$;

create index if not exists reviews_property_fingerprint_idx
  on public.reviews (property_id, content_fingerprint)
  where content_fingerprint is not null;

-- ---------------------------------------------------------------------------
-- 3. Response governance columns
-- ---------------------------------------------------------------------------

alter table public.review_responses
  add column if not exists shared_action_attempt_id uuid references public.shared_action_attempts(id) on delete set null,
  add column if not exists decision_reason text,
  add column if not exists superseded_at timestamptz,
  add column if not exists provider_post_url text,
  add column if not exists provider_notes text,
  add column if not exists posted_by uuid references public.profiles(id),
  add column if not exists posting_mode text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'review_responses_posting_mode_check'
  ) then
    alter table public.review_responses
      add constraint review_responses_posting_mode_check
      check (posting_mode is null or posting_mode in ('manual_confirmed', 'provider_api'));
  end if;
end $$;

create index if not exists review_responses_review_created_idx
  on public.review_responses (review_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Versioned review intelligence
-- ---------------------------------------------------------------------------

create table if not exists public.review_analyses (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  analysis_version integer not null default 1,
  taxonomy_version text not null,
  model text not null,
  prompt_version text not null,
  status text not null default 'completed'
    check (status in ('completed', 'manual_review_required', 'failed')),
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  sentiment_score numeric(3, 2) check (sentiment_score >= -1 and sentiment_score <= 1),
  topics jsonb not null default '[]'::jsonb,
  journey_stage text,
  issue_domains jsonb not null default '[]'::jsonb,
  severity text check (severity is null or severity in ('low', 'medium', 'high', 'critical')),
  risk_class text,
  policy_class text,
  policy_flags jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  is_urgent boolean not null default false,
  summary text,
  recommended_action text,
  error_message text,
  usage jsonb,
  created_at timestamptz not null default now(),
  unique (review_id, analysis_version)
);

create index if not exists review_analyses_review_version_idx
  on public.review_analyses (review_id, analysis_version desc);

create index if not exists review_analyses_property_created_idx
  on public.review_analyses (property_id, created_at desc);

alter table public.review_analyses enable row level security;

drop policy if exists "Users view their org review analyses" on public.review_analyses;
create policy "Users view their org review analyses"
on public.review_analyses for select using (
  exists (
    select 1 from public.profiles
    join public.properties on properties.id = review_analyses.property_id
    where profiles.id = auth.uid() and profiles.org_id = properties.org_id
  )
);

-- ---------------------------------------------------------------------------
-- 5. Reputation cases + immutable case events
-- ---------------------------------------------------------------------------

create table if not exists public.reputation_cases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  review_id uuid not null references public.reviews(id) on delete cascade,
  source_ticket_id uuid references public.review_tickets(id) on delete set null,
  status text not null default 'open'
    check (status in (
      'open', 'triaged', 'awaiting_approval', 'ready_to_post',
      'remediation', 'resolved', 'dismissed'
    )),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  risk_class text,
  policy_class text,
  journey_stage text,
  issue_domains jsonb not null default '[]'::jsonb,
  root_cause text,
  owner_profile_id uuid references public.profiles(id),
  sla_due_at timestamptz,
  remediation_state text not null default 'none'
    check (remediation_state in ('none', 'recommended', 'in_progress', 'completed')),
  resolution_notes text,
  resolved_at timestamptz,
  reopened_count integer not null default 0,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id)
);

create index if not exists reputation_cases_property_status_idx
  on public.reputation_cases (property_id, status, priority);

create index if not exists reputation_cases_property_activity_idx
  on public.reputation_cases (property_id, last_activity_at desc);

alter table public.reputation_cases enable row level security;

drop policy if exists "Users view their org reputation cases" on public.reputation_cases;
create policy "Users view their org reputation cases"
on public.reputation_cases for select using (
  exists (
    select 1 from public.profiles
    join public.properties on properties.id = reputation_cases.property_id
    where profiles.id = auth.uid() and profiles.org_id = properties.org_id
  )
);

drop policy if exists "Users manage their org reputation cases" on public.reputation_cases;
create policy "Users manage their org reputation cases"
on public.reputation_cases for all using (
  exists (
    select 1 from public.profiles
    join public.properties on properties.id = reputation_cases.property_id
    where profiles.id = auth.uid() and profiles.org_id = properties.org_id
  )
);

create table if not exists public.reputation_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.reputation_cases(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id),
  actor_label text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists reputation_case_events_case_created_idx
  on public.reputation_case_events (case_id, created_at asc);

alter table public.reputation_case_events enable row level security;

drop policy if exists "Users view their org reputation case events" on public.reputation_case_events;
create policy "Users view their org reputation case events"
on public.reputation_case_events for select using (
  exists (
    select 1 from public.profiles
    join public.properties on properties.id = reputation_case_events.property_id
    where profiles.id = auth.uid() and profiles.org_id = properties.org_id
  )
);

-- Backfill: one case per existing review, carrying real escalation tickets.
-- Posting-audit tickets ("Provider response posted ...") are execution
-- evidence, not escalations, so they are excluded from case migration.
insert into public.reputation_cases (
  property_id,
  review_id,
  source_ticket_id,
  status,
  priority,
  owner_profile_id,
  resolution_notes,
  resolved_at,
  created_at,
  updated_at,
  last_activity_at
)
select
  r.property_id,
  r.id,
  t.id,
  case
    when t.status in ('resolved', 'closed') then 'resolved'
    when t.status = 'in_progress' then 'remediation'
    when r.response_status = 'posted' then 'resolved'
    when r.response_status = 'skipped' then 'dismissed'
    when r.response_status = 'approved' then 'ready_to_post'
    when r.response_status = 'draft_ready' then 'awaiting_approval'
    else 'open'
  end,
  coalesce(
    t.priority,
    case
      when r.is_urgent then 'urgent'
      when r.sentiment = 'negative' then 'high'
      else 'medium'
    end
  ),
  t.assigned_to,
  t.resolution_notes,
  t.resolved_at,
  coalesce(t.created_at, r.created_at, now()),
  now(),
  coalesce(t.updated_at, r.updated_at, now())
from public.reviews r
left join lateral (
  select *
  from public.review_tickets rt
  where rt.review_id = r.id
    and rt.title not ilike 'provider response posted%'
  order by rt.created_at asc
  limit 1
) t on true
where r.property_id is not null
on conflict (review_id) do nothing;

insert into public.reputation_case_events (case_id, property_id, event_type, actor_label, payload)
select
  c.id,
  c.property_id,
  'case_backfilled',
  'system',
  jsonb_build_object(
    'source', case when c.source_ticket_id is not null then 'review_ticket' else 'review' end,
    'status', c.status,
    'priority', c.priority
  )
from public.reputation_cases c
where not exists (
  select 1 from public.reputation_case_events e where e.case_id = c.id
);

-- ---------------------------------------------------------------------------
-- 6. Honest cron run reporting
-- ---------------------------------------------------------------------------

alter table public.cron_job_runs
  drop constraint if exists cron_job_runs_status_check;

alter table public.cron_job_runs
  add constraint cron_job_runs_status_check
  check (status in ('running', 'success', 'partial', 'failed'));
