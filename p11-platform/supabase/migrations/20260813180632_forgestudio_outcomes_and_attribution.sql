alter table public.social_publications
  add column if not exists tracking_token uuid not null default gen_random_uuid(),
  add column if not exists experiment_key text,
  add column if not exists experiment_group text
    check (experiment_group is null or experiment_group in ('control', 'treatment'));

create unique index if not exists social_publications_tracking_token_uidx
  on public.social_publications(tracking_token);

create table if not exists public.social_publication_metrics (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.social_publications(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  metric_date date not null,
  impressions integer not null default 0 check (impressions >= 0),
  reach integer not null default 0 check (reach >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  reactions integer not null default 0 check (reactions >= 0),
  comments integer not null default 0 check (comments >= 0),
  shares integer not null default 0 check (shares >= 0),
  saves integer not null default 0 check (saves >= 0),
  video_views integer not null default 0 check (video_views >= 0),
  video_completions integer not null default 0 check (video_completions >= 0),
  provider_payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (publication_id, metric_date)
);

create index if not exists social_publication_metrics_property_date_idx
  on public.social_publication_metrics(property_id, metric_date desc);

create table if not exists public.social_attribution_events (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.social_publications(id) on delete cascade,
  action_attempt_id uuid references public.shared_action_attempts(id) on delete set null,
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  event_type text not null
    check (event_type in ('landing_view', 'lead', 'tour_booked', 'tour_completed', 'lease')),
  anonymous_subject_hash text not null check (length(anonymous_subject_hash) = 64),
  event_fingerprint text not null,
  occurred_at timestamptz not null,
  attribution_window_days integer not null default 30
    check (attribution_window_days between 1 and 90),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_fingerprint)
);

create index if not exists social_attribution_events_publication_time_idx
  on public.social_attribution_events(publication_id, occurred_at desc);

alter table public.social_publication_metrics enable row level security;
alter table public.social_attribution_events enable row level security;

create policy "Service role manages social publication metrics"
  on public.social_publication_metrics for all to service_role
  using (true) with check (true);

create policy "Org members view social publication metrics"
  on public.social_publication_metrics for select to authenticated
  using (org_id in (select profiles.org_id from public.profiles where profiles.id = auth.uid()));

create policy "Service role manages social attribution events"
  on public.social_attribution_events for all to service_role
  using (true) with check (true);

create policy "Org members view social attribution events"
  on public.social_attribution_events for select to authenticated
  using (org_id in (select profiles.org_id from public.profiles where profiles.id = auth.uid()));
