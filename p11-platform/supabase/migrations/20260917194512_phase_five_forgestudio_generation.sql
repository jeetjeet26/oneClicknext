create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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
 origin:=case when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

create table public.forgestudio_generations(
 id uuid primary key,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id) on delete cascade,
 brief_id uuid not null references public.social_content_briefs(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),
 claim_token uuid not null default gen_random_uuid(),
 revision_id uuid not null default gen_random_uuid(),
 state text not null check(state in('preparing','ready','generating','result_ready','completed','failed','stopped')),
 brief_snapshot jsonb not null,
 context_id uuid references public.shared_context_snapshots(id),
 model_input jsonb,
 raw_result jsonb,
 raw_result_hash text generated always as (case when raw_result is null then null else public.crm_configuration_hash(raw_result) end) stored,
 package_id uuid references public.social_content_packages(id),
 error_code text,
 claim_expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create unique index forgestudio_generation_active_brief on public.forgestudio_generations(brief_id) where state in('preparing','ready','generating','result_ready');
create index forgestudio_generations_property on public.forgestudio_generations(property_id,created_at desc,id);
create index forgestudio_generations_org on public.forgestudio_generations(org_id);
create index forgestudio_generations_actor on public.forgestudio_generations(actor_id);
create index forgestudio_generations_context on public.forgestudio_generations(context_id);
create index forgestudio_generations_package on public.forgestudio_generations(package_id);
create table public.forgestudio_generation_receipts(
 id uuid primary key default gen_random_uuid(),
 generation_id uuid not null references public.forgestudio_generations(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 kind text not null check(kind in('context_saved','model_intent','model_result','completed','failed','stopped')),
 evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(generation_id,kind)
);
create index forgestudio_generation_receipts_property on public.forgestudio_generation_receipts(property_id);
alter table public.forgestudio_generations enable row level security;
alter table public.forgestudio_generation_receipts enable row level security;
revoke all on public.forgestudio_generations,public.forgestudio_generation_receipts from public,anon,authenticated;
grant select,insert,update,delete on public.forgestudio_generations to service_role;
grant select,insert,delete on public.forgestudio_generation_receipts to service_role;
create policy forgestudio_generations_service on public.forgestudio_generations for all to service_role using(true) with check(true);
create policy forgestudio_generation_receipts_service on public.forgestudio_generation_receipts for all to service_role using(true) with check(true);
create trigger forgestudio_generation_receipt_immutable before update or delete on public.forgestudio_generation_receipts for each row execute function public.guard_forgestudio_publication_receipt();

create function public.begin_forgestudio_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_brief_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.forgestudio_generations;brief public.social_content_briefs;response jsonb;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'generation.requested',jsonb_build_object('briefId',p_brief_id));
 if response->>'state' not in('new','replayed') then return response;end if;
 select * into prior from public.forgestudio_generations where id=p_id;
 if found then return jsonb_build_object('state',prior.state,'generationId',prior.id,'packageId',prior.package_id,'revisionId',prior.revision_id);end if;
 select * into brief from public.social_content_briefs where id=p_brief_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if exists(select 1 from public.social_content_packages where brief_id=brief.id) then return '{"state":"draft_exists"}';end if;
 select * into prior from public.forgestudio_generations where brief_id=brief.id and state in('preparing','ready','generating','result_ready');
 if found then return jsonb_build_object('state','busy','generationId',prior.id);end if;
 insert into public.forgestudio_generations(id,property_id,org_id,brief_id,actor_id,state,brief_snapshot) values(p_id,p_property_id,brief.org_id,brief.id,p_actor_id,'preparing',to_jsonb(brief)) returning * into prior;
 update public.social_content_briefs set status='generating',updated_at=clock_timestamp() where id=brief.id;
 perform public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'generation.requested',jsonb_build_object('briefId',p_brief_id),jsonb_build_object('status',brief.status),jsonb_build_object('generationId',p_id,'state','preparing'),jsonb_build_object('generationId',p_id,'briefId',brief.id));
 return jsonb_build_object('state','claimed','generationId',p_id,'claimToken',prior.claim_token,'brief',prior.brief_snapshot);
end;$$;

create function public.advance_forgestudio_generation(p_id uuid,p_claim_token uuid,p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_generations;context uuid;prior public.forgestudio_generation_receipts;begin
 select * into run from public.forgestudio_generations where id=p_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(run.property_id::text,12));
 select * into run from public.forgestudio_generations where id=p_id for update;
 if run.claim_token is distinct from p_claim_token then return '{"state":"claim_mismatch"}';end if;
 if p_action='raw_result' then
  if not exists(select 1 from public.forgestudio_generation_receipts where generation_id=run.id and kind='model_intent') then return '{"state":"model_intent_required"}';end if;
  if run.raw_result is not null then
   if run.raw_result=p_payload then return jsonb_build_object('state','replayed','generationState',run.state);end if;return '{"state":"result_conflict"}';
  end if;
  if jsonb_typeof(p_payload->'output') is distinct from 'object' or jsonb_typeof(p_payload->'metadata') is distinct from 'object' or length(p_payload::text)>2097152 then raise exception 'Invalid generation result';end if;
  insert into public.forgestudio_generation_receipts(generation_id,property_id,kind,evidence)values(run.id,run.property_id,'model_result',jsonb_build_object('resultHash',public.crm_configuration_hash(p_payload),'origin','model_response','usage',p_payload->'metadata'->'usage','generationId',p_payload->'metadata'->'generationId'));
  update public.forgestudio_generations set raw_result=p_payload,state=case when state='stopped' then state else 'result_ready' end,updated_at=clock_timestamp() where id=run.id;
  return jsonb_build_object('state','saved','generationState',case when run.state='stopped' then 'stopped' else 'result_ready' end);
 end if;
 if run.state in('completed','stopped') then return jsonb_build_object('state',run.state);end if;
 if p_action='failure' then
  if run.raw_result is not null then return '{"state":"result_ready"}';end if;
  if run.state='failed' then return '{"state":"replayed"}';end if;
  if p_payload->>'code' is null or p_payload->>'code' not in('context_failed','model_uncertain','validation_failed') then raise exception 'Invalid generation failure';end if;
  insert into public.forgestudio_generation_receipts(generation_id,property_id,kind,evidence)values(run.id,run.property_id,'failed',jsonb_build_object('code',p_payload->>'code','origin','generation_worker'));
  update public.forgestudio_generations set state=case when p_payload->>'code'='model_uncertain' then 'generating' else 'failed' end,error_code=p_payload->>'code',updated_at=clock_timestamp() where id=run.id;
  update public.social_content_briefs set status=case when p_payload->>'code'='model_uncertain' then 'generating' else 'draft' end,updated_at=clock_timestamp() where id=run.brief_id;
  return '{"state":"saved"}';
 end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=run.property_id and p.org_id=run.org_id and u.id=run.actor_id) then return '{"state":"forbidden"}';end if;
 if run.claim_expires_at<=clock_timestamp() then return '{"state":"claim_expired"}';end if;
 if p_action='context' then
  if run.model_input is not null then
   if run.model_input=p_payload then return jsonb_build_object('state','replayed','contextId',run.context_id);end if;return '{"state":"input_conflict"}';
  end if;
  if run.state<>'preparing' then return '{"state":"not_preparing"}';end if;
  if p_payload->'bundle'->>'propertyId' is distinct from run.property_id::text or jsonb_typeof(p_payload->'bundle'->'sources') is distinct from 'array' or nullif(p_payload->'bundle'->>'contextHash','') is null or length(p_payload::text)>1048576 then raise exception 'Invalid saved generation context';end if;
  insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by) values(run.org_id,run.property_id,'forgestudio.generation','generation:'||run.id,p_payload->'bundle',p_payload->'bundle'->>'contextHash',run.actor_id::text) returning id into context;
  insert into public.forgestudio_generation_receipts(generation_id,property_id,kind,evidence)values(run.id,run.property_id,'context_saved',jsonb_build_object('contextId',context,'inputHash',public.crm_configuration_hash(p_payload),'origin','generation_worker'));
  update public.forgestudio_generations set state='ready',model_input=p_payload,context_id=context,updated_at=clock_timestamp() where id=run.id;
  return jsonb_build_object('state','saved','contextId',context);
 elsif p_action='model_intent' then
  if exists(select 1 from public.forgestudio_generation_receipts where generation_id=run.id and kind='model_intent') then return '{"state":"model_already_started"}';end if;
  if run.state<>'ready' or run.context_id is null then return '{"state":"context_required"}';end if;
  insert into public.forgestudio_generation_receipts(generation_id,property_id,kind,evidence)values(run.id,run.property_id,'model_intent',jsonb_build_object('contextId',run.context_id,'inputHash',public.crm_configuration_hash(run.model_input),'origin','generation_worker'));
  update public.forgestudio_generations set state='generating',updated_at=clock_timestamp() where id=run.id;
  return '{"state":"proceed_once"}';
 end if;
 raise exception 'Unsupported generation transition';
end;$$;

create function public.finish_forgestudio_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.forgestudio_generations;result jsonb;begin
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into run from public.forgestudio_generations where id=p_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if run.state='completed' then return jsonb_build_object('state','replayed','packageId',run.package_id,'revisionId',run.revision_id);end if;
 if run.state='stopped' then return '{"state":"stopped"}';end if;
 if not exists(select 1 from public.properties where id=p_property_id and org_id=run.org_id) then return '{"state":"forbidden"}';end if;
 if run.state<>'result_ready' or run.raw_result is null then return '{"state":"result_required"}';end if;
 if p_payload->>'resultHash' is distinct from public.crm_configuration_hash(run.raw_result) then return '{"state":"result_conflict"}';end if;
 result:=public.save_forgestudio_revision(run.revision_id,p_property_id,p_actor_id,jsonb_build_object('briefId',run.brief_id,'authorKind','llm','content',p_payload->'content','validation',p_payload->'validation','contextSnapshotId',run.context_id,'generationMetadata',run.raw_result->'metadata'||jsonb_build_object('generationRequestId',run.id)));
 if result->>'state' not in('saved','replayed') then return result;end if;
 insert into public.forgestudio_generation_receipts(generation_id,property_id,kind,evidence)values(run.id,run.property_id,'completed',jsonb_build_object('packageId',result->>'packageId','revisionId',run.revision_id,'resultHash',public.crm_configuration_hash(run.raw_result),'origin','generation_worker','requestedBy',run.actor_id,'savedBy',p_actor_id));
 update public.forgestudio_generations set state='completed',package_id=(result->>'packageId')::uuid,error_code=null,updated_at=clock_timestamp() where id=run.id;
 return jsonb_build_object('state','saved','packageId',result->>'packageId','revisionId',run.revision_id);
end;$$;

create function public.stop_forgestudio_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;run public.forgestudio_generations;begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'generation.stopped',p_payload);if response->>'state'<>'new' then return response;end if;
 select * into run from public.forgestudio_generations where id=(p_payload->>'generationId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if run.state='completed' then return '{"state":"draft_exists"}';end if;
 if run.state='stopped' then return '{"state":"stopped"}';end if;
 if run.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then return '{"state":"stale_generation"}';end if;
 if length(trim(coalesce(p_payload->>'reason','')))<10 then raise exception 'Explain why the saved generation should stop';end if;
 insert into public.forgestudio_generation_receipts(generation_id,property_id,kind,evidence)values(run.id,run.property_id,'stopped',jsonb_build_object('actorId',p_actor_id,'reason',p_payload->>'reason','origin','console','providerCancellationConfirmed',false));
 update public.forgestudio_generations set state='stopped',updated_at=clock_timestamp() where id=run.id;
 update public.social_content_briefs set status='draft',updated_at=clock_timestamp() where id=run.brief_id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'generation.stopped',p_payload,jsonb_build_object('state',run.state),jsonb_build_object('state','stopped'),jsonb_build_object('generationId',run.id,'state','stopped','providerCancellationConfirmed',false));
end;$$;
revoke all on function public.begin_forgestudio_generation(uuid,uuid,uuid,uuid),public.advance_forgestudio_generation(uuid,uuid,text,jsonb),public.finish_forgestudio_generation(uuid,uuid,uuid,jsonb),public.stop_forgestudio_generation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_forgestudio_generation(uuid,uuid,uuid,uuid),public.advance_forgestudio_generation(uuid,uuid,text,jsonb),public.finish_forgestudio_generation(uuid,uuid,uuid,jsonb),public.stop_forgestudio_generation(uuid,uuid,uuid,jsonb) to service_role;

create function public.guard_forgestudio_generation_inputs() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if not exists(select 1 from public.properties where id=old.property_id) then return new;end if;
 if (new.id,new.property_id,new.org_id,new.brief_id,new.actor_id,new.claim_token,new.revision_id,new.brief_snapshot) is distinct from (old.id,old.property_id,old.org_id,old.brief_id,old.actor_id,old.claim_token,old.revision_id,old.brief_snapshot) or (old.model_input is not null and (new.model_input,new.context_id) is distinct from (old.model_input,old.context_id)) or (old.raw_result is not null and new.raw_result is distinct from old.raw_result) then raise exception 'Generation inputs and results are immutable';end if;return new;
end;$$;
create trigger forgestudio_generation_inputs_immutable before update on public.forgestudio_generations for each row execute function public.guard_forgestudio_generation_inputs();
revoke all on function public.guard_forgestudio_generation_inputs() from public,anon,authenticated;
grant execute on function public.guard_forgestudio_generation_inputs() to service_role;
create function public.recover_forgestudio_generation(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare response jsonb;result jsonb;decision jsonb:=jsonb_build_object('generationId',p_payload->>'generationId','resultHash',p_payload->>'resultHash');begin
 response:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'generation.recovered',decision);if response->>'state'<>'new' then return response;end if;
 result:=public.finish_forgestudio_generation((p_payload->>'generationId')::uuid,p_property_id,p_actor_id,p_payload);
 if result->>'state' not in('saved','replayed') then return result;end if;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'generation.recovered',decision,null,jsonb_build_object('state','completed'),result- 'state');
end;$$;
revoke all on function public.recover_forgestudio_generation(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recover_forgestudio_generation(uuid,uuid,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
