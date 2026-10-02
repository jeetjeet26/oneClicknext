-- Brand font uploads are already supported by the API. Admit their saved type
-- on the production-derived schema while retaining the original media types.
ALTER TABLE public.content_assets DROP CONSTRAINT IF EXISTS content_assets_asset_type_check;
ALTER TABLE public.content_assets ADD CONSTRAINT content_assets_asset_type_check
 CHECK (asset_type IN ('image', 'video', 'gif', 'audio', 'font')) NOT VALID;
ALTER TABLE public.content_assets VALIDATE CONSTRAINT content_assets_asset_type_check;
