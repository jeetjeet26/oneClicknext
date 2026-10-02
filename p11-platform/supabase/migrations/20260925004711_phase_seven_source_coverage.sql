-- Original organization is recorded only for newly created native work. No legacy ownership is inferred.
create table public.agency_native_work_origins(
 source text not null check(source in('luma_request','luma_delivery','tour_work')),
 source_id uuid not null,property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),recorded_at timestamptz not null default clock_timestamp(),
 primary key(source,property_id,source_id)
);
create index agency_work_origin_org on public.agency_native_work_origins(org_id);
create index agency_work_origin_property on public.agency_native_work_origins(property_id);
alter table public.agency_native_work_origins enable row level security;
revoke all on public.agency_native_work_origins from public,anon,authenticated,service_role;
grant select,insert,delete on public.agency_native_work_origins to service_role;
create trigger agency_work_origin_immutable before update or delete on public.agency_native_work_origins for each row execute function public.protect_shared_action_history();
create function public.capture_agency_work_origin()returns trigger language plpgsql security invoker set search_path=''as $$
declare property_id uuid;organization uuid;source_id uuid;
begin
 property_id:=(to_jsonb(new)->>'property_id')::uuid;source_id:=(to_jsonb(new)->>tg_argv[1])::uuid;
 select p.org_id into organization from public.properties p where p.id=property_id for share;
 if organization is not null then
  insert into public.agency_native_work_origins(source,source_id,property_id,org_id)values(tg_argv[0],source_id,property_id,organization)on conflict do nothing;
 end if;return new;
end$$;
create trigger agency_luma_request_origin after insert on public.luma_requests for each row execute function public.capture_agency_work_origin('luma_request','request_id');
create trigger agency_luma_delivery_origin after insert on public.luma_delivery_jobs for each row execute function public.capture_agency_work_origin('luma_delivery','id');
create trigger agency_tour_work_origin after insert on public.tour_schedule_work for each row execute function public.capture_agency_work_origin('tour_work','id');
create function public.agency_source_coverage(p_product text)returns jsonb language sql immutable security invoker set search_path=''as $$
 select jsonb_build_object('checkedSources',case p_product
 when 'siteforge'then array['website_incident']
 when 'forgestudio'then array['social_publication']
 when 'reviewflow'then array['review_publication']
 when 'marketvision'then array['market_source','market_extraction','market_brand']
 when 'knowledge'then array['knowledge_search']
 when 'bi'then array['report_delivery']
 when 'crm'then array['crm_transfer']
 when 'lumaleasing'then array['luma_request','luma_delivery']
 when 'tourspark'then array['tour_work','tour_reminder']
 when 'brandforge'then array['brand_import']
 when 'property'then array['unit_import']
 when 'integrations'then array['integration_authorization']
 when 'reports'then array['report_schedule']
 when 'pipelines'then array['pipeline_recovery']
 when 'propertyaudit'then array['audit_invocation']
 else array[]::text[]end,'scope',case when p_product in('lumaleasing','tourspark')then'new_work_only'when p_product in('settings','team')then'account_or_org'when p_product in('leadpulse','platform')then'recorded_actions'else'native_work'end,
 'detail',case when p_product in('lumaleasing','tourspark')then'Includes work created after organization recording was installed. Earlier work without original organization evidence is excluded; inspect the product for its full history.'
 when p_product in('settings','team')then'Personal account and organization-wide work is reviewed in its own product; it is outside this property-scoped board.'
 when p_product='leadpulse'then'Scoring actions and results are recorded. The scoring workflow has no separately qualified persistent hold or unconfirmed-result state for this board.'
 when p_product='platform'then'Console-wide activity is available in Activity history; no additional property work source is inferred.'
 else'Only the listed saved states are checked. This does not establish full product coverage or provider health.'end)
$$;
create or replace function public.agency_current_work(p_property_id uuid,p_org_id uuid,p_product text)
returns table(source text,id uuid,category text,state text,version_token text,opened_at timestamptz,changed_at timestamptz)
language sql stable security invoker set search_path='' as $$
 select 'website_incident',r.id,'incident',r.status,md5(jsonb_build_array(r.status,r.severity,r.updated_at)::text),r.created_at,r.updated_at
 from public.siteforge_incidents r where p_product='siteforge' and r.property_id=p_property_id and r.org_id=p_org_id and r.status in('open','acknowledged','repairing')
 union all
 select 'social_publication',r.id,'unconfirmed',r.status,md5(jsonb_build_array(r.status,r.updated_at)::text),r.created_at,r.updated_at
 from public.social_publications r where p_product='forgestudio' and r.property_id=p_property_id and r.org_id=p_org_id and r.status='reconciling'
 union all
 select 'review_publication',r.id,case when r.state='held'then'unconfirmed'else'held'end,r.state,r.version::text,r.created_at,r.updated_at
 from public.reviewflow_publications r where p_product='reviewflow' and r.property_id=p_property_id and r.org_id=p_org_id and r.state in('held','awaiting_confirmation')
 union all
 select 'market_source',r.id,'held',r.state,r.version::text,r.created_at,r.updated_at
 from public.marketvision_source_requests r where p_product='marketvision' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'market_extraction',r.id,'held',r.state,r.version::text,r.created_at,r.updated_at
 from public.marketvision_extraction_requests r where p_product='marketvision' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'market_brand',r.id,'held',r.state,r.version::text,r.created_at,r.updated_at
 from public.marketvision_brand_requests r where p_product='marketvision' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'knowledge_search',r.id,'held',r.state,r.revision::text,r.created_at,r.updated_at
 from public.knowledge_embedding_requests r where p_product='knowledge' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'report_delivery',r.id,'unconfirmed',r.state,md5(jsonb_build_array(r.state,r.closed,r.updated_at)::text),r.attempted_at,r.updated_at
 from public.bi_schedule_deliveries r where p_product='bi' and r.property_id=p_property_id and r.org_id=p_org_id and r.state='unknown' and not r.closed
 union all
 -- CRM transfers predate an org column; the immutable shared job retains the original organization.
 select 'crm_transfer',r.id,'unconfirmed',r.state,r.revision::text,r.requested_at,null::timestamptz
 from public.crm_handoffs r join public.shared_jobs j on j.id=r.job_id and j.property_id=r.property_id and j.org_id=p_org_id
 where p_product='crm' and r.property_id=p_property_id and r.state='needs_reconciliation'
 union all
 select 'luma_request',r.request_id,'held',r.state,md5(jsonb_build_array(r.state,r.expires_at,r.http_status)::text),r.created_at,null::timestamptz
 from public.luma_requests r join public.agency_native_work_origins o on o.source='luma_request'and o.source_id=r.request_id and o.property_id=r.property_id and o.org_id=p_org_id
 where p_product='lumaleasing'and r.property_id=p_property_id and r.state='review'
 union all
 select 'luma_delivery',r.id,'held',r.state,md5(jsonb_build_array(r.state,r.attempts,r.calendar_confirmed,r.email_confirmed,r.schedule_version)::text),r.created_at,null::timestamptz
 from public.luma_delivery_jobs r join public.agency_native_work_origins o on o.source='luma_delivery'and o.source_id=r.id and o.property_id=r.property_id and o.org_id=p_org_id
 where p_product='lumaleasing'and r.property_id=p_property_id and r.state='review'
 union all
 select 'tour_work',r.id,'held',r.state,md5(jsonb_build_array(r.state,r.attempts,r.schedule_version,r.completed_at,r.dispatch,r.receipt)::text),r.created_at,r.completed_at
 from public.tour_schedule_work r join public.agency_native_work_origins o on o.source='tour_work'and o.source_id=r.id and o.property_id=r.property_id and o.org_id=p_org_id
 where p_product='tourspark'and r.property_id=p_property_id and r.state='review'
 union all
 select 'tour_reminder',r.id,'unconfirmed',r.state,md5(jsonb_build_array(r.state,r.attempts,r.started_at,r.accepted_at)::text),r.started_at,r.accepted_at
 from public.tour_reminder_channels r join public.tour_schedule_work w on w.id=r.work_id
 join public.agency_native_work_origins o on o.source='tour_work'and o.source_id=w.id and o.property_id=w.property_id and o.org_id=p_org_id
 where p_product='tourspark'and w.property_id=p_property_id and r.state='review'
 union all
 select 'brand_import',r.id,'held',r.status,md5(jsonb_build_array(r.status,r.content_hash,r.updated_at)::text),r.created_at,r.updated_at
 from public.property_brand_imports r where p_product='brandforge'and r.property_id=p_property_id and r.org_id=p_org_id and r.status='needs_review'
 union all
 select 'unit_import',r.id,'held',r.status,md5(jsonb_build_array(r.status,r.updated_at)::text),r.created_at,r.updated_at
 from public.property_unit_imports r where p_product='property'and r.property_id=p_property_id and r.org_id=p_org_id and r.status='confirmed'
 union all
 select 'integration_authorization',r.id,'held',r.status,md5(jsonb_build_array(r.status,r.finished_at,r.expires_at)::text),r.created_at,r.finished_at
 from public.integration_authorizations r where p_product='integrations'and r.property_id=p_property_id and r.org_id=p_org_id and r.status='blocked'and r.expires_at>statement_timestamp()
 union all
 select 'report_schedule',r.id,'held',r.state,md5(jsonb_build_array(r.state,r.finished_at,r.schedule_revision)::text),r.created_at,r.finished_at
 from public.bi_schedule_runs r where p_product='reports'and r.property_id=p_property_id and r.org_id=p_org_id and r.state='held'
 union all
 select 'pipeline_recovery',r.id,'held',r.status,r.revision::text,r.created_at,r.completed_at
 from public.import_jobs r where p_product='pipelines'and r.property_id=p_property_id and r.requested_org_id=p_org_id and r.status='failed'
 and not exists(select 1 from public.import_jobs retry where retry.retry_of=r.id and retry.property_id=p_property_id and retry.requested_org_id=p_org_id)
 union all
 select 'audit_invocation',r.id,'unconfirmed',r.state,md5(jsonb_build_array(r.state,r.started_at,r.applied,r.lease_token,j.lease_until)::text),r.started_at,r.returned_at
 from public.geo_provider_invocations r join public.geo_execution_jobs j on j.run_id=r.run_id and j.property_id=r.property_id
 where p_product='propertyaudit'and r.property_id=p_property_id and r.org_id=p_org_id and r.state='started'and not r.applied and j.lease_until<statement_timestamp()
$$;

create or replace function public.agency_work_summary(p_property_id uuid,p_org_id uuid,p_product text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with rows as materialized(select * from public.agency_current_work(p_property_id,p_org_id,p_product))
 select jsonb_build_object(
  'coverage',public.agency_source_coverage(p_product),'checkedSources',public.agency_source_coverage(p_product)->'checkedSources',
  'total',count(*),'heldCount',count(*)filter(where category='held'),'unconfirmedCount',count(*)filter(where category='unconfirmed'),
  'incidentCount',count(*)filter(where category='incident'),'oldestOpenedAt',min(opened_at),
  'fingerprint',md5(coalesce(string_agg(to_jsonb(rows)::text,','order by source,id),'')),
  'items',coalesce((select jsonb_agg(to_jsonb(r)order by r.opened_at nulls first,r.source,r.id)from
   (select * from rows order by opened_at nulls first,source,id limit 5)r),'[]'::jsonb)
 )from rows
$$;

create or replace function public.agency_observation_evidence(p_property_id uuid,p_org_id uuid,p_product text)
 returns jsonb language sql stable security invoker set search_path='' as $$
 with bounds as(select (date_trunc('day',statement_timestamp() at time zone 'UTC')-interval '6 days') at time zone 'UTC' as since),
 events as materialized(
  select e.id,e.episode_id,e.action,e.phase,e.evidence,e.created_at from public.shared_action_events e,bounds b
  where e.property_id=p_property_id and e.org_id=p_org_id and e.product=p_product
    and e.created_at>=b.since and e.created_at<=statement_timestamp()
 ), facts as(select jsonb_build_object(
  'ruleVersion','recorded-work-v3','propertyId',p_property_id,'orgId',p_org_id,'product',p_product,
  'windowStart',(select since from bounds),
  'confirmedCount',count(*) filter(where evidence='server_confirmed'),
  'failedCount',count(*) filter(where evidence='server_confirmed' and phase='failed'),
  'latestConfirmedAt',max(created_at) filter(where evidence='server_confirmed'),
  'eventFingerprint',md5(coalesce(string_agg(id::text,',' order by id) filter(where evidence='server_confirmed'),'')),
  'failures',coalesce((select jsonb_agg(to_jsonb(f) order by f."recordedAt" desc,f."eventId" desc) from
    (select id as "eventId",episode_id as "episodeId",action,created_at as "recordedAt" from events
     where evidence='server_confirmed' and phase='failed' order by created_at desc,id desc limit 5) f),'[]'::jsonb)
 ) as value, count(*) filter(where evidence='browser_observed') as observations from events),
 combined as(select value||jsonb_build_object('currentWork',public.agency_work_summary(p_property_id,p_org_id,p_product)) as value,observations from facts)
 select value||jsonb_build_object('sourceHash',encode(extensions.digest(value::text,'sha256'),'hex'),
  'observedCount',observations,'capturedAt',statement_timestamp()) from combined
$$;

revoke all on function public.capture_agency_work_origin(),public.agency_source_coverage(text)from public,anon,authenticated;
grant execute on function public.capture_agency_work_origin(),public.agency_source_coverage(text)to service_role;
notify pgrst,'reload schema';
