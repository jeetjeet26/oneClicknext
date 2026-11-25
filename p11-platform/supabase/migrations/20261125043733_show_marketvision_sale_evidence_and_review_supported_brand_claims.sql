create function public.read_marketvision_sale_sources(p_property_id uuid, p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  subject_type text;
  transaction_type text;
  sources jsonb;
begin
  select p.property_type, nullif(p.settings #>> '{onboarding,transaction}', '')
    into subject_type, transaction_type
  from public.properties p
  join public.profiles u on u.org_id = p.org_id and u.id = p_actor_id
  where p.id = p_property_id;
  if not found then return '{"state":"forbidden"}'; end if;

  with latest as materialized (
    select distinct on (c.id) c.id as competitor_id, c.website_url, r.id as request_id
    from public.competitors c
    join public.marketvision_source_requests r on r.competitor_id = c.id and r.property_id = c.property_id
    where c.property_id = p_property_id and c.is_active
      and c.property_type in ('single_family', 'townhome', 'condo', 'master_planned')
      and r.state = 'received' and r.input->>'source' = 'website'
      and c.website_url = r.source_snapshot->>'sourceUrl'
      and public.marketvision_capture_current(r.id, p_property_id, c.id)
    order by c.id, r.created_at desc, r.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'competitorId', latest.competitor_id,
    'websiteUrl', latest.website_url,
    'sourceUrl', r.raw_result->>'finalUrl',
    'fetchedAt', r.raw_result->>'fetchedAt',
    'text', left(r.raw_result->>'text', 9000)
  )), '[]'::jsonb) into sources
  from latest join public.marketvision_source_requests r on r.id = latest.request_id;

  return jsonb_build_object('state', 'ready', 'propertyType', subject_type, 'transaction', transaction_type, 'sources', sources);
end;
$$;

revoke all on function public.read_marketvision_sale_sources(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_marketvision_sale_sources(uuid, uuid) to service_role;

-- Retain the original model result and admit only its exact, source-backed claims to review.
create or replace function public.prepare_marketvision_brand_preview(p_id uuid,p_result_hash text,p_preview jsonb,p_error_code text default null)returns jsonb language plpgsql security invoker set search_path=''as $$
declare entry public.marketvision_brand_requests; raw_output jsonb; supported_claims jsonb; begin
 select *into entry from public.marketvision_brand_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(entry.property_id::text,71));select *into entry from public.marketvision_brand_requests where id=p_id for update;
 if entry.preview is not null then return jsonb_build_object('state','replayed','requestState',entry.state);end if;
 if entry.state<>'result_ready'then return jsonb_build_object('state',entry.state);end if;
 if entry.result_hash is distinct from p_result_hash then return '{"state":"result_conflict"}';end if;
 if p_error_code is not null then
  if p_error_code not in('invalid_output','incomplete_output')then raise exception 'Invalid brand validation issue';end if;
  update public.marketvision_brand_requests set state='held',error_code=p_error_code,finished_at=clock_timestamp()where id=entry.id;update public.shared_jobs set lifecycle_status='failed',status_reason=p_error_code,stage='review',finished_at=clock_timestamp(),updated_at=clock_timestamp()where id=entry.id;perform public.record_marketvision_brand_event(entry,'market.brand.held','failed',jsonb_build_object('requestState','held','reason',p_error_code));return '{"state":"held"}';
 end if;
 raw_output := (entry.raw_result->>'content')::jsonb;
 if entry.raw_result->>'finishReason' is distinct from 'stop' or jsonb_typeof(raw_output->'claims') is distinct from 'array' then raise exception 'Brand preview requires a complete retained model result'; end if;
 if jsonb_array_length(raw_output->'claims') > 50 then raise exception 'Brand result contains too many candidates'; end if;
 select coalesce(jsonb_agg(claim order by ordinal), '[]'::jsonb) into supported_claims
 from jsonb_array_elements(raw_output->'claims') with ordinality as c(claim, ordinal)
 where public.valid_marketvision_brand_claim(claim, entry.model_input->'source'->>'content');
 if supported_claims = '[]'::jsonb and raw_output->'claims' <> '[]'::jsonb then raise exception 'Brand result contains no supported quotations'; end if;
 if p_preview is distinct from (raw_output || jsonb_build_object('claims', supported_claims)) or jsonb_typeof(p_preview)is distinct from 'object'or(p_preview-array['claims','notes'])<>'{}'or jsonb_typeof(p_preview->'claims')is distinct from 'array'or jsonb_array_length(p_preview->'claims')>50 or octet_length(p_preview::text)>200000 or not(p_preview?'notes')or(jsonb_typeof(p_preview->'notes')not in('null','string'))or length(coalesce(p_preview->>'notes',''))>5000 then raise exception 'Brand preview must match the complete retained model result';end if;
 if exists(select 1 from jsonb_array_elements(p_preview->'claims')c where not public.valid_marketvision_brand_claim(c,entry.model_input->'source'->>'content'))then raise exception 'Every brand statement needs exact retained source evidence';end if;
 update public.marketvision_brand_requests set state='preview_ready',preview=p_preview,preview_hash=public.crm_configuration_hash(p_preview),error_code=null where id=entry.id;
 update public.shared_jobs set lifecycle_status='failed',status_reason='brand_review_required',stage='review',progress=70,current_step='Saved brand statements await explicit source review',updated_at=clock_timestamp()where id=entry.id;
 perform public.record_marketvision_brand_event(entry,'market.brand.previewed','succeeded',jsonb_build_object('requestState','preview_ready','candidateCount',jsonb_array_length(p_preview->'claims'),'modelResultHash',entry.result_hash));return '{"state":"saved","requestState":"preview_ready"}';
end$$;
