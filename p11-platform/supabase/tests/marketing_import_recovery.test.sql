create function pg_temp.check_true(ok boolean,description text) returns void language plpgsql as $$begin if ok is not true then raise exception 'FAIL: %',description; end if;end$$;
insert into public.properties(id,name,org_id) values('aaa00000-0000-4000-8000-000000000001','Phase 0 transaction fixture','22222222-2222-2222-2222-222222222222');
insert into public.ad_account_connections(id,property_id,org_id,platform,account_id,account_name,is_active)
 values('aaa00000-0000-4000-8000-000000000003','aaa00000-0000-4000-8000-000000000001','22222222-2222-2222-2222-222222222222','google_ads','5555555555','Transaction fixture',true);
insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,spend,conversions)
 select '2026-09-10','aaa00000-0000-4000-8000-000000000001','google_ads','5555555555','USD','snapshot-'||n,1,0.125 from generate_series(1,1205) n;
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.check_true((public.read_marketing_facts('aaa00000-0000-4000-8000-000000000001')->>'row_count')::int=1205,'single snapshot includes more than the REST row cap');
select pg_temp.check_true((select sum((r->>'conversions')::numeric)=150.625 from jsonb_array_elements(public.read_marketing_facts('aaa00000-0000-4000-8000-000000000001')->'rows') r),'complete fractional snapshot totals');
select pg_temp.check_true(not has_function_privilege('authenticated','public.claim_marketing_import(uuid,uuid)','EXECUTE'),'browser callers cannot claim workers');
reset role;
insert into public.import_jobs(id,property_id,channels,date_range,status,recovery_version)
 values('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000001',array['google_ads'],'LAST_7_DAYS','pending',1),
 ('aaa00000-0000-4000-8000-000000000011','aaa00000-0000-4000-8000-000000000001',array['google_ads'],'LAST_7_DAYS','pending',1),
 ('aaa00000-0000-4000-8000-000000000012','aaa00000-0000-4000-8000-000000000001',array['google_ads'],'LAST_7_DAYS','pending',null);
set local role service_role;
select pg_temp.check_true(public.claim_marketing_import('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000020') is not null,'first worker claims pending job');
select pg_temp.check_true(public.claim_marketing_import('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000021') is null,'duplicate worker cannot claim active lease');
select pg_temp.check_true(public.claim_marketing_import('aaa00000-0000-4000-8000-000000000011','aaa00000-0000-4000-8000-000000000021') is null,'different job cannot overlap same property');
select pg_temp.check_true(public.claim_marketing_import('aaa00000-0000-4000-8000-000000000012','aaa00000-0000-4000-8000-000000000021') is null,'old backlog cannot enter new recovery');
select public.save_marketing_import_report('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000020','aaa00000-0000-4000-8000-000000000003',
 (select jsonb_agg(jsonb_build_object('date','2026-09-11','property_id','aaa00000-0000-4000-8000-000000000001','channel_id','google_ads','source_account_id','5555555555','currency_code','USD','campaign_id','resume-'||n,'impressions',10,'clicks',1,'spend',1,'conversions',0.125,'raw_source','mcp_daily_v1')) from generate_series(1,550) n));
select pg_temp.check_true((public.commit_marketing_import_batch('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000020','aaa00000-0000-4000-8000-000000000003')->>'offset')::int=250,'first batch and checkpoint committed together');
select pg_temp.check_true((select records_imported=250 from public.import_jobs where id='aaa00000-0000-4000-8000-000000000010'),'confirmed count equals committed first batch');
-- A new REST transaction would not inherit the worker token from the previous RPC.
select set_config('p11.marketing_worker_token','',true);
do $$begin
 begin
  insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,spend,conversions)
   values('2026-09-11','aaa00000-0000-4000-8000-000000000001','google_ads','5555555555','USD','untracked-race',1,1);
  raise exception 'FAIL: direct writer raced an active import';
 exception when object_not_in_prerequisite_state then null;end;
end$$;
update public.import_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='aaa00000-0000-4000-8000-000000000010';
select pg_temp.check_true((public.claim_marketing_import('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000021')->'accounts'->0->>'offset')::int=250,'restart retains saved report and offset');
do $$begin
 begin
  perform public.commit_marketing_import_batch('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000020','aaa00000-0000-4000-8000-000000000003');
  raise exception 'FAIL: stale worker wrote after takeover';
 exception when object_not_in_prerequisite_state then null;end;
end$$;
select pg_temp.check_true((public.commit_marketing_import_batch('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000021','aaa00000-0000-4000-8000-000000000003')->>'offset')::int=500,'restart continues next batch');
select pg_temp.check_true((public.commit_marketing_import_batch('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000021','aaa00000-0000-4000-8000-000000000003')->>'offset')::int=550,'final batch completes saved report');
select pg_temp.check_true(public.finish_marketing_import('aaa00000-0000-4000-8000-000000000010','aaa00000-0000-4000-8000-000000000021')='complete','completed report has truthful terminal status');
select pg_temp.check_true((select records_imported=550 from public.import_jobs where id='aaa00000-0000-4000-8000-000000000010'),'restart does not double count earlier batch');
select pg_temp.check_true((select count(*)=550 and sum(conversions)=68.75 from public.fact_marketing_performance where property_id='aaa00000-0000-4000-8000-000000000001' and campaign_id like 'resume-%'),'restart leaves exact stored records and fractions');
select pg_temp.check_true(public.claim_marketing_import('aaa00000-0000-4000-8000-000000000011','aaa00000-0000-4000-8000-000000000022') is not null,'next queued job can run after completion');
reset role;
select 'PASS: complete snapshots, leases, overlap prevention, frozen report resume, stale-worker fencing, exact counts and no old backlog replay';
