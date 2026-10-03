create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

-- Each editorial mutation and its attributed decision history commit together.
create table public.forgestudio_commands(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),kind text not null,
 payload_hash text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create index forgestudio_commands_property on public.forgestudio_commands(property_id,created_at desc);
create index forgestudio_commands_actor on public.forgestudio_commands(actor_id);
alter table public.forgestudio_commands enable row level security;
create policy forgestudio_commands_service on public.forgestudio_commands for all to service_role using(true) with check(true);
revoke all on public.forgestudio_commands from public,anon,authenticated;
grant all on public.forgestudio_commands to service_role;
create trigger forgestudio_commands_immutable before update or delete on public.forgestudio_commands for each row execute function public.protect_shared_action_history();

create function public.forgestudio_command_start(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare previous public.forgestudio_commands;
begin
 if p_id is null or p_kind is null or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>524288 then raise exception 'Invalid editorial request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into previous from public.forgestudio_commands where id=p_id;
 if found then
  if (previous.property_id,previous.actor_id,previous.kind,previous.payload_hash) is distinct from (p_property_id,p_actor_id,p_kind,public.crm_configuration_hash(p_payload)) then return '{"state":"request_conflict"}';end if;
  return previous.result||'{"state":"replayed"}';
 end if;
 return '{"state":"new"}';
end;$$;
create function public.forgestudio_command_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_payload jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare recorded jsonb;begin
 insert into public.forgestudio_commands(id,property_id,actor_id,kind,payload_hash,payload,result)values(p_id,p_property_id,p_actor_id,p_kind,public.crm_configuration_hash(p_payload),p_payload,p_result);
 recorded:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'forgestudio','studio.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_payload)),p_before,p_after,p_result-array['brief','revision','package','publications','publication'],p_links);
 if recorded->>'state' not in('recorded','replayed') then raise exception 'Editorial history could not be saved';end if;
 return p_result||'{"state":"saved"}';
end;$$;

create function public.save_forgestudio_brief(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;organization uuid;brief public.social_content_briefs;begin
 result:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'brief.saved',p_payload);if result->>'state'<>'new' then return result;end if;
 if length(trim(coalesce(p_payload->>'title','')))=0 or length(p_payload->>'title')>300 or length(trim(coalesce(p_payload->>'objective','')))=0 or length(p_payload->>'objective')>2000 or jsonb_typeof(p_payload->'channels') is distinct from 'array' or jsonb_array_length(p_payload->'channels') not between 1 and 5 or jsonb_typeof(p_payload->'formatPlan') is distinct from 'array' or jsonb_array_length(p_payload->'formatPlan') not between 1 and 30 then raise exception 'Invalid brief';end if;
 if exists(select 1 from jsonb_array_elements_text(p_payload->'channels') ch where ch not in('instagram','facebook','linkedin','tiktok','x')) then raise exception 'Invalid channel';end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'connectionIds','[]')) target where not exists(select 1 from public.social_connections c where c.id=target::uuid and c.property_id=p_property_id and c.is_active and (case when c.platform='twitter' then 'x' else c.platform end) in(select jsonb_array_elements_text(p_payload->'channels')))) then return '{"state":"connection_unavailable"}';end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'assetIds','[]')) target where not exists(select 1 from public.content_assets a where a.id=target::uuid and a.property_id=p_property_id)) then return '{"state":"asset_unavailable"}';end if;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.social_content_briefs(id,org_id,property_id,created_by,title,objective,topic,audience,source_facts,constraints,channels,connection_ids,asset_ids,format_plan,scheduling_window)
 values(p_id,organization,p_property_id,p_actor_id,p_payload->>'title',p_payload->>'objective',p_payload->>'topic',p_payload->>'audience',coalesce(p_payload->'sourceFacts','[]'),coalesce(p_payload->'constraints','{}'),array(select jsonb_array_elements_text(p_payload->'channels')),array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'connectionIds','[]'))),array(select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'assetIds','[]'))),p_payload->'formatPlan',coalesce(p_payload->'schedulingWindow','{}')) returning * into brief;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'brief.saved',p_payload,null,jsonb_build_object('briefId',brief.id,'status',brief.status),jsonb_build_object('brief',to_jsonb(brief),'briefId',brief.id));
end;$$;

-- Database content immutability binds later approval to the reviewed revision.
create function public.protect_forgestudio_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
 if tg_op='DELETE' then raise exception 'Editorial revisions retain their history';end if;
 if (to_jsonb(new)-array['approval_status','approved_by','approved_at','approval_note','shared_action_attempt_id']) is distinct from (to_jsonb(old)-array['approval_status','approved_by','approved_at','approval_note','shared_action_attempt_id']) then raise exception 'Create a new revision to edit saved content';end if;
 return new;
end;$$;
create trigger forgestudio_revision_immutable before update or delete on public.social_content_revisions for each row execute function public.protect_forgestudio_revision();
create trigger forgestudio_variant_immutable before update or delete on public.social_content_variants for each row execute function public.protect_shared_action_history();

create function public.record_forgestudio_governance(p_id uuid,p_property_id uuid,p_actor_id uuid,p_revision_id uuid,p_decision text,p_note text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare revision public.social_content_revisions;job uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();state text;begin
 select * into revision from public.social_content_revisions where id=p_revision_id and property_id=p_property_id;
 if not found or p_decision not in('approved','denied','modified') then raise exception 'Invalid revision decision';end if;
 state:=case when p_decision='denied' then 'cancelled' else 'succeeded' end;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,attempt_count,max_attempts,started_at,finished_at,stage,progress,current_step)
 values(job,revision.org_id,p_property_id,'forgestudio.revision-approval','social_content_revision',revision.id,state,'revision_'||p_decision,'revision-decision:'||p_id,jsonb_build_object('revisionId',revision.id,'decision',p_decision),revision.context_snapshot_id,1,1,clock_timestamp(),clock_timestamp(),'completed',100,'Revision '||p_decision);
 insert into public.shared_action_attempts(id,job_id,org_id,property_id,action_type,lifecycle_status,proposal_decision_status,execution_status,requested_by,reviewed_by,request_payload,execution_payload,execution_result,policy_snapshot,policy_reason,proposed_at,decided_at,executed_at)
 values(attempt,job,revision.org_id,p_property_id,'review_social_content_revision',state,p_decision,case when p_decision='denied' then 'cancelled' else 'executed' end,p_actor_id,p_actor_id,jsonb_build_object('revisionId',revision.id),jsonb_build_object('decision',p_decision,'note',p_note),jsonb_build_object('contentHash',revision.content_hash),'{"policy":"forgestudio.content-safety","version":"2026-09-17"}',p_note,clock_timestamp(),clock_timestamp(),clock_timestamp());
 insert into public.shared_approvals(action_attempt_id,org_id,property_id,decision_status,decision_reason,reviewer_profile_id,decision_payload) values(attempt,revision.org_id,p_property_id,p_decision,p_note,p_actor_id,jsonb_build_object('revisionId',revision.id,'contentHash',revision.content_hash));
 insert into public.shared_policy_decisions(org_id,property_id,job_id,action_attempt_id,policy_name,policy_version,decision_status,decision_reason,decision_payload)values(revision.org_id,p_property_id,job,attempt,'forgestudio.content-safety','2026-09-17',p_decision,p_note,jsonb_build_object('contentHash',revision.content_hash));
 update public.social_content_revisions set shared_action_attempt_id=attempt where id=revision.id;
 return jsonb_build_object('jobId',job,'attemptId',attempt,'contextId',revision.context_snapshot_id);
end;$$;

create function public.save_forgestudio_revision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;pkg public.social_content_packages;revision public.social_content_revisions;organization uuid;previous uuid;revision_number integer;variant jsonb;variant_key text;kind text;links jsonb:='{}';context_id uuid;brief_id uuid;content jsonb;cancelled integer:=0;
begin
 kind:=case when nullif(p_payload->>'packageId','') is null then 'package.created' else 'revision.saved' end;
 result:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,kind,p_payload);if result->>'state'<>'new' then return result;end if;
 content:=p_payload->'content';
 if jsonb_typeof(content) is distinct from 'object' or content->>'contractVersion' is distinct from 'forgestudio.social.v1' or jsonb_typeof(content->'variants') is distinct from 'array' or jsonb_array_length(content->'variants') not between 1 and 150 or length(trim(coalesce(content->>'conceptSummary','')))=0 or p_payload->>'authorKind' not in('llm','user') then raise exception 'Invalid editorial content';end if;
 select org_id into organization from public.properties where id=p_property_id;
 context_id:=nullif(p_payload->>'contextSnapshotId','')::uuid;brief_id:=nullif(p_payload->>'briefId','')::uuid;
 if context_id is not null and not exists(select 1 from public.shared_context_snapshots where id=context_id and property_id=p_property_id and org_id=organization) then return '{"state":"context_unavailable"}';end if;
 if brief_id is not null and not exists(select 1 from public.social_content_briefs where id=brief_id and property_id=p_property_id) then return '{"state":"brief_unavailable"}';end if;
 if exists(select 1 from jsonb_array_elements(content->'variants') v cross join lateral jsonb_array_elements_text(coalesce(v->'assetIds','[]')||case when nullif(v->>'thumbnailAssetId','') is not null then jsonb_build_array(v->>'thumbnailAssetId') else '[]'::jsonb end) asset where not exists(select 1 from public.content_assets a where a.id=asset::uuid and a.property_id=p_property_id)) then return '{"state":"asset_unavailable"}';end if;
 -- Validation is computed on the server before this private call, then bound to immutable content.
 if jsonb_typeof(p_payload->'validation') is distinct from 'array' or jsonb_array_length(p_payload->'validation')<>jsonb_array_length(content->'variants') then raise exception 'Variant validation required';end if;
 if kind='revision.saved' then
  select * into pkg from public.social_content_packages where id=(p_payload->>'packageId')::uuid and property_id=p_property_id for update;
  if not found then return '{"state":"not_found"}';end if;
  if pkg.current_revision_id is distinct from nullif(p_payload->>'expectedRevisionId','')::uuid then return '{"state":"stale_revision"}';end if;
  if p_payload->>'authorKind'<>'user' or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'A revision edit needs its operator and reason';end if;
  previous:=pkg.current_revision_id;
  -- A claimed worker may already be past its read. Keep its exact version intact.
  perform 1 from public.shared_jobs j join public.social_publications p on p.shared_job_id=j.id where p.package_id=pkg.id order by j.id for update of j;
  if exists(select 1 from public.social_publications p left join public.shared_jobs j on j.id=p.shared_job_id where p.package_id=pkg.id and (p.status in('publishing','reconciling') or (p.status in('scheduled','queued') and (j.lease_owner is not null or j.lifecycle_status='running')))) then return '{"state":"publication_in_progress"}';end if;
  select coalesce(max(r.revision_number),0)+1 into revision_number from public.social_content_revisions r where r.package_id=pkg.id;
  context_id:=coalesce(context_id,(select r.context_snapshot_id from public.social_content_revisions r where r.id=previous));
 else
  insert into public.social_content_packages(org_id,property_id,brief_id,concept_summary,status,created_by)values(organization,p_property_id,brief_id,content->>'conceptSummary','in_review',p_actor_id) returning * into pkg;
  revision_number:=1;
 end if;
 insert into public.social_content_revisions(id,package_id,org_id,property_id,revision_number,authored_by_kind,authored_by,content,content_hash,context_snapshot_id,generation_metadata,claims)
 values(p_id,pkg.id,organization,p_property_id,revision_number,p_payload->>'authorKind',case when p_payload->>'authorKind'='user' then p_actor_id end,content,public.crm_configuration_hash(content),context_id,coalesce(p_payload->'generationMetadata','{}'),coalesce(content->'claims','[]')) returning * into revision;
 for variant in select value||jsonb_build_object('_index',ordinality-1) from jsonb_array_elements(content->'variants') with ordinality loop
  variant_key:=case when variant->>'variantKey'='primary' then (variant->>'platform')||':'||(variant->>'contentFormat')||':'||((variant->>'sequenceIndex')::integer+1)::text else variant->>'variantKey' end;
  insert into public.social_content_variants(revision_id,org_id,property_id,variant_key,sequence_index,platform,caption,hashtags,call_to_action,link_url,asset_ids,media_urls,alt_text,content_format,platform_options,storyboard,overlay_text,safe_area,subtitle_text,thumbnail_asset_id,validation)
  values(revision.id,organization,p_property_id,variant_key,(variant->>'sequenceIndex')::integer,variant->>'platform',variant->>'caption',array(select jsonb_array_elements_text(coalesce(variant->'hashtags','[]'))),variant->>'callToAction',variant->>'linkUrl',array(select value::uuid from jsonb_array_elements_text(coalesce(variant->'assetIds','[]'))),array(select jsonb_array_elements_text(coalesce(variant->'mediaUrls','[]'))),variant->>'altText',variant->>'contentFormat',coalesce(variant->'platformOptions','{}'),coalesce(variant->'storyboard','[]'),array(select jsonb_array_elements_text(coalesce(variant->'overlayText','[]'))),coalesce(variant->'safeArea','{}'),variant->>'subtitleText',nullif(variant->>'thumbnailAssetId','')::uuid,jsonb_build_object('issues',p_payload->'validation'->((variant->>'_index')::integer)));
 end loop;
 if previous is not null then
  update public.social_content_revisions set approval_status='superseded' where package_id=pkg.id and id<>revision.id and approval_status in('pending','approved');
  update public.shared_jobs set lifecycle_status='cancelled',status_reason='revision_superseded',finished_at=clock_timestamp(),updated_at=clock_timestamp() where id in(select shared_job_id from public.social_publications where package_id=pkg.id and status in('scheduled','queued'));
  update public.shared_action_attempts set lifecycle_status='cancelled',execution_status='cancelled',error_message='Revision superseded before publication',updated_at=clock_timestamp() where id in(select shared_action_attempt_id from public.social_publications where package_id=pkg.id and status in('scheduled','queued'));
  update public.social_publications set status='cancelled',cancelled_at=clock_timestamp(),last_error='Revision superseded by an edit',updated_at=clock_timestamp() where package_id=pkg.id and status in('scheduled','queued');get diagnostics cancelled=row_count;
  links:=public.record_forgestudio_governance(p_id,p_property_id,p_actor_id,revision.id,'modified',p_payload->>'reason');
 end if;
 update public.social_content_packages set current_revision_id=revision.id,concept_summary=content->>'conceptSummary',status='in_review',updated_at=clock_timestamp() where id=pkg.id returning * into pkg;
 if brief_id is not null then update public.social_content_briefs set status='generated',updated_at=clock_timestamp() where id=brief_id;end if;
 select * into revision from public.social_content_revisions where id=revision.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,kind,p_payload,jsonb_build_object('revisionId',previous),jsonb_build_object('revisionId',revision.id,'revisionNumber',revision.revision_number,'status','pending','cancelledSchedules',cancelled),jsonb_build_object('package',to_jsonb(pkg),'revision',to_jsonb(revision),'packageId',pkg.id,'revisionId',revision.id),links);
end;$$;

create function public.review_forgestudio_revision(p_id uuid,p_property_id uuid,p_actor_id uuid,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;revision public.social_content_revisions;pkg public.social_content_packages;decision text:=p_payload->>'decision';links jsonb;
begin
 result:=public.forgestudio_command_start(p_id,p_property_id,p_actor_id,'revision.reviewed',p_payload);if result->>'state'<>'new' then return result;end if;
 if not exists(select 1 from public.profiles where id=p_actor_id and role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 if decision is null or decision not in('approved','denied') or length(trim(coalesce(p_payload->>'note','')))<3 or length(p_payload->>'note')>2000 then raise exception 'Invalid review';end if;
 select * into revision from public.social_content_revisions where id=(p_payload->>'revisionId')::uuid and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into pkg from public.social_content_packages where id=revision.package_id for update;
 if revision.id is distinct from pkg.current_revision_id or revision.approval_status<>'pending' or revision.content_hash is distinct from p_payload->>'contentHash' then return '{"state":"stale_revision"}';end if;
 if decision='approved' and (not exists(select 1 from public.social_content_variants where revision_id=revision.id) or exists(select 1 from public.social_content_variants where revision_id=revision.id and validation->'issues' is distinct from '[]'::jsonb) or exists(select 1 from jsonb_array_elements(revision.claims) claim where claim->>'type' in('pricing','concession','availability','testimonial','accessibility','neighborhood') and coalesce(jsonb_array_length(claim->'citations'),0)=0)) then return '{"state":"validation_required"}';end if;
 links:=public.record_forgestudio_governance(p_id,p_property_id,p_actor_id,revision.id,decision,p_payload->>'note');
 update public.social_content_revisions set approval_status=decision,approved_by=p_actor_id,approved_at=clock_timestamp(),approval_note=p_payload->>'note' where id=revision.id returning * into revision;
 update public.social_content_packages set status=case when decision='approved' then 'approved' else 'in_review' end,updated_at=clock_timestamp() where id=pkg.id;
 return public.forgestudio_command_finish(p_id,p_property_id,p_actor_id,'revision.reviewed',p_payload,jsonb_build_object('revisionId',revision.id,'status','pending'),jsonb_build_object('revisionId',revision.id,'status',decision),jsonb_build_object('revision',to_jsonb(revision),'revisionId',revision.id,'decision',decision),links);
end;$$;

revoke all on function public.forgestudio_command_start(uuid,uuid,uuid,text,jsonb),public.forgestudio_command_finish(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.save_forgestudio_brief(uuid,uuid,uuid,jsonb),public.protect_forgestudio_revision(),public.record_forgestudio_governance(uuid,uuid,uuid,uuid,text,text),public.save_forgestudio_revision(uuid,uuid,uuid,jsonb),public.review_forgestudio_revision(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.forgestudio_command_start(uuid,uuid,uuid,text,jsonb),public.forgestudio_command_finish(uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb),public.save_forgestudio_brief(uuid,uuid,uuid,jsonb),public.protect_forgestudio_revision(),public.record_forgestudio_governance(uuid,uuid,uuid,uuid,text,text),public.save_forgestudio_revision(uuid,uuid,uuid,jsonb),public.review_forgestudio_revision(uuid,uuid,uuid,jsonb) to service_role;

notify pgrst,'reload schema';
