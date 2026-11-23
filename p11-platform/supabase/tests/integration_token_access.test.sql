-- Run after protect_integration_credentials_and_ad_links; all fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select ok(not has_any_column_privilege('anon','public.integration_credentials','SELECT'), 'anonymous secret access has no surviving column grant');
select ok(not has_any_column_privilege('authenticated','public.integration_credentials','SELECT'), 'authenticated secret access has no surviving column grant');
select ok(not has_any_column_privilege('authenticated','public.ad_account_connections','INSERT') and not has_any_column_privilege('authenticated','public.ad_account_connections','UPDATE'), 'column grants cannot bypass ad-account write authorization');

insert into public.organizations(id, name) values
 ('fa330000-0000-4000-8000-000000000001', 'Token access security fixture');
insert into auth.users(id, email, email_confirmed_at) values
 ('fa330000-0000-4000-8000-000000000002', 'token-audit@example.invalid', clock_timestamp());
update public.profiles set org_id='fa330000-0000-4000-8000-000000000001', role='admin'
 where id='fa330000-0000-4000-8000-000000000002';
insert into public.properties(id, org_id, name) values
 ('fa330000-0000-4000-8000-000000000003', 'fa330000-0000-4000-8000-000000000001', 'Token audit property');
insert into public.community_access_grants(actor_id, property_id, capabilities, granted_by) values
 ('fa330000-0000-4000-8000-000000000002', 'fa330000-0000-4000-8000-000000000003',
 array['read','manage'], 'fa330000-0000-4000-8000-000000000002');
insert into public.integration_credentials(id, property_id, platform, credentials) values
 ('fa330000-0000-4000-8000-000000000004', 'fa330000-0000-4000-8000-000000000003',
 'google_ads', '{"access_token":"FAKE_TOKEN_FOR_LOCAL_TEST_ONLY"}');
insert into public.ad_account_connections(id, org_id, property_id, platform, account_id) values
 ('fa330000-0000-4000-8000-000000000005', 'fa330000-0000-4000-8000-000000000001',
 'fa330000-0000-4000-8000-000000000003', 'google_ads', 'security-fixture-existing');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($q$select credentials from public.integration_credentials$q$, '42501', null, 'anonymous visitors cannot read stored provider secrets');
select throws_ok($q$insert into public.ad_account_connections(property_id, org_id, platform, account_id) values ('fa330000-0000-4000-8000-000000000003','fa330000-0000-4000-8000-000000000001','google_ads','security-fixture-anon')$q$, '42501', null, 'anonymous visitors cannot assign shared-token ad accounts');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"fa330000-0000-4000-8000-000000000002"}', true);
select ok(public.brain_can('fa330000-0000-4000-8000-000000000002','fa330000-0000-4000-8000-000000000003','manage'), 'fixture admin has actual community management access');
select throws_ok($q$select credentials from public.integration_credentials$q$, '42501', null, 'even a community admin cannot download stored provider tokens');
select throws_ok($q$update public.integration_credentials set credentials='{}' where id='fa330000-0000-4000-8000-000000000004'$q$, '42501', null, 'browser cannot overwrite stored provider credentials');
select throws_ok($q$insert into public.ad_account_connections(property_id, org_id, platform, account_id) values ('fa330000-0000-4000-8000-000000000003','fa330000-0000-4000-8000-000000000001','google_ads','security-fixture-claimed')$q$, '42501', null, 'community admin cannot bypass server account-link authorization');
select throws_ok($q$update public.ad_account_connections set account_id='security-fixture-retargeted' where id='fa330000-0000-4000-8000-000000000005'$q$, '42501', null, 'browser cannot retarget an existing shared-token ad account');
select throws_ok($q$delete from public.ad_account_connections where id='fa330000-0000-4000-8000-000000000005'$q$, '42501', null, 'browser cannot bypass the authorized disconnect route');
select is((select count(*) from public.ad_account_connections where id='fa330000-0000-4000-8000-000000000005'), 1::bigint, 'scoped ad-account metadata remains readable');

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select credentials->>'access_token' from public.integration_credentials where id='fa330000-0000-4000-8000-000000000004'), 'FAKE_TOKEN_FOR_LOCAL_TEST_ONLY', 'authorized server can still use the stored provider token');
select lives_ok($q$update public.integration_credentials set credentials='{"access_token":"FAKE_REFRESHED_TOKEN"}' where id='fa330000-0000-4000-8000-000000000004'$q$, 'server retains credential refresh writes');
select lives_ok($q$insert into public.ad_account_connections(property_id, org_id, platform, account_id) values ('fa330000-0000-4000-8000-000000000003','fa330000-0000-4000-8000-000000000001','meta_ads','security-fixture-server')$q$, 'authorized server can still create ad links');
select lives_ok($q$update public.ad_account_connections set is_active=false where id='fa330000-0000-4000-8000-000000000005'$q$, 'server retains account-disconnect writes');
reset role;
select * from finish();
rollback;
