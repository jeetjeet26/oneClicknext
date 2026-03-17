-- Gmail Integration for LumaLeasing Prospect Communication
-- Enables property managers to sync their Gmail inbox and manage prospect communications

-- Email Configuration (mirrors agent_calendars pattern)
create table if not exists email_configurations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  google_email text not null,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  sync_enabled boolean default true,
  auto_reply_enabled boolean default false,
  signature_template text,
  -- Token health monitoring columns
  token_status text default 'healthy', -- 'healthy' | 'expiring_soon' | 'expired' | 'revoked'
  last_health_check_at timestamptz,
  health_check_error text,
  -- Sync tracking columns
  last_sync_at timestamptz,
  history_id text, -- Gmail history ID for incremental sync
  watch_expiration timestamptz, -- Gmail push notification expiry
  -- Metadata
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(property_id, profile_id)
);

create index idx_email_configurations_property on email_configurations(property_id);
create index idx_email_configurations_profile on email_configurations(profile_id);
create index idx_email_configurations_token_status on email_configurations(token_status) where sync_enabled = true;

-- Email Threads (tracks Gmail thread conversations)
create table if not exists email_threads (
  id uuid primary key default gen_random_uuid(),
  email_configuration_id uuid references email_configurations(id) on delete cascade,
  property_id uuid references properties(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  conversation_id uuid references conversations(id) on delete set null,
  gmail_thread_id text not null,
  subject text,
  last_message_at timestamptz,
  message_count int default 0,
  status text default 'active', -- 'active' | 'archived' | 'snoozed'
  direction text default 'inbound', -- 'inbound' | 'outbound' | 'mixed'
  created_at timestamptz default now(),
  unique(email_configuration_id, gmail_thread_id)
);

create index idx_email_threads_gmail_id on email_threads(gmail_thread_id);
create index idx_email_threads_lead on email_threads(lead_id);
create index idx_email_threads_property on email_threads(property_id);
create index idx_email_threads_last_message on email_threads(last_message_at desc);

-- Email Messages (individual email messages)
create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  email_thread_id uuid references email_threads(id) on delete cascade,
  gmail_message_id text not null unique,
  direction text not null, -- 'inbound' | 'outbound'
  from_email text not null,
  from_name text,
  to_emails text[] not null,
  cc_emails text[],
  bcc_emails text[],
  subject text,
  body_text text,
  body_html text,
  snippet text,
  has_attachments boolean default false,
  attachments jsonb default '[]'::jsonb,
  labels text[],
  internal_date timestamptz,
  ai_generated boolean default false,
  ai_draft_approved boolean,
  created_at timestamptz default now()
);

create index idx_email_messages_thread on email_messages(email_thread_id);
create index idx_email_messages_gmail_id on email_messages(gmail_message_id);
create index idx_email_messages_direction on email_messages(direction);
create index idx_email_messages_internal_date on email_messages(internal_date desc);

-- Email Token Refresh Audit (mirrors calendar_token_refreshes pattern)
create table if not exists email_token_refreshes (
  id uuid primary key default gen_random_uuid(),
  email_configuration_id uuid references email_configurations(id) on delete cascade,
  refresh_status text not null, -- 'success' | 'failed' | 'revoked'
  error_message text,
  old_expires_at timestamptz,
  new_expires_at timestamptz,
  created_at timestamptz default now()
);

create index idx_email_token_refreshes_config on email_token_refreshes(email_configuration_id);
create index idx_email_token_refreshes_status on email_token_refreshes(refresh_status);
create index idx_email_token_refreshes_created on email_token_refreshes(created_at desc);

-- Row Level Security
alter table email_configurations enable row level security;
alter table email_threads enable row level security;
alter table email_messages enable row level security;
alter table email_token_refreshes enable row level security;

-- Policies: Users can only access email configs for their properties
create policy "Users view org email configurations" on email_configurations
  for select
  using (
    exists (
      select 1 from profiles pr
      join properties p on p.org_id = pr.org_id
      where pr.id = auth.uid() and p.id = email_configurations.property_id
    )
  );

create policy "Users manage org email configurations" on email_configurations
  for all
  using (
    exists (
      select 1 from profiles pr
      join properties p on p.org_id = pr.org_id
      where pr.id = auth.uid() and p.id = email_configurations.property_id
    )
  );

create policy "Users view org email threads" on email_threads
  for select
  using (
    exists (
      select 1 from email_configurations ec
      join properties p on p.id = ec.property_id
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid() and ec.id = email_threads.email_configuration_id
    )
  );

create policy "Users view org email messages" on email_messages
  for select
  using (
    exists (
      select 1 from email_threads et
      join email_configurations ec on ec.id = et.email_configuration_id
      join properties p on p.id = ec.property_id
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid() and et.id = email_messages.email_thread_id
    )
  );

create policy "System manage email threads" on email_threads
  for all
  using (true) -- Service role handles all thread management
  with check (true);

create policy "System manage email messages" on email_messages
  for all
  using (true) -- Service role handles all message management
  with check (true);

create policy "Users view email token refresh history" on email_token_refreshes
  for select
  using (
    exists (
      select 1 from email_configurations ec
      join properties p on p.id = ec.property_id
      join profiles pr on pr.org_id = p.org_id
      where pr.id = auth.uid() and ec.id = email_token_refreshes.email_configuration_id
    )
  );

-- Update lumaleasing_config table to add email support
alter table lumaleasing_config
add column if not exists email_enabled boolean default false,
add column if not exists email_configuration_id uuid references email_configurations(id);

-- Comments for documentation
comment on table email_configurations is 'Gmail OAuth configuration per property manager';
comment on table email_threads is 'Tracks Gmail thread conversations linked to leads and CRM interactions';
comment on table email_messages is 'Individual Gmail messages within threads for full conversation history';
comment on table email_token_refreshes is 'Audit log of OAuth token refresh attempts for diagnostics';
