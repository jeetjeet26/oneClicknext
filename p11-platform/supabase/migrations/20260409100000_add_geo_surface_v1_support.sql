do $$ begin
  alter type public.geo_surface_enum add value if not exists 'chatgpt';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.geo_surface_enum add value if not exists 'gemini';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.geo_surface_enum add value if not exists 'perplexity';
exception when duplicate_object then null; end $$;

do $$ begin
  alter type public.geo_surface_enum add value if not exists 'google_ai';
exception when duplicate_object then null; end $$;

comment on type public.geo_surface_enum is
  'Supported GEO answer surfaces. Legacy values openai/claude remain for backward compatibility; v1 sellable surfaces are chatgpt, gemini, perplexity, and google_ai.';
