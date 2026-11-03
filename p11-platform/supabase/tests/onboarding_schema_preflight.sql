DO $$BEGIN
 IF to_regprocedure('public.brain_can(uuid,uuid,text)') IS NULL
 OR to_regprocedure('public.brain_grant_property_creator()') IS NULL
 OR to_regprocedure('public.property_onboarding_draft(uuid,uuid,jsonb)') IS NULL
 OR to_regprocedure('public.validate_onboarding_intake(jsonb)') IS NULL
 OR to_regprocedure('public.sync_property_setup_tasks(uuid,uuid)') IS NULL
 OR to_regclass('public.property_onboarding_drafts') IS NULL THEN
  RAISE EXCEPTION 'Onboarding requires the current Community Brain access migrations and 20261030193456 onboarding intake migration. Apply them to the isolated local test database before running browser tests.';
 END IF;
 IF position('brain_can' in pg_get_functiondef('public.save_property_setup(uuid,uuid,uuid,jsonb)'::regprocedure))=0
 OR position('validate_onboarding_intake' in pg_get_functiondef('public._brain_save_property_setup(uuid,uuid,uuid,jsonb)'::regprocedure))=0 THEN
  RAISE EXCEPTION 'Onboarding save must preserve current community access checks and validate the shared intake.';
 END IF;
END$$;
