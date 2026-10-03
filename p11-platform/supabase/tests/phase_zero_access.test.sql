-- Run in a transaction AFTER the Phase 0 migration. All fixtures are rolled back.
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into public.organizations (id, name) values
 ('f0050000-0000-4000-8000-000000000001', 'Phase 0 fixture A'),
 ('f0050000-0000-4000-8000-000000000002', 'Phase 0 fixture B');
insert into auth.users (id, email) values
 ('f0050000-0000-4000-8000-000000000003', 'phase0-a@example.invalid'),
 ('f0050000-0000-4000-8000-000000000004', 'phase0-b@example.invalid');
update public.profiles set org_id='f0050000-0000-4000-8000-000000000001', role='viewer'
 where id='f0050000-0000-4000-8000-000000000003';
update public.profiles set org_id='f0050000-0000-4000-8000-000000000002', role='admin'
 where id='f0050000-0000-4000-8000-000000000004';
insert into public.properties (id, org_id, name) values
 ('f0050000-0000-4000-8000-000000000011','f0050000-0000-4000-8000-000000000001','Phase 0 A'),
 ('f0050000-0000-4000-8000-000000000012','f0050000-0000-4000-8000-000000000002','Phase 0 B');
insert into public.fact_marketing_performance
 (date,property_id,channel_id,source_account_id,currency_code,campaign_id,impressions,clicks,spend,conversions) values
 ('2026-09-01','f0050000-0000-4000-8000-000000000011','google_ads','9999999999','USD','phase0-a',100,10,20,2),
 ('2026-09-01','f0050000-0000-4000-8000-000000000012','google_ads','9999999999','USD','phase0-b',9000,900,900,90);
insert into storage.buckets (id,name,public) values
 ('brand-assets','brand-assets',true),('content-assets','content-assets',true),('documents','documents',false)
 on conflict (id) do nothing;
insert into storage.objects (bucket_id,name) values
 ('brand-assets','f0050000-0000-4000-8000-000000000011/phase0-logo.png'),
 ('documents','f0050000-0000-4000-8000-000000000011/phase0-own.pdf'),
 ('documents','f0050000-0000-4000-8000-000000000012/phase0-other.pdf');

select ok(not has_function_privilege('anon','public.execute_readonly_query(text)','execute'),'anon cannot execute arbitrary SQL');
select ok(not has_function_privilege('authenticated','public.execute_readonly_query(text)','execute'),'users cannot execute arbitrary SQL');
select ok(not has_function_privilege('service_role','public.execute_readonly_query(text)','execute'),'backend cannot execute arbitrary SQL');
select throws_ok($$select public.execute_readonly_query('SELECT 1')$$,'0A000',null,'old function body is disabled even for owner');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosecdef and p.proname<>'get_user_org_id'
 and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),0::bigint,'privileged helpers are backend-only');

set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.query_marketing_analytics('f0050000-0000-4000-8000-000000000011','2026-09-01','2026-09-01')$$,'42501',null,'anonymous analytics is denied');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('brand-assets','phase0-anon.png')$$,'42501',null,'anonymous uploads are denied');
with changed as (update storage.objects set name='phase0-stolen.png' where name like '%/phase0-logo.png' returning id)
select is((select count(*) from changed),0::bigint,'anonymous asset updates affect no rows');
select is((select count(*) from storage.objects where bucket_id='documents' and name like '%/phase0-%.pdf'),0::bigint,'anonymous visitors cannot read documents');

reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"f0050000-0000-4000-8000-000000000003"}',true);
select lives_ok($$update public.profiles set full_name='Phase 0 updated', preferences='{"theme":"dark"}' where id='f0050000-0000-4000-8000-000000000003'$$,'owner can update name and preferences');
select throws_ok($$update public.profiles set role='admin' where id='f0050000-0000-4000-8000-000000000003'$$,'42501',null,'owner cannot self-promote');
select throws_ok($$update public.profiles set org_id='f0050000-0000-4000-8000-000000000002' where id='f0050000-0000-4000-8000-000000000003'$$,'42501',null,'owner cannot change organization');
with changed as (update public.profiles set full_name='stolen' where id='f0050000-0000-4000-8000-000000000004' returning id)
select is((select count(*) from changed),0::bigint,'another profile cannot be edited');
select is(public.get_user_org_id('f0050000-0000-4000-8000-000000000004'),null::uuid,'organization lookup cannot disclose another user membership');
select is((public.query_marketing_analytics('f0050000-0000-4000-8000-000000000011','2026-09-01','2026-09-01')->0->>'spend')::numeric,20::numeric,'analytics totals contain only the authorized property');
select is((public.query_marketing_analytics('f0050000-0000-4000-8000-000000000011','2026-09-01','2026-09-01')->0->>'ctr')::numeric,10::numeric,'analytics ratios use scoped totals');
select throws_ok($$select public.query_marketing_analytics('f0050000-0000-4000-8000-000000000012','2026-09-01','2026-09-01')$$,'42501',null,'cross-organization analytics is denied');
select throws_ok($$select public.query_marketing_analytics('f0050000-0000-4000-8000-000000000011','2026-09-01','2026-09-01','pg_sleep(10)')$$,'22023',null,'grouping expressions are rejected');
select throws_ok($$select public.query_marketing_analytics('f0050000-0000-4000-8000-000000000011','2020-01-01','2026-09-01')$$,'22023',null,'analytics date range is bounded');
select is(public.query_marketing_analytics('f0050000-0000-4000-8000-000000000011','2026-09-01','2026-09-01','none',$filter$x' OR true --$filter$),'[]'::jsonb,'channel input is data, not SQL');
select is((select count(*) from storage.objects where bucket_id='documents' and name like '%/phase0-%.pdf'),1::bigint,'members see only their property documents');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('content-assets','f0050000-0000-4000-8000-000000000011/phase0-upload.png')$$,'members can upload into their own property');
select throws_ok($$insert into storage.objects(bucket_id,name) values ('content-assets','f0050000-0000-4000-8000-000000000012/phase0-upload.png')$$,'42501',null,'cross-organization uploads are denied');
select throws_ok($$update storage.objects set name='f0050000-0000-4000-8000-000000000012/phase0-moved.png' where name='f0050000-0000-4000-8000-000000000011/phase0-upload.png'$$,'42501',null,'assets cannot be moved across organizations');
reset role;
-- Defense in depth survives a future accidental broad UPDATE grant.
grant update on public.profiles to authenticated;
set local role authenticated;
select throws_ok($$update public.profiles set role='admin' where id='f0050000-0000-4000-8000-000000000003'$$,'42501',null,'trigger protects role even if broad grants return');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($$update public.profiles set role='manager' where id='f0050000-0000-4000-8000-000000000003'$$,'trusted backend can manage membership');
select lives_ok($$insert into storage.objects(bucket_id,name) values ('brand-assets','phase0-server-generated.png')$$,'trusted backend retains legacy asset upload access');
reset role;
-- Use the exact conflict target generated by PostgREST for lead engagement writes.
set local role service_role;
-- Real lead engagements require a scoped lead and a supported event type.
insert into public.leads(id,property_id,first_name,last_name,email) values
 ('f0050000-0000-4000-8000-000000000021','f0050000-0000-4000-8000-000000000011','Fixture','A','phase0-lead-a@example.invalid'),
 ('f0050000-0000-4000-8000-000000000022','f0050000-0000-4000-8000-000000000012','Fixture','B','phase0-lead-b@example.invalid');
select lives_ok($$insert into public.lead_engagement_events(lead_id,property_id,event_type,idempotency_key)
  values ('f0050000-0000-4000-8000-000000000021','f0050000-0000-4000-8000-000000000011','chat_started','phase0-event')
  on conflict (property_id,idempotency_key) do nothing$$,'engagement insert accepts the API conflict target');
select lives_ok($$insert into public.lead_engagement_events(lead_id,property_id,event_type,idempotency_key)
  values ('f0050000-0000-4000-8000-000000000021','f0050000-0000-4000-8000-000000000011','chat_started','phase0-event')
  on conflict (property_id,idempotency_key) do nothing$$,'repeated engagement delivery is accepted safely');
select is((select count(*) from public.lead_engagement_events where idempotency_key='phase0-event'),1::bigint,'repeated engagement delivery does not create a duplicate');
select lives_ok($$insert into public.lead_engagement_events(lead_id,property_id,event_type,idempotency_key)
  values ('f0050000-0000-4000-8000-000000000022','f0050000-0000-4000-8000-000000000012','chat_started','phase0-event')
  on conflict (property_id,idempotency_key) do nothing$$,'separate properties may use the same event key');
select lives_ok($$insert into public.lead_engagement_events(lead_id,property_id,event_type,idempotency_key)
  values ('f0050000-0000-4000-8000-000000000021','f0050000-0000-4000-8000-000000000011','chat_started',null),
         ('f0050000-0000-4000-8000-000000000021','f0050000-0000-4000-8000-000000000011','chat_started',null)$$,'unkeyed events remain independently insertable');
reset role;
select * from finish();
