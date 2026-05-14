-- Provider-scoped calendar/email authorization links for LumaLeasing.
-- Keeps existing Google/Gmail rows working while adding provider metadata
-- and one-time external invite links for clients who should not get P11 access.

create table if not exists public.integration_auth_invites (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  requested_capabilities text[] not null default '{}'::text[],
  token_hash text not null unique,
  token_preview text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  consumed_calendar_id uuid references public.agent_calendars(id) on delete set null,
  consumed_email_configuration_id uuid references public.email_configurations(id) on delete set null,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requested_capabilities <@ array['calendar', 'email']::text[]),
  check (array_length(requested_capabilities, 1) is not null)
);

create index if not exists idx_integration_auth_invites_property
  on public.integration_auth_invites(property_id);
create index if not exists idx_integration_auth_invites_provider
  on public.integration_auth_invites(provider);
create index if not exists idx_integration_auth_invites_token_hash
  on public.integration_auth_invites(token_hash);
create index if not exists idx_integration_auth_invites_active
  on public.integration_auth_invites(property_id, provider, expires_at)
  where consumed_at is null and revoked_at is null;

alter table public.integration_auth_invites enable row level security;

drop policy if exists "Users view org integration auth invites" on public.integration_auth_invites;
create policy "Users view org integration auth invites" on public.integration_auth_invites
  for select
  using (
    exists (
      select 1
      from public.profiles pr
      join public.properties p on p.org_id = pr.org_id
      where pr.id = auth.uid()
        and p.id = integration_auth_invites.property_id
    )
  );

drop policy if exists "Users manage org integration auth invites" on public.integration_auth_invites;
create policy "Users manage org integration auth invites" on public.integration_auth_invites
  for all
  using (
    exists (
      select 1
      from public.profiles pr
      join public.properties p on p.org_id = pr.org_id
      where pr.id = auth.uid()
        and p.id = integration_auth_invites.property_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles pr
      join public.properties p on p.org_id = pr.org_id
      where pr.id = auth.uid()
        and p.id = integration_auth_invites.property_id
    )
  );

alter table public.agent_calendars
  add column if not exists provider text not null default 'google',
  add column if not exists account_email text,
  add column if not exists provider_subject text,
  add column if not exists tenant_id text,
  add column if not exists scopes text[] not null default '{}'::text[],
  add column if not exists auth_source text not null default 'dashboard',
  add column if not exists authorized_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists external_invite_id uuid references public.integration_auth_invites(id) on delete set null,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

alter table public.agent_calendars
  drop constraint if exists agent_calendars_provider_check,
  add constraint agent_calendars_provider_check
    check (provider in ('google', 'microsoft'));

alter table public.agent_calendars
  drop constraint if exists agent_calendars_auth_source_check,
  add constraint agent_calendars_auth_source_check
    check (auth_source in ('dashboard', 'external_invite'));

update public.agent_calendars
set account_email = coalesce(account_email, google_email),
    provider = coalesce(provider, 'google'),
    scopes = case
      when scopes is null or cardinality(scopes) = 0
        then array[
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/calendar.events'
        ]::text[]
      else scopes
    end
where account_email is null
   or provider is null
   or scopes is null
   or cardinality(scopes) = 0;

alter table public.agent_calendars
  alter column account_email set not null,
  alter column google_email drop not null;

create index if not exists idx_agent_calendars_provider
  on public.agent_calendars(provider);
create index if not exists idx_agent_calendars_account_email
  on public.agent_calendars(account_email);
create index if not exists idx_agent_calendars_external_invite
  on public.agent_calendars(external_invite_id)
  where external_invite_id is not null;

alter table public.email_configurations
  add column if not exists provider text not null default 'google',
  add column if not exists account_email text,
  add column if not exists provider_subject text,
  add column if not exists tenant_id text,
  add column if not exists scopes text[] not null default '{}'::text[],
  add column if not exists auth_source text not null default 'dashboard',
  add column if not exists authorized_by_profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists external_invite_id uuid references public.integration_auth_invites(id) on delete set null,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

alter table public.email_configurations
  drop constraint if exists email_configurations_provider_check,
  add constraint email_configurations_provider_check
    check (provider in ('google', 'microsoft'));

alter table public.email_configurations
  drop constraint if exists email_configurations_auth_source_check,
  add constraint email_configurations_auth_source_check
    check (auth_source in ('dashboard', 'external_invite'));

update public.email_configurations
set account_email = coalesce(account_email, google_email),
    provider = coalesce(provider, 'google'),
    scopes = case
      when scopes is null or cardinality(scopes) = 0
        then array[
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.modify',
          'openid',
          'email'
        ]::text[]
      else scopes
    end
where account_email is null
   or provider is null
   or scopes is null
   or cardinality(scopes) = 0;

alter table public.email_configurations
  alter column account_email set not null,
  alter column google_email drop not null;

create index if not exists idx_email_configurations_provider
  on public.email_configurations(provider);
create index if not exists idx_email_configurations_account_email
  on public.email_configurations(account_email);
create index if not exists idx_email_configurations_external_invite
  on public.email_configurations(external_invite_id)
  where external_invite_id is not null;

alter table public.calendar_events
  add column if not exists provider_event_id text,
  add column if not exists provider_event_link text;

update public.calendar_events
set provider_event_id = coalesce(provider_event_id, google_event_id)
where provider_event_id is null;

alter table public.calendar_events
  alter column provider_event_id set not null;

create index if not exists idx_calendar_events_provider_event_id
  on public.calendar_events(provider_event_id);

alter table public.email_threads
  add column if not exists provider_thread_id text;

update public.email_threads
set provider_thread_id = coalesce(provider_thread_id, gmail_thread_id)
where provider_thread_id is null;

alter table public.email_threads
  alter column provider_thread_id set not null;

create index if not exists idx_email_threads_provider_thread_id
  on public.email_threads(provider_thread_id);

alter table public.email_messages
  add column if not exists provider_message_id text;

update public.email_messages
set provider_message_id = coalesce(provider_message_id, gmail_message_id)
where provider_message_id is null;

alter table public.email_messages
  alter column provider_message_id set not null;

create index if not exists idx_email_messages_provider_message_id
  on public.email_messages(provider_message_id);

comment on table public.integration_auth_invites is
  'One-time property-scoped OAuth invite links for external Google or Microsoft calendar/email authorization.';
comment on column public.agent_calendars.provider is
  'Calendar provider backing this property calendar connection.';
comment on column public.agent_calendars.account_email is
  'Provider account email shown to operators and used for provider-specific lookups.';
comment on column public.email_configurations.provider is
  'Email provider backing this property inbox connection.';
comment on column public.email_configurations.account_email is
  'Provider account email shown to operators and used for provider-specific lookups.';
