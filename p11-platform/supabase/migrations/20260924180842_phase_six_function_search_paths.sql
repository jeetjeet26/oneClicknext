-- These three production-advisor findings use only pg_catalog built-ins and
-- explicitly qualified public tables. Pin resolution without adding privileges.
alter function public.claim_shared_jobs(text,text,integer,integer) set search_path=pg_catalog,pg_temp;
alter function public.heartbeat_shared_job(uuid,text,integer) set search_path=pg_catalog,pg_temp;
alter function public.update_marketvision_updated_at() set search_path=pg_catalog,pg_temp;
