-- Use the shared public-fetch limit for MarketVision page bodies. The receipt
-- still has to contain the exact response and pass its existing integrity checks.
CREATE OR REPLACE FUNCTION public.record_marketvision_source_result(p_id uuid, p_claim_token uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare r public.marketvision_source_requests;next_state text;issue text;capture uuid;fetched timestamptz;
begin
 select * into r from public.marketvision_source_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.property_id::text,71));select * into r from public.marketvision_source_requests where id=p_id for update;
 if p_claim_token is null or r.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if jsonb_typeof(p_result)is distinct from 'object'or length(p_result::text)>2500000 or p_result->>'status'not in('received','failed','uncertain')or p_result->>'status'is null then raise exception 'Review the complete source receipt';end if;
 if r.raw_result is not null then
  if r.raw_result is distinct from p_result then return '{"state":"result_conflict"}';end if;
  return jsonb_build_object('state','replayed','requestState',r.state);
 end if;
 if p_result->>'status'='received'then
  fetched:=(p_result->>'fetchedAt')::timestamptz;
  if fetched is null or fetched<r.started_at-interval '1 minute'or fetched>now()+interval '5 minutes'or
   p_result->>'requestedUrl'is distinct from r.source_snapshot->>'sourceUrl'or p_result->>'parserVersion'is distinct from 'public-html-v1'or
   p_result->>'transport'is distinct from 'public_http_v1'or (p_result->>'statusCode')::integer not between 200 and 299 or p_result->>'statusCode'is null or
   length(coalesce(p_result->>'finalUrl',''))not between 10 and 2000 or length(coalesce(p_result->>'text',''))not between 50 and 50000 or
   coalesce(p_result->>'body','') = '' or p_result->>'bodyHash'is distinct from encode(sha256(convert_to(p_result->>'body','UTF8')),'hex') then raise exception 'Retain the exact fetched page, source identity, parser and hash';end if;
 end if;
 issue:=case when p_result->>'status'='received'then null else coalesce(p_result->>'errorCode','source_unconfirmed')end;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=r.property_id and p.org_id=r.org_id and u.id=r.actor_id)then issue:='source_or_access_changed';end if;
 next_state:=case when r.state='stopped'then 'stopped'when issue is null then 'received'else 'held'end;
 if next_state='received'then
  capture:=r.id;
  insert into public.market_source_captures(id,property_id,competitor_id,source_type,source_url,content_hash,raw_ref,status,captured_at,effective_at)
  values(capture,r.property_id,r.competitor_id,r.input->>'source',p_result->>'finalUrl',p_result->>'bodyHash','marketvision_source_requests:'||r.id::text,'captured',fetched,null);
 end if;
 update public.marketvision_source_requests set state=next_state,raw_result=p_result,result_hash=public.crm_configuration_hash(p_result),capture_id=capture,error_code=issue,finished_at=clock_timestamp()where id=r.id;
 if next_state<>'stopped'then update public.shared_jobs set lifecycle_status=case when next_state='received'then 'succeeded'else 'failed'end,status_reason=case when next_state='received'then 'public_source_retained'else issue end,stage='completed',progress=100,finished_at=clock_timestamp(),updated_at=clock_timestamp(),current_step=case when next_state='received'then 'Public page retained; prices await a separate review'else 'Source fetch needs attention'end where id=r.id;end if;
 perform public.record_marketvision_source_event(r,'market.source.result_received',case when next_state='received'then 'succeeded'else 'failed'end,jsonb_build_object('requestState',next_state,'resultHash',public.crm_configuration_hash(p_result),'captureId',capture,'pricesApplied',false));
 return jsonb_build_object('state','saved','requestState',next_state,'captureId',capture);
end$function$;
