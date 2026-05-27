-- Competitor Intake Agent
-- Stores property-scoped client-provided competitor seeds as provenance only.

create table if not exists public.competitor_intake_batches (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  raw_text text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  completed_at timestamptz
);

create table if not exists public.competitor_intake_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.competitor_intake_batches(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  competitor_id uuid references public.competitors(id) on delete set null,
  seed_name text not null,
  seed_location text,
  seed_url text,
  seed_snippet text not null,
  seed_claims jsonb not null default '{}'::jsonb,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending', 'processing', 'completed', 'failed', 'skipped')),
  evidence_summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_competitor_intake_batches_property
  on public.competitor_intake_batches(property_id);

create index if not exists idx_competitor_intake_batches_status
  on public.competitor_intake_batches(status);

create index if not exists idx_competitor_intake_candidates_batch
  on public.competitor_intake_candidates(batch_id);

create index if not exists idx_competitor_intake_candidates_property
  on public.competitor_intake_candidates(property_id);

create index if not exists idx_competitor_intake_candidates_competitor
  on public.competitor_intake_candidates(competitor_id);

create index if not exists idx_competitor_intake_candidates_status
  on public.competitor_intake_candidates(enrichment_status);

create unique index if not exists idx_competitor_intake_candidates_batch_seed
  on public.competitor_intake_candidates(batch_id, lower(seed_name));

create trigger update_competitor_intake_batches_updated_at
  before update on public.competitor_intake_batches
  for each row execute function public.update_updated_at_column();

create trigger update_competitor_intake_candidates_updated_at
  before update on public.competitor_intake_candidates
  for each row execute function public.update_updated_at_column();

alter table public.competitor_intake_batches enable row level security;
alter table public.competitor_intake_candidates enable row level security;

create policy "Service role full access to competitor intake batches"
  on public.competitor_intake_batches
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view their org competitor intake batches"
  on public.competitor_intake_batches
  for select
  using (
    exists (
      select 1
      from public.profiles p
      join public.properties prop on prop.org_id = p.org_id
      where p.id = auth.uid()
        and prop.id = competitor_intake_batches.property_id
    )
  );

create policy "Users manage their org competitor intake batches"
  on public.competitor_intake_batches
  for all
  using (
    exists (
      select 1
      from public.profiles p
      join public.properties prop on prop.org_id = p.org_id
      where p.id = auth.uid()
        and prop.id = competitor_intake_batches.property_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.properties prop on prop.org_id = p.org_id
      where p.id = auth.uid()
        and prop.id = competitor_intake_batches.property_id
    )
  );

create policy "Service role full access to competitor intake candidates"
  on public.competitor_intake_candidates
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "Users view their org competitor intake candidates"
  on public.competitor_intake_candidates
  for select
  using (
    exists (
      select 1
      from public.profiles p
      join public.properties prop on prop.org_id = p.org_id
      where p.id = auth.uid()
        and prop.id = competitor_intake_candidates.property_id
    )
  );

create policy "Users manage their org competitor intake candidates"
  on public.competitor_intake_candidates
  for all
  using (
    exists (
      select 1
      from public.profiles p
      join public.properties prop on prop.org_id = p.org_id
      where p.id = auth.uid()
        and prop.id = competitor_intake_candidates.property_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      join public.properties prop on prop.org_id = p.org_id
      where p.id = auth.uid()
        and prop.id = competitor_intake_candidates.property_id
    )
  );
