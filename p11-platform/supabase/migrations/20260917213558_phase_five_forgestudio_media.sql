-- Private media evidence. Provider calls are never retried by this protocol.
create table public.forgestudio_media_requests(
 id uuid primary key references public.shared_jobs(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid references public.profiles(id),
 input jsonb not null,
 source_snapshot jsonb,
 state text not null check(state in('legacy','queued','claimed','generating','result_ready','completed','uncertain','failed','stopped')),
 claim_token uuid,
 worker text,
 lease_expires_at timestamptz,
 model_started_at timestamptz,
 result_manifest jsonb,
 asset_id uuid references public.content_assets(id) deferrable initially deferred,
 error_code text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index forgestudio_media_property on public.forgestudio_media_requests(property_id,created_at desc,id desc);
create index forgestudio_media_org on public.forgestudio_media_requests(org_id);
create index forgestudio_media_actor on public.forgestudio_media_requests(actor_id);
create index forgestudio_media_asset on public.forgestudio_media_requests(asset_id);
create table public.forgestudio_media_receipts(
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.forgestudio_media_requests(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 kind text not null check(kind in('model_intent','result_manifest','completed','failure','stopped')),
 evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,kind)
);
create index forgestudio_media_receipts_property on public.forgestudio_media_receipts(property_id);
alter table public.forgestudio_media_requests enable row level security;
alter table public.forgestudio_media_receipts enable row level security;
revoke all on public.forgestudio_media_requests,public.forgestudio_media_receipts from public,anon,authenticated;
grant all on public.forgestudio_media_requests to service_role;
grant select,insert,delete on public.forgestudio_media_receipts to service_role;
create policy forgestudio_media_requests_service on public.forgestudio_media_requests for all to service_role using(true) with check(true);
create policy forgestudio_media_receipts_service on public.forgestudio_media_receipts for all to service_role using(true) with check(true);
create trigger forgestudio_media_receipt_immutable before update or delete on public.forgestudio_media_receipts for each row execute function public.guard_forgestudio_publication_receipt();
insert into public.forgestudio_media_requests(id,property_id,org_id,input,state,created_at,updated_at,error_code)
 select id,property_id,org_id,coalesce(payload,'{}'),'legacy',created_at,updated_at,'legacy_evidence_unqualified' from public.shared_jobs where domain='forgestudio.media' and property_id is not null;
insert into storage.buckets(id,name,public,file_size_limit) values('forgestudio-media-results','forgestudio-media-results',false,104857600) on conflict(id) do nothing;

create function public.guard_forgestudio_media_request() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.properties where id=old.property_id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'Saved media requests are retained';end if;
 if (new.id,new.property_id,new.org_id,new.actor_id,new.input,new.source_snapshot) is distinct from (old.id,old.property_id,old.org_id,old.actor_id,old.input,old.source_snapshot)
 or (old.model_started_at is not null and (new.model_started_at,new.claim_token) is distinct from (old.model_started_at,old.claim_token))
 or (old.result_manifest is not null and new.result_manifest is distinct from old.result_manifest)
 or (old.state in('completed','stopped') and new.state<>old.state) then raise exception 'Media input, output and terminal decisions are immutable';end if;return new;
end;$$;
create trigger forgestudio_media_request_immutable before update or delete on public.forgestudio_media_requests for each row execute function public.guard_forgestudio_media_request();

create function public.begin_forgestudio_media(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;organization uuid;source public.content_assets;snapshot jsonb;request jsonb:=p_input->'request';begin
 result:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'media.requested',request);if result->>'state'<>'new' then return result;end if;
 if request->>'modality' not in('image','video') or length(coalesce(request->>'prompt','')) not between 10 and 4000 or length(coalesce(request->>'name','')) not between 1 and 200 or nullif(p_input->>'model','') is null or (p_input->>'estimatedCostUsd')::numeric<0 or (p_input->>'estimatedCostUsd')::numeric>(request->>'maxCostUsd')::numeric then raise exception 'Invalid media request';end if;
 select org_id into organization from public.properties where id=p_property_id;
 if nullif(request->>'sourceAssetId','') is not null then
  select * into source from public.content_assets where id=(request->>'sourceAssetId')::uuid and property_id=p_property_id for share;
  if not found or source.asset_type<>'image' or source.approval_status<>'approved' or source.archived_at is not null or source.duplicate_of is not null or source.file_url not like 'https://%' then return '{"state":"source_unavailable"}';end if;
  snapshot:=public.read_forgestudio_source_record(p_property_id,'asset',source.id);
 end if;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,lifecycle_status,status_reason,dedupe_key,payload,max_attempts,stage,progress,current_step)
 values(p_id,organization,p_property_id,'forgestudio.media','generated_content_asset','queued','media_request_saved','forgestudio-media:'||p_id,jsonb_build_object('requestId',p_id,'modality',request->>'modality'),1,'queued',0,'Waiting to generate');
 insert into public.forgestudio_media_requests(id,property_id,org_id,actor_id,input,source_snapshot,state)values(p_id,p_property_id,organization,p_actor_id,p_input,snapshot,'queued');
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'media.requested',request,null,jsonb_build_object('state','queued'),jsonb_build_object('jobId',p_id,'estimatedCostUsd',p_input->'estimatedCostUsd','model',p_input->>'model'),jsonb_build_object('jobId',p_id));
end;$$;

create function public.claim_forgestudio_media(p_worker text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_media_requests;begin
 if length(trim(coalesce(p_worker,''))) not between 1 and 200 then raise exception 'Worker identity required';end if;
 -- No model intent may be replayed, even after a worker lease expires.
 select candidate.* into run from public.forgestudio_media_requests candidate where (candidate.state='queued' or(candidate.state='claimed' and candidate.lease_expires_at<clock_timestamp() and candidate.model_started_at is null)) and exists(select 1 from public.properties p where p.id=candidate.property_id and p.org_id=candidate.org_id) order by candidate.created_at,candidate.id limit 1 for update skip locked;
 if not found then return '{"state":"empty"}';end if;
 update public.forgestudio_media_requests set state='claimed',claim_token=gen_random_uuid(),worker=p_worker,lease_expires_at=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp() where id=run.id returning * into run;
 update public.shared_jobs set lifecycle_status='running',stage='preparing',status_reason='media_claimed',lease_owner=p_worker,lease_expires_at=run.lease_expires_at,attempt_count=attempt_count+1,started_at=coalesce(started_at,clock_timestamp()),updated_at=clock_timestamp() where id=run.id;
 return jsonb_build_object('state','claimed','request',to_jsonb(run));
end;$$;

create function public.advance_forgestudio_media(p_id uuid,p_claim_token uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_media_requests;current_source jsonb;begin
 select * into run from public.forgestudio_media_requests where id=p_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));
 select * into run from public.forgestudio_media_requests where id=p_id for update;
 if p_claim_token is null or run.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if p_action='result_manifest' then
  if run.model_started_at is null then return '{"state":"intent_required"}';end if;
  if run.result_manifest is not null then
   if run.result_manifest=p_payload then return '{"state":"replayed"}';else return '{"state":"result_conflict"}';end if;
  end if;
  if coalesce(p_payload->>'contentHash','')!~'^[a-f0-9]{64}$' or coalesce((p_payload->>'size')::bigint,0) not between 1 and 104857600 or p_payload->>'mimeType' not in('image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm') or p_payload->>'extension' is distinct from (case p_payload->>'mimeType' when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp' when 'image/gif' then 'gif' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end) or (run.input->'request'->>'modality'='image' and p_payload->>'mimeType' not like 'image/%') or (run.input->'request'->>'modality'='video' and p_payload->>'mimeType' not like 'video/%') or length(p_payload::text)>65536 then raise exception 'Invalid media result manifest';end if;
  insert into public.forgestudio_media_receipts(request_id,property_id,kind,evidence)values(run.id,run.property_id,'result_manifest',p_payload||jsonb_build_object('origin','model_response'));
  update public.forgestudio_media_requests set result_manifest=p_payload,state=case when state='stopped' then state else 'result_ready' end,error_code=null,updated_at=clock_timestamp() where id=run.id;
  if run.state<>'stopped' then update public.shared_jobs set lifecycle_status='failed',stage='storing',status_reason='media_result_saved',current_step='Generated file awaits storage confirmation',lease_owner=null,lease_expires_at=null,updated_at=clock_timestamp() where id=run.id;end if;
  return '{"state":"saved"}';
 end if;
 if run.state in('completed','stopped') then return jsonb_build_object('state',run.state);end if;
 if p_action='failure' then
  if run.result_manifest is not null then return '{"state":"result_ready"}';end if;
  if p_payload->>'code' not in('source_changed','access_changed','model_uncertain','invalid_result','preparation_failed') then raise exception 'Invalid media failure';end if;
  insert into public.forgestudio_media_receipts(request_id,property_id,kind,evidence)values(run.id,run.property_id,'failure',jsonb_build_object('code',p_payload->>'code','origin','media_worker')) on conflict(request_id,kind) do nothing;
  update public.forgestudio_media_requests set state=case when model_started_at is null then 'failed' else 'uncertain' end,error_code=p_payload->>'code',updated_at=clock_timestamp() where id=run.id;
  update public.shared_jobs set lifecycle_status='failed',stage='review',status_reason=p_payload->>'code',current_step='Review saved media request',lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
  return '{"state":"saved"}';
 end if;
 if p_action<>'model_intent' then raise exception 'Unsupported media transition';end if;
 if run.model_started_at is not null then return '{"state":"already_started"}';end if;
 if run.state<>'claimed' or run.lease_expires_at<=clock_timestamp() then return '{"state":"claim_expired"}';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=run.property_id and p.org_id=run.org_id and u.id=run.actor_id) then return '{"state":"access_changed"}';end if;
 if run.source_snapshot is not null then
  current_source:=public.read_forgestudio_source_record(run.property_id,'asset',(run.input->'request'->>'sourceAssetId')::uuid);
  if (current_source-array['rights_status','rights_metadata','expires_at','curation_status']) is distinct from (run.source_snapshot-array['rights_status','rights_metadata','expires_at','curation_status']) then return '{"state":"source_changed"}';end if;
 end if;
 insert into public.forgestudio_media_receipts(request_id,property_id,kind,evidence)values(run.id,run.property_id,'model_intent',jsonb_build_object('inputHash',public.crm_configuration_hash(run.input),'sourceHash',public.crm_configuration_hash(coalesce(run.source_snapshot,'{}')),'model',run.input->>'model','estimatedCostUsd',run.input->'estimatedCostUsd','requestedBy',run.actor_id,'origin','media_worker'));
 update public.forgestudio_media_requests set model_started_at=clock_timestamp(),state='generating',updated_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set stage='generating',progress=20,current_step='Generating media once',updated_at=clock_timestamp() where id=run.id;
 return '{"state":"proceed_once"}';
end;$$;

create function public.finish_forgestudio_media(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_media_requests;asset public.content_assets;request jsonb;manifest jsonb;recorded jsonb;event_id uuid;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into run from public.forgestudio_media_requests where id=p_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if not exists(select 1 from public.properties where id=p_property_id and org_id=run.org_id) then return '{"state":"forbidden"}';end if;
 if run.state='completed' then return jsonb_build_object('state','replayed','assetId',run.asset_id);end if;
 if run.state='stopped' then return '{"state":"stopped"}';end if;
 if run.state<>'result_ready' or run.result_manifest is null then return '{"state":"result_required"}';end if;
 manifest:=run.result_manifest;request:=run.input->'request';
 if p_payload->>'contentHash' is distinct from manifest->>'contentHash' or p_payload->>'storagePath' is distinct from (run.property_id||'/forgestudio/generated/'||run.id||'.'||(manifest->>'extension')) or p_payload->>'storageBucket' is distinct from 'property-assets' or p_payload->>'storageVerified' is distinct from 'true' or coalesce(p_payload->>'fileUrl','')!~'^https?://' then raise exception 'Verified generated file required';end if;
 insert into public.content_assets(id,org_id,property_id,uploaded_by,source_identity,format,file_size_bytes,asset_type,name,description,file_url,storage_bucket,storage_path,content_hash,width,height,alt_text,is_ai_generated,generation_provider,generation_prompt,generation_params,rights_status,approval_status,curation_status,folder,tags,duration_seconds)
 values(run.id,run.org_id,run.property_id,run.actor_id,'forgestudio:media:'||run.id,manifest->>'extension',(manifest->>'size')::bigint,case when request->>'modality'='video' then 'video' else case when manifest->>'extension'='gif' then 'gif' else 'image' end end,request->>'name',request->>'prompt',p_payload->>'fileUrl','property-assets',p_payload->>'storagePath',manifest->>'contentHash',(manifest->>'width')::integer,(manifest->>'height')::integer,request->>'altText',true,run.input->>'model',request->>'prompt',jsonb_build_object('requestId',run.id,'modelPolicyVersion',run.input->>'modelPolicyVersion','estimatedCostUsd',run.input->'estimatedCostUsd','sourceAssetId',request->>'sourceAssetId'),'generated','pending','needs_review','Generated media',array['ai-generated','forgestudio',request->>'modality'],case when request->>'modality'='video' then (request->>'durationSeconds')::numeric end) returning * into asset;
 insert into public.brand_asset_revisions(asset_id,revision,property_id,snapshot)values(asset.id,asset.governance_revision,asset.property_id,to_jsonb(asset));
 insert into public.forgestudio_media_receipts(request_id,property_id,kind,evidence)values(run.id,run.property_id,'completed',jsonb_build_object('assetId',asset.id,'contentHash',asset.content_hash,'requestedBy',run.actor_id,'savedBy',p_actor_id,'origin','media_result_storage'));
 update public.forgestudio_media_requests set state='completed',asset_id=asset.id,error_code=null,updated_at=clock_timestamp() where id=run.id;
 update public.shared_jobs set lifecycle_status='succeeded',stage='completed',progress=100,status_reason='media_saved_pending_review',current_step='Saved for usage review',output=jsonb_build_object('assetId',asset.id,'publicUrl',asset.file_url),lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
 event_id:=md5(run.id::text||':media.completed')::uuid;
 recorded:=public.append_shared_action_event(event_id,event_id,p_property_id,p_actor_id,'forgestudio','studio.media.completed','server_confirmed','succeeded',jsonb_build_object('jobId',run.id),jsonb_build_object('state',run.state),jsonb_build_object('state','completed'),jsonb_build_object('jobId',run.id,'assetId',asset.id,'contentHash',asset.content_hash,'origin',coalesce(p_payload->>'origin','media_worker'),'requestedBy',run.actor_id,'savedBy',p_actor_id),jsonb_build_object('jobId',run.id));
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Media completion history could not be saved';end if;
 return jsonb_build_object('state','saved','assetId',asset.id);
end;$$;

create function public.decide_forgestudio_media(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;run public.forgestudio_media_requests;decision jsonb:=p_payload-'storage';kind text;begin
 kind:=case when p_payload->>'action'='stop' then 'media.stopped' when p_payload->>'action'='recover' then 'media.recovered' end;
 if kind is null or length(trim(coalesce(p_payload->>'reason',''))) not between 3 and 2000 then raise exception 'Explain this media decision';end if;
 result:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,kind,decision);if result->>'state'<>'new' then return result;end if;
 select * into run from public.forgestudio_media_requests where id=(p_payload->>'jobId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if run.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then return '{"state":"stale_request"}';end if;
 if kind='media.stopped' then
  if run.state in('completed','stopped') then return jsonb_build_object('state',run.state);end if;
  insert into public.forgestudio_media_receipts(request_id,property_id,kind,evidence)values(run.id,run.property_id,'stopped',jsonb_build_object('actorId',p_actor_id,'reason',p_payload->>'reason','providerCancellationConfirmed',false,'origin','console'));
  update public.forgestudio_media_requests set state='stopped',updated_at=clock_timestamp() where id=run.id;
  update public.shared_jobs set lifecycle_status='cancelled',stage='stopped',status_reason='media_stopped',cancel_requested=true,lease_owner=null,lease_expires_at=null,finished_at=clock_timestamp(),updated_at=clock_timestamp() where id=run.id;
  result:=jsonb_build_object('jobId',run.id,'mediaState','stopped','providerCancellationConfirmed',false);
 else
  result:=public.finish_forgestudio_media(run.id,p_property_id,p_actor_id,p_payload->'storage');if result->>'state' not in('saved','replayed') then return result;end if;
  result:=result-'state'||jsonb_build_object('jobId',run.id,'mediaState','completed');
 end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,kind,decision,jsonb_build_object('state',run.state),jsonb_build_object('state',result->>'mediaState'),result,jsonb_build_object('jobId',run.id));
end;$$;

create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.%' then
  if p_product<>'leadpulse' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid scoring evidence';end if;
 elsif p_action like 'brand.%' then
  if p_product<>'brandforge' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid brand evidence';end if;
 elsif p_action in ('luma.configuration.created','luma.configuration.saved') then
  if p_product<>'lumaleasing' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid configuration evidence';end if;
 else
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid workflow evidence';end if;
 end if;
 select p.org_id into organization from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id;
 if organization is null then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 job:=nullif(p_links->>'jobId','')::uuid;attempt:=nullif(p_links->>'attemptId','')::uuid;context_id:=nullif(p_links->>'contextId','')::uuid;
 select * into e from public.shared_action_events where id=p_id;
 if found then
  if (e.episode_id,e.property_id,e.actor_id,e.product,e.action,e.evidence,e.phase,e.request,e.before_state,e.after_state,e.result,e.shared_job_ref,e.shared_attempt_ref,e.context_snapshot_ref)
   is distinct from (p_episode_id,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','eventId',e.id);
 end if;
 if job is not null and not exists(select 1 from public.shared_jobs where id=job and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 if attempt is not null and not exists(select 1 from public.shared_action_attempts where id=attempt and org_id=organization and property_id=p_property_id and (job is null or job_id=job)) then return '{"state":"link_conflict"}';end if;
 if context_id is not null and not exists(select 1 from public.shared_context_snapshots where id=context_id and org_id=organization and property_id=p_property_id) then return '{"state":"link_conflict"}';end if;
 origin:=case when p_action='studio.media.completed' then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create or replace function public.guard_forgestudio_library_asset() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='UPDATE' then
  if current_user in('anon','authenticated') and (new.folder,new.is_favorite,new.archived_at,new.archived_by,new.archive_reason,new.replacement_asset_id) is distinct from (old.folder,old.is_favorite,old.archived_at,old.archived_by,old.archive_reason,old.replacement_asset_id) then raise exception 'Library changes require the recorded service';end if;
  if new.replacement_asset_id is not null and (new.replacement_asset_id=new.id or not exists(select 1 from public.content_assets where id=new.replacement_asset_id and property_id=new.property_id)) then raise exception 'Replacement asset must belong to the same property';end if;
 end if;
 if exists(select 1 from public.properties where id=old.property_id) and (exists(select 1 from public.forgestudio_asset_uploads where asset_id=old.id and state='completed') or exists(select 1 from public.forgestudio_media_requests where asset_id=old.id and state='completed')) and (tg_op='DELETE' or (new.file_url,new.content_hash,new.storage_bucket,new.storage_path,new.asset_type) is distinct from (old.file_url,old.content_hash,old.storage_bucket,old.storage_path,old.asset_type)) then raise exception 'Archive this saved asset or upload a replacement; its original file is immutable';end if;
 return case when tg_op='DELETE' then old else new end;
end;$$;

revoke all on function public.guard_forgestudio_media_request(),public.begin_forgestudio_media(uuid,uuid,uuid,jsonb),public.claim_forgestudio_media(text),public.advance_forgestudio_media(uuid,uuid,text,jsonb),public.finish_forgestudio_media(uuid,uuid,uuid,jsonb),public.decide_forgestudio_media(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.guard_forgestudio_media_request(),public.begin_forgestudio_media(uuid,uuid,uuid,jsonb),public.claim_forgestudio_media(text),public.advance_forgestudio_media(uuid,uuid,text,jsonb),public.finish_forgestudio_media(uuid,uuid,uuid,jsonb),public.decide_forgestudio_media(uuid,uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
