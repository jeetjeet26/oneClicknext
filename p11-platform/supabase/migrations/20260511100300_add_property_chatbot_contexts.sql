create table if not exists public.property_chatbot_contexts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'generating', 'current', 'stale', 'failed', 'needs_review')),
  context_markdown text not null default '',
  context_json jsonb not null default '{}'::jsonb,
  source_snapshot jsonb not null default '{}'::jsonb,
  source_ids uuid[] not null default '{}'::uuid[],
  model text,
  version integer not null default 1,
  last_generated_at timestamptz,
  stale_at timestamptz,
  error_message text,
  last_change_summary text,
  requires_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id)
);

create table if not exists public.property_chatbot_context_revisions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  context_id uuid references public.property_chatbot_contexts(id) on delete set null,
  previous_context_json jsonb,
  next_context_json jsonb not null default '{}'::jsonb,
  change_summary text,
  changed_source_ids uuid[] not null default '{}'::uuid[],
  removed_source_ids uuid[] not null default '{}'::uuid[],
  model text,
  created_at timestamptz not null default now()
);

create index if not exists idx_property_chatbot_contexts_property
  on public.property_chatbot_contexts(property_id);

create index if not exists idx_property_chatbot_contexts_status
  on public.property_chatbot_contexts(status);

create index if not exists idx_property_chatbot_contexts_requires_review
  on public.property_chatbot_contexts(requires_review);

create index if not exists idx_property_chatbot_context_revisions_property
  on public.property_chatbot_context_revisions(property_id, created_at desc);

alter table public.property_chatbot_contexts enable row level security;
alter table public.property_chatbot_context_revisions enable row level security;

drop policy if exists "Users can view chatbot contexts" on public.property_chatbot_contexts;
create policy "Users can view chatbot contexts" on public.property_chatbot_contexts
for select using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.profiles p
    join public.properties prop on prop.org_id = p.org_id
    where p.id = auth.uid()
      and prop.id = property_chatbot_contexts.property_id
  )
);

drop policy if exists "Admins can manage chatbot contexts" on public.property_chatbot_contexts;
create policy "Admins can manage chatbot contexts" on public.property_chatbot_contexts
for all using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.profiles p
    join public.properties prop on prop.org_id = p.org_id
    where p.id = auth.uid()
      and p.role in ('admin', 'manager')
      and prop.id = property_chatbot_contexts.property_id
  )
)
with check (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.profiles p
    join public.properties prop on prop.org_id = p.org_id
    where p.id = auth.uid()
      and p.role in ('admin', 'manager')
      and prop.id = property_chatbot_contexts.property_id
  )
);

drop policy if exists "Users can view chatbot context revisions" on public.property_chatbot_context_revisions;
create policy "Users can view chatbot context revisions" on public.property_chatbot_context_revisions
for select using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.profiles p
    join public.properties prop on prop.org_id = p.org_id
    where p.id = auth.uid()
      and prop.id = property_chatbot_context_revisions.property_id
  )
);

drop policy if exists "Service role can manage chatbot context revisions" on public.property_chatbot_context_revisions;
create policy "Service role can manage chatbot context revisions" on public.property_chatbot_context_revisions
for all using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop trigger if exists update_property_chatbot_contexts_updated_at on public.property_chatbot_contexts;
create trigger update_property_chatbot_contexts_updated_at
  before update on public.property_chatbot_contexts
  for each row execute function public.update_updated_at_column();
