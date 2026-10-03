-- Local seeded database only. All fixtures and session settings roll back.
begin;
create temp table schema_checks(label text);
create function pg_temp.check_schema(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;insert into schema_checks values(label);end$$;
select pg_temp.check_schema((select data_type='text' from information_schema.columns where table_schema='public' and table_name='leads' and column_name='bedrooms'),'bedroom preference matches verified hosted text contract');
select pg_temp.check_schema((select count(*)=2 from information_schema.columns where table_schema='public' and table_name='siteforge_blueprint_versions' and column_name in ('content_hash','created_at') and is_nullable='NO'),'artifacts require their real hash and creation timestamp');
select pg_temp.check_schema((select count(*)=5 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('shared_execution_budgets','shared_execution_budget_events','siteforge_component_registry','siteforge_component_versions','siteforge_edit_attachments') and c.relrowsecurity),'all restored tables have RLS');
select pg_temp.check_schema(not has_table_privilege('authenticated','public.shared_execution_budgets','select') and not has_table_privilege('authenticated','public.shared_execution_budget_events','insert'),'budget records remain private to services');
select pg_temp.check_schema(not has_table_privilege('authenticated','public.siteforge_component_versions','insert') and not has_table_privilege('authenticated','public.siteforge_component_registry','update'),'browser cannot publish or replace governed components');
select pg_temp.check_schema(not has_table_privilege('authenticated','public.siteforge_edit_attachments','insert') and has_table_privilege('authenticated','public.siteforge_edit_attachments','select'),'attachment browser access remains read-only');
insert into public.leads(id,property_id,first_name,email,bedrooms)values(gen_random_uuid(),'33333333-3333-3333-3333-333333333333','Schema preference fixture','studio@fixture.invalid','studio'),(gen_random_uuid(),'33333333-3333-3333-3333-333333333333','Schema preference fixture','large@fixture.invalid','3+');
select pg_temp.check_schema((select count(*)=2 from public.leads where first_name='Schema preference fixture' and bedrooms in ('studio','3+')),'textual preferences save without losing studio or range intent');
-- Synthetic attachment identities have no storage objects; avoid fabricating website artifacts.
set local session_replication_role=replica;
insert into public.siteforge_edit_attachments(id,session_id,org_id,property_id,website_id,artifact_id,artifact_content_hash,page_slug,viewport,storage_path,byte_sha256,mime_type,file_size_bytes,original_filename,created_by)
select gen_random_uuid(),gen_random_uuid(),org,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),repeat('0',64),'fixture','desktop','schema-fixture/'||gen_random_uuid(),repeat('0',64),'image/png',1,'schema-fixture.png','11111111-1111-1111-1111-111111111111' from (values('22222222-2222-2222-2222-222222222222'::uuid),(gen_random_uuid())) fixtures(org);
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
DO $$declare visible integer;begin
 execute 'set local role authenticated';
 select count(*) into visible from public.siteforge_edit_attachments where original_filename='schema-fixture.png';
 execute 'reset role';
 perform pg_temp.check_schema(visible=1,'signed-in operator sees own organization attachment and not another organization');
end$$;
select pg_temp.check_schema((select count(*)=3 from pg_policies where schemaname='public' and policyname in ('Service role manages shared_execution_budgets','Service role manages shared_execution_budget_events','Service role manages SiteForge edit attachments') and roles='{service_role}'::name[]),'service policies cannot be evaluated as browser access grants');
select count(*) as assertions from schema_checks;
rollback;
