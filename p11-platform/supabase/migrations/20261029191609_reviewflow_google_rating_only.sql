-- Preserve ratings without inventing written review text. All access and receipt checks remain intact.
create or replace function public.preview_reviewflow_intake(p_id uuid,p_result_hash text,p_normalized jsonb,p_error text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.reviewflow_intake_requests;item jsonb;existing public.reviews;manifest jsonb:='[]';kind text;seen_ids uuid[]:='{}';begin
 select * into run from public.reviewflow_intake_requests where id=p_id;if not found then return '{"state":"not_found"}';end if;perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));select * into run from public.reviewflow_intake_requests where id=p_id for update;
 if run.state<>'result_ready' then return jsonb_build_object('state',run.state,'requestId',run.id);end if;
 if p_result_hash is distinct from run.result_hash then return '{"state":"result_conflict"}';end if;
 if not public.reviewflow_intake_authorized(run) then return public.reviewflow_intake_hold(run,'source_or_access_changed','The source or access changed after this receipt was saved.');end if;
 if p_error is not null then return public.reviewflow_intake_hold(run,'invalid_source',p_error);end if;
 if p_normalized->>'contractVersion' is distinct from 'review-intake-v1' or jsonb_typeof(p_normalized->'reviews') is distinct from 'array' or jsonb_array_length(p_normalized->'reviews')>500 or p_normalized->>'sourceHash' is distinct from encode(extensions.digest(convert_to(run.raw_result->>'content','UTF8'),'sha256'),'hex') or p_normalized->>'retrievalMethod' not in('provider_api','scraper','manual','csv_import') or p_normalized->>'completeness' not in('complete','sample','degraded','unknown') then raise exception 'The preview does not match the saved receipt';end if;
 for item in select value from jsonb_array_elements(p_normalized->'reviews') loop
  if coalesce(item->>'platform','') not in('google','yelp','apartments_com','facebook','other') or length(coalesce(item->>'platformReviewId','')) not between 1 and 500 or (length(trim(coalesce(item->>'reviewText','')))>20000 or (length(trim(coalesce(item->>'reviewText','')))=0 and not (run.kind='source' and item->>'platform'='google' and item->>'rating' is not null))) or length(coalesce(item->>'reviewerName',''))>300 or(item->>'rating' is not null and (item->>'rating')::integer not between 1 and 5) or(item->>'fingerprint')!~'^[a-f0-9]{64}$' then raise exception 'Invalid normalized review row';end if;
  if run.kind='source' and item->>'platform' is distinct from run.source_snapshot->>'platform' then raise exception 'Source platform mismatch';end if;
  select * into existing from public.reviews where property_id=run.property_id and platform=item->>'platform' and platform_review_id=item->>'platformReviewId' for update;
  -- Older manual imports hashed an omitted author as blank instead of Anonymous.
  if existing.id is null and item->>'identityBasis'='content_fingerprint' then
   select * into existing from public.reviews where property_id=run.property_id and platform=item->>'platform' and platform_review_id='fp-'||left(item->>'legacyFingerprint',24) for update;
  end if;
  if existing.id=any(seen_ids) then raise exception 'Two source rows resolve to the same saved review';end if;
  if existing.id is not null then seen_ids:=array_append(seen_ids,existing.id);end if;
  kind:=case when existing.id is null then 'inserted' when(existing.review_text,existing.rating,coalesce(existing.reviewer_name,'Anonymous'),existing.review_date,existing.reviewer_avatar_url) is distinct from(item->>'reviewText',(item->>'rating')::integer,item->>'reviewerName',(item->>'reviewDate')::timestamptz,item->>'reviewerAvatarUrl') then 'updated' else 'unchanged' end;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('reviewId',existing.id,'sourceVersion',existing.source_version,'beforeHash',case when existing.id is not null then public.crm_configuration_hash(to_jsonb(existing)-'updated_at'-'last_observed_at'-'sentiment'-'sentiment_score'-'topics'-'is_urgent'-'response_status') end,'changeKind',kind));
 end loop;
 update public.reviewflow_intake_requests set normalized=p_normalized,preview=manifest,state='preview' where id=p_id returning * into run;
 update public.shared_jobs set lifecycle_status='queued',status_reason='intake_preview_ready',stage='review',progress=50,current_step='Review saved rows before applying the import',updated_at=clock_timestamp() where id=p_id;
 perform public.record_reviewflow_intake_system(run,'review.intake.previewed','succeeded',jsonb_build_object('requestState','preview','rowCount',jsonb_array_length(manifest),'resultHash',run.result_hash));return jsonb_build_object('state','preview','requestId',run.id,'version',run.version);
end$$;
