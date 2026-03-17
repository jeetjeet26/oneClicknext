-- Align conversations and leads schema with LumaLeasing runtime usage.

alter table conversations
  add column if not exists widget_session_id uuid references widget_sessions(id) on delete set null,
  add column if not exists is_human_mode boolean default false;

create index if not exists idx_conversations_widget_session
  on conversations(widget_session_id);

alter table leads
  add column if not exists score int,
  add column if not exists score_bucket text;

comment on column conversations.widget_session_id is 'Links a conversation to its originating widget session for LumaLeasing flows.';
comment on column conversations.is_human_mode is 'When true, the conversation is waiting on a human instead of auto-replying with AI.';
comment on column leads.score is 'Latest computed LeadPulse score snapshot copied from lead_scores for fast UI access.';
comment on column leads.score_bucket is 'Latest LeadPulse bucket snapshot copied from lead_scores for fast UI access.';
