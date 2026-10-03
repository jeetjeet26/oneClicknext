-- Run inside a transaction after the account-identity migration; fixtures roll back.
create function pg_temp.assert_true(passed boolean, detail text) returns void
language plpgsql as $$begin if passed is not true then raise exception 'FAIL: %',detail; end if; end$$;

insert into public.fact_marketing_performance
 (date,property_id,channel_id,source_account_id,currency_code,campaign_id,conversions,spend)
values
 ('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','1111111111','USD','identity-fixture',0.25,10),
 ('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','2222222222','USD','identity-fixture',0.75,20),
 ('2026-09-10','33333333-3333-3333-3333-333333333333','meta_ads','1111111111','USD','identity-fixture',0.125,30);
select pg_temp.assert_true((select count(*)=3 and sum(conversions)=1.125 from public.fact_marketing_performance where campaign_id='identity-fixture'), 'account/channel rows coexist and fractions remain exact');
insert into public.fact_marketing_performance
 (date,property_id,channel_id,source_account_id,currency_code,campaign_id,conversions,spend)
values ('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','1111111111','USD','identity-fixture',0.5,11)
on conflict(date,property_id,channel_id,source_account_id,campaign_id)
do update set conversions=excluded.conversions,spend=excluded.spend;
select pg_temp.assert_true((select count(*)=3 and sum(conversions)=1.375 and sum(spend)=61 from public.fact_marketing_performance where campaign_id='identity-fixture'), 'retry updates only its account and leaves other accounts unchanged');

do $$ begin
  begin
    insert into public.fact_marketing_performance(date,property_id,channel_id,campaign_id,conversions)
    values('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','missing-account',1);
    raise exception 'FAIL: missing source account accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,conversions)
    values('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','1111111111','CAD','wrong-currency',1);
    raise exception 'FAIL: unsupported currency accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,campaign_id,conversions,spend)
    values('2026-09-10','33333333-3333-3333-3333-333333333333','ga4','1111111111','ga4-unconfirmed-spend',1,10);
    raise exception 'FAIL: GA4 spend accepted without confirmed currency';
  exception when check_violation then null; end;
  begin
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,conversions)
    values('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','1111111111','USD','nan-conversions','NaN');
    raise exception 'FAIL: invalid numeric conversion accepted';
  exception when check_violation then null; end;
  begin
    insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,conversions)
    values('2026-09-10','33333333-3333-3333-3333-333333333333','google_ads','1111111111','USD','old-key',1)
    on conflict(date,property_id,campaign_id) do nothing;
    raise exception 'FAIL: obsolete conflict key accepted';
  exception when invalid_column_reference then null; end;
end $$;

-- A migration verification runner can seed this legacy row before applying the SQL.
do $$begin
  if exists(select 1 from public.fact_marketing_performance where campaign_id='historical-reconcile-fixture') then
    perform pg_temp.assert_true((select source_account_id is null and currency_code is null and conversions=7 from public.fact_marketing_performance where campaign_id='historical-reconcile-fixture'), 'historical identity and metrics preserved');
    begin
      insert into public.fact_marketing_performance(date,property_id,channel_id,source_account_id,currency_code,campaign_id,conversions)
      values('2026-09-10','33333333-3333-3333-3333-333333333333','meta_ads','1111111111','USD','historical-reconcile-fixture',1);
      raise exception 'FAIL: ambiguous legacy overlap accepted';
    exception when check_violation then null; end;
  end if;
end$$;

select set_config('request.jwt.claims', json_build_object('sub',(select id from auth.users where email='local-admin@p11.test'),'role','authenticated')::text, true);
set local role authenticated;
select pg_temp.assert_true((select count(*)=3 from public.fact_marketing_performance where campaign_id='identity-fixture'), 'authorized property reads retain separate accounts');
select pg_temp.assert_true(jsonb_array_length(public.query_marketing_analytics('33333333-3333-3333-3333-333333333333','2026-09-10','2026-09-10','campaign')) >= 3, 'bounded analytics RPC retains separate campaign identities');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
-- Hosted legacy policies may deny at their private organization helper before
-- returning an empty result. Both outcomes prohibit anonymous record access.
do $$ begin
 begin
  perform pg_temp.assert_true((select count(*)=0 from public.fact_marketing_performance where campaign_id='identity-fixture'), 'anonymous fact reads remain denied');
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
select pg_temp.assert_true((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.guard_marketing_legacy_overlap()'::regprocedure), 'overlap guard uses caller permissions and a fixed search path');
select 'PASS: account identity, retry isolation, exact fractions, legacy protection, old-writer rejection, RLS and campaign grouping';
