-- Photo shown as the assistant avatar in the chat widget. Nullable; the
-- widget falls back to the bot icon when unset.
ALTER TABLE public.lumaleasing_config
  ADD COLUMN IF NOT EXISTS agent_avatar_url text;

COMMENT ON COLUMN public.lumaleasing_config.agent_avatar_url IS 'Photo shown as the assistant avatar in the chat widget; falls back to the bot icon when unset';
