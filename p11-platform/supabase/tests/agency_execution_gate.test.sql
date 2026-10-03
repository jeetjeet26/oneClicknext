-- Safe on the active local console: no execution effect is permitted or attempted.
begin;
create temp table checks(label text);
create function pg_temp.check_it(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;insert into checks values(label);end$$;
insert into public.properties(id,org_id,name)values('ee760000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222','Disabled agency fixture');
select pg_temp.check_it(current_database()!~'^phase7_execution_[0-9]{8}$','ordinary console and upgrade databases keep the execution gate closed');
select pg_temp.check_it(public.read_agency_execution('ee760000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','{}')->'enabled'='false','pilot disabled by native boundary');
-- Even a manually inserted scope cannot turn the active database into an execution target.
insert into public.agency_execution_scopes(property_id,org_id,allowed_targets,expires_at,max_actions)values('ee760000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222','[]',clock_timestamp()+interval'1 hour',2);
select pg_temp.check_it(public.read_agency_execution('ee760000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','{}')->'enabled'='false','scope rows do not enable the active database');
select pg_temp.check_it(public.operate_agency_execution(gen_random_uuid(),'ee760000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111',jsonb_build_object('operation','prepare','planRevision',gen_random_uuid(),'steps',jsonb_build_array(jsonb_build_object('action','lead.note.add','targetId',gen_random_uuid(),'sourceHash',repeat('a',64),'content','Never execute')),'reason','Qualification gate check'))->>'state'='execution_disabled','valid-shaped prepare remains disabled');
do $$begin begin perform public.register_agency_rehearsal('ee760000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222','[]',1);raise exception 'MISSING gate'using errcode='P0002';exception when sqlstate'P0001'then perform pg_temp.check_it(sqlerrm='Disposable local execution database required','even postgres cannot register active execution');end;end$$;
select pg_temp.check_it(not exists(select 1 from public.agency_execution_runs where property_id='ee760000-0000-4000-8000-000000000001')and not exists(select 1 from public.agency_execution_commands where property_id='ee760000-0000-4000-8000-000000000001'),'disabled request creates no fake receipt');
select pg_temp.check_it(not exists(select 1 from public.shared_jobs where property_id='ee760000-0000-4000-8000-000000000001'),'no executable job created');
select pg_temp.check_it(not has_table_privilege('service_role','public.agency_execution_commands','UPDATE')and not has_table_privilege('service_role','public.agency_execution_commands','TRUNCATE'),'service cannot rewrite or truncate command history');
select pg_temp.check_it(not has_table_privilege('service_role','public.agency_native_work_origins','UPDATE')and not has_table_privilege('service_role','public.agency_native_work_origins','TRUNCATE'),'service cannot rewrite or truncate original scope history');
select count(*)as passed_execution_gate_assertions from checks;
rollback;
