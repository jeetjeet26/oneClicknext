-- Phase 6: verified against the oneClick production catalog on 2026-09-24.
-- Add fields used by retained application contracts; never overwrite hosted originals.
-- Historical timestamps/values stay unknown. No migration-history repair is performed.
alter table public.content_assets add column if not exists dimensions jsonb;
alter table public.content_assets add column if not exists file_size bigint;
alter table public.content_templates add column if not exists is_default boolean;
alter table public.forgestudio_config add column if not exists auto_approve boolean;
alter table public.forgestudio_config add column if not exists default_hashtags text[];
alter table public.lead_engagement_events add column if not exists event_source text;
alter table public.lumaleasing_config add column if not exists rag_enabled boolean;
alter table public.lumaleasing_config add column if not exists widget_color text;
alter table public.mcp_audit_log add column if not exists action_details jsonb;
alter table public.mcp_audit_log add column if not exists server text;
alter table public.mcp_audit_log add column if not exists timestamp timestamptz;
alter table public.mcp_audit_log add column if not exists tool text;
alter table public.report_send_history add column if not exists updated_at timestamptz;
alter table public.reviewflow_config add column if not exists default_signature text;
alter table public.reviewflow_config add column if not exists escalation_threshold integer;
alter table public.reviewflow_config add column if not exists notification_slack_webhook text;
alter table public.reviewflow_config add column if not exists response_templates jsonb;
alter table public.reviewflow_config add column if not exists response_tone text;
alter table public.siteforge_jobs add column if not exists agent_logs jsonb;
alter table public.social_connections add column if not exists user_access_token text;
alter table public.widget_sessions add column if not exists created_at timestamptz;
alter table public.widget_sessions add column if not exists session_end timestamptz;
alter table public.widget_sessions add column if not exists session_start timestamptz;

-- New recorded services replace these legacy, unversioned side effects. The functions
-- remain for historical schema evidence, but cannot silently create scores or actions.
drop trigger if exists trg_score_new_lead on public.leads;
drop trigger if exists trg_score_bucket_change on public.lead_scores;
drop trigger if exists trigger_price_change_alert on public.competitor_price_history;
-- New property setup must not enable an unreviewed nurture sequence or invent amenities.
drop trigger if exists on_property_created on public.properties;

-- Reconnection and removal clear credentials while preserving the account history.
alter table public.social_connections alter column access_token drop not null;
alter table public.social_connections alter column account_id drop not null;
-- Both columns have wider numeric contracts in the current application.
alter table public.import_jobs alter column progress_pct type numeric;
alter table public.metric_goals alter column alert_threshold_percent type numeric;
-- UUID identifiers safely widen to text without changing their value.
alter table public.audit_logs alter column entity_id type text using entity_id::text;

-- Retain hosted favorites, including unknown legacy values, without assuming their intent.
-- Recorded edits already require a validated boolean; old nullable rows stay reviewable.
revoke all on public.social_connections from anon,authenticated;
NOTIFY pgrst,'reload schema';
