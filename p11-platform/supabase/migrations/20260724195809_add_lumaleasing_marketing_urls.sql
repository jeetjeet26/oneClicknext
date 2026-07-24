-- Marketing site URLs the chatbot shares when visitors ask about floor plans
-- or availability. Nullable; when unset the chatbot simply doesn't link out.
ALTER TABLE public.lumaleasing_config
  ADD COLUMN IF NOT EXISTS floor_plans_url text,
  ADD COLUMN IF NOT EXISTS availability_url text;

COMMENT ON COLUMN public.lumaleasing_config.floor_plans_url IS 'Marketing site floor plans page the chatbot shares when visitors ask about floor plans';
COMMENT ON COLUMN public.lumaleasing_config.availability_url IS 'Marketing site availability/site plan page the chatbot shares when visitors ask about availability';
