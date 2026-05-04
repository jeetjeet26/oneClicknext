-- Add Lasso as a supported CRM integration platform.

ALTER TABLE public.integration_credentials
  DROP CONSTRAINT IF EXISTS integration_credentials_platform_check;

ALTER TABLE public.integration_credentials
  ADD CONSTRAINT integration_credentials_platform_check
  CHECK (
    platform = ANY (
      ARRAY[
        'google_analytics'::text,
        'google_search_console'::text,
        'google_tag_manager'::text,
        'google_ads'::text,
        'google_business_profile'::text,
        'meta_ads'::text,
        'linkedin_ads'::text,
        'tiktok_ads'::text,
        'email_marketing'::text,
        'crm'::text,
        'pms'::text,
        'yardi'::text,
        'realpage'::text,
        'salesforce'::text,
        'hubspot'::text,
        'lasso'::text
      ]
    )
  );
