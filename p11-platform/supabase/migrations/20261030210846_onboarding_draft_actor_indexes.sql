-- Cover actor foreign keys for profile cleanup and actor-scoped draft lookups.
CREATE INDEX onboarding_drafts_actor ON public.property_onboarding_drafts(actor_id);
CREATE INDEX onboarding_draft_receipts_actor ON public.property_onboarding_draft_receipts(actor_id);
