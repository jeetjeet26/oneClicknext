create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
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
 origin:=case when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;
create or replace function public.marketvision_decision_finish(p_id uuid,p_property_id uuid,p_actor_id uuid,p_kind text,p_resource_id uuid,p_input jsonb,p_before jsonb,p_after jsonb,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$declare event jsonb;begin
 insert into public.marketvision_decisions(id,org_id,property_id,actor_id,kind,resource_id,input,input_hash,before_state,after_state,result)values(p_id,(select org_id from public.properties where id=p_property_id),p_property_id,p_actor_id,p_kind,p_resource_id,p_input,public.crm_configuration_hash(p_input),p_before,p_after,p_result);
 event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'marketvision','market.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('inputHash',public.crm_configuration_hash(p_input),'resourceId',p_resource_id),case when p_before is not null then jsonb_build_object('version',p_before->'version','stateHash',public.crm_configuration_hash(p_before)) end,case when p_after is not null then jsonb_build_object('version',p_after->'version','stateHash',public.crm_configuration_hash(p_after)) end,p_result,case when (p_kind like 'extraction.%'or p_kind like 'source.%'or p_kind like 'intake.%'or p_kind like 'brief.%'or p_kind like 'handoff.%') then coalesce((select jsonb_build_object('jobId',j.id,'contextId',j.context_snapshot_id,'attemptId',case when p_kind like 'handoff.%'then (select h.attempt_id from public.marketvision_handoffs h where h.id=j.id)else null end)from public.shared_jobs j where j.id=(p_result->>'requestId')::uuid and j.property_id=p_property_id),'{}')else '{}'end);
 if event->>'state' not in('recorded','replayed') then raise exception 'Market decision history could not be saved';end if;return p_result||'{"state":"saved"}';
end$$;

create table public.marketvision_intakes(
 id uuid primary key references public.shared_jobs(id),property_id uuid not null references public.properties(id)on delete cascade,
 org_id uuid not null references public.organizations(id),actor_id uuid not null references public.profiles(id),context_id uuid not null references public.shared_context_snapshots(id),
 input jsonb not null,input_hash text not null,preview jsonb not null,preview_hash text not null,recipe text not null check(recipe='operator-notes-v1'),
 state text not null default 'preview_ready'check(state in('preview_ready','applied','stopped')),version integer not null default 1,
 decision_id uuid,result jsonb,created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index marketvision_intake_history on public.marketvision_intakes(property_id,created_at desc,id desc);
create index marketvision_intake_org on public.marketvision_intakes(org_id);
create index marketvision_intake_actor on public.marketvision_intakes(actor_id);
create index marketvision_intake_context on public.marketvision_intakes(context_id);
alter table public.marketvision_intakes enable row level security;
revoke all on public.marketvision_intakes from public,anon,authenticated;
grant all on public.marketvision_intakes to service_role;
create policy marketvision_intake_service on public.marketvision_intakes for all to service_role using(true)with check(true);
create function public.guard_marketvision_intake()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if tg_op='DELETE'then if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;raise exception 'Saved intake is retained';end if;
 if(new.id,new.property_id,new.org_id,new.actor_id,new.context_id,new.input,new.input_hash,new.preview,new.preview_hash,new.recipe,new.created_at)is distinct from(old.id,old.property_id,old.org_id,old.actor_id,old.context_id,old.input,old.input_hash,old.preview,old.preview_hash,old.recipe,old.created_at)then raise exception 'Saved notes and preview cannot change';end if;
 if old.state<>'preview_ready'or new.state not in('applied','stopped')or new.decision_id is null or new.result is null or new.finished_at is null then raise exception 'Only a reviewed terminal decision may finish intake';end if;
 new.version:=old.version+1;return new;
end$$;
create trigger marketvision_intake_guard before update or delete on public.marketvision_intakes for each row execute function public.guard_marketvision_intake();

create function public.begin_marketvision_intake(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb,p_preview jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior jsonb;entry public.marketvision_intakes;organization uuid;context uuid;item jsonb;ordinal integer:=0;retained jsonb:='[]';begin
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,'intake.prepared',p_input);if prior->>'state'not in('new','replayed')then return prior;end if;
 select *into entry from public.marketvision_intakes where id=p_id;if found then return jsonb_build_object('state',entry.state,'requestId',entry.id,'version',entry.version);end if;
 if(p_input-array['rawText','reason'])<>'{}'or jsonb_typeof(p_input->'rawText')is distinct from 'string'or length(trim(p_input->>'rawText'))not between 20 and 100000 then raise exception 'Review the complete intake notes';end if;
 if jsonb_typeof(p_preview)is distinct from 'array'or jsonb_array_length(p_preview)not between 1 and 50 or octet_length(p_preview::text)>524288 then raise exception 'Review one to 50 complete candidates';end if;
 for item in select value from jsonb_array_elements(p_preview)loop
  if jsonb_typeof(item)is distinct from 'object'or(item-array['name','location','url','sourceText','claims'])<>'{}'or jsonb_typeof(item->'name')is distinct from 'string'or length(item->>'name')>100000 or jsonb_typeof(item->'sourceText')is distinct from 'string'or length(item->>'sourceText')not between 1 and 100000 or jsonb_typeof(item->'claims')is distinct from 'object' then raise exception 'Invalid retained candidate';end if;
  ordinal:=ordinal+1;retained:=retained||jsonb_build_array(item||jsonb_build_object('id',md5(p_id::text||':candidate:'||ordinal)::uuid,'ordinal',ordinal));
 end loop;
 select org_id into organization from public.properties where id=p_property_id;
 insert into public.shared_context_snapshots(org_id,property_id,source_domain,source_ref,context_payload,context_hash,captured_by)values(organization,p_property_id,'marketvision.intake',p_id::text,jsonb_build_object('requestId',p_id,'recipe','operator-notes-v1','notesHash',public.crm_configuration_hash(p_input),'previewHash',public.crm_configuration_hash(retained),'trust','operator_reported_unverified'),public.crm_configuration_hash(retained),p_actor_id::text)returning id into context;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,lifecycle_status,status_reason,dedupe_key,payload,context_snapshot_id,max_attempts,stage,progress,current_step)values(p_id,organization,p_property_id,'marketvision.intake','competitor_intake',p_id::text,'queued','operator_review_required',p_id::text,jsonb_build_object('requestId',p_id),context,1,'review',0,'Saved notes await explicit competitor review');
 insert into public.marketvision_intakes(id,property_id,org_id,actor_id,context_id,input,input_hash,preview,preview_hash,recipe)values(p_id,p_property_id,organization,p_actor_id,context,p_input,public.crm_configuration_hash(p_input),retained,public.crm_configuration_hash(retained),'operator-notes-v1');
 perform public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,'intake.prepared',p_id,p_input,null,jsonb_build_object('version',1,'state','preview_ready'),jsonb_build_object('requestId',p_id,'version',1,'candidateCount',ordinal,'previewHash',public.crm_configuration_hash(retained),'providerVerified',false,'externalExecutionStarted',false));
 return jsonb_build_object('state','preview_ready','requestId',p_id,'version',1);
end$$;

create function public.decide_marketvision_intake(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare prior jsonb;entry public.marketvision_intakes;before_state jsonb;item jsonb;candidate jsonb;created jsonb:='[]';skipped jsonb:='[]';saved jsonb;decision_result jsonb;kind text;reviewed_name text;website text;begin
 if p_input->>'action'not in('apply','stop')or p_input->>'action'is null then raise exception 'Choose an intake decision';end if;
 kind:=case when p_input->>'action'='apply'then 'intake.applied'else 'intake.stopped'end;
 prior:=public.marketvision_decision_start(p_id,p_property_id,p_actor_id,kind,p_input);if prior->>'state'<>'new'then return prior;end if;
 select *into entry from public.marketvision_intakes where id=(p_input->>'intakeId')::uuid and property_id=p_property_id and org_id=(select org_id from public.properties where id=p_property_id)for update;if not found then return '{"state":"not_found"}';end if;
 if entry.version is distinct from(p_input->>'expectedVersion')::integer or entry.preview_hash is distinct from p_input->>'previewHash'then return '{"state":"stale_intake"}';end if;
 if entry.state<>'preview_ready'then return '{"state":"intake_finished"}';end if;
 before_state:=jsonb_build_object('version',entry.version,'state',entry.state,'previewHash',entry.preview_hash);
 if p_input->>'action'='apply'then
  if(p_input-array['action','intakeId','expectedVersion','previewHash','reason','acknowledgeUnverified','candidates'])<>'{}'or p_input->'acknowledgeUnverified'is distinct from 'true'::jsonb or jsonb_typeof(p_input->'candidates')is distinct from 'array'or jsonb_array_length(p_input->'candidates')<>jsonb_array_length(entry.preview)then raise exception 'Review every candidate and acknowledge its unverified source';end if;
  if(select count(distinct value->>'id')from jsonb_array_elements(p_input->'candidates'))<>jsonb_array_length(entry.preview)then raise exception 'Review each saved candidate once';end if;
  -- Validate the entire selection before writing any competitor. All competitor decisions share lock 71.
  for item in select value from jsonb_array_elements(p_input->'candidates')loop
   select value into candidate from jsonb_array_elements(entry.preview)where value->>'id'=item->>'id';if not found then raise exception 'Candidate is not in this saved preview';end if;
   if item->>'action'='skip'then
    if(item-array['id','action'])<>'{}'then raise exception 'Only skip the reviewed candidate';end if;
   elsif item->>'action'='add'then
    if not(item ?& array['id','action','name','location','url','propertyType'])or(item-array['id','action','name','location','url','propertyType'])<>'{}'or jsonb_typeof(item->'name')is distinct from 'string'or length(trim(item->>'name'))not between 1 and 200 or jsonb_typeof(item->'location')not in('string','null')or length(coalesce(item->>'location',''))>2000 or jsonb_typeof(item->'url')not in('string','null')or length(coalesce(item->>'url',''))>2000 or coalesce(item->>'propertyType','')not in('multifamily','senior','student','mixed_use','affordable','luxury','townhome','condo','single_family','master_planned')then raise exception 'Review the competitor name, type, location and link';end if;
    website:=nullif(item->>'url','');if website is not null and(website!~*'^https?://[^[:space:]/?#@]+([/:?#]|$)'or website~'[[:space:]<>]')then raise exception 'Use a complete HTTP or HTTPS source address';end if;
    reviewed_name:=lower(trim(item->>'name'));
    if exists(select 1 from public.competitors c where c.property_id=p_property_id and lower(trim(c.name))=reviewed_name)then return '{"state":"duplicate_competitor"}';end if;
    if(select count(*)from jsonb_array_elements(p_input->'candidates')v where v->>'action'='add'and lower(trim(v->>'name'))=reviewed_name)>1 then return '{"state":"duplicate_selection"}';end if;
   else raise exception 'Add or skip every candidate';end if;
  end loop;
  for item in select value from jsonb_array_elements(p_input->'candidates')loop
   if item->>'action'='skip'then skipped:=skipped||jsonb_build_array(item->>'id');continue;end if;
   saved:=public.save_marketvision_competitor((item->>'id')::uuid,p_property_id,p_actor_id,jsonb_build_object('action','create','reason',p_input->>'reason','values',jsonb_build_object('name',trim(item->>'name'),'property_type',item->>'propertyType','address',nullif(item->>'location',''),'website_url',nullif(item->>'url',''),'notes','Operator-reviewed identity from saved MarketVision intake '||entry.id::text||'. Reported claims remain unverified in the original notes.'),'units','[]'::jsonb));
   if saved->>'state'<>'saved'then raise exception 'Competitor decision did not commit';end if;
   created:=created||jsonb_build_array(jsonb_build_object('candidateId',item->>'id','competitorId',saved->>'competitorId','version',saved->'version'));
  end loop;
 else
  if(p_input-array['action','intakeId','expectedVersion','previewHash','reason'])<>'{}'then raise exception 'Stop only this saved intake';end if;
 end if;
 decision_result:=jsonb_build_object('requestId',entry.id,'version',entry.version+1,'created',created,'skipped',skipped,'providerVerified',false,'externalExecutionStarted',false);
 update public.marketvision_intakes set state=case when kind='intake.applied'then 'applied'else 'stopped'end,decision_id=p_id,result=decision_result,finished_at=clock_timestamp()where id=entry.id;
 update public.shared_jobs set lifecycle_status=case when kind='intake.applied'then 'succeeded'else 'cancelled'end,status_reason=kind,stage=case when kind='intake.applied'then 'completed'else 'cancelled'end,progress=100,current_step='Reviewed intake decision saved',updated_at=clock_timestamp()where id=entry.id;
 return public.marketvision_decision_finish(p_id,p_property_id,p_actor_id,kind,entry.id,p_input,before_state,jsonb_build_object('version',entry.version+1,'state',case when kind='intake.applied'then 'applied'else 'stopped'end),decision_result);
end$$;

create function public.read_marketvision_intakes(p_property_id uuid,p_actor_id uuid,p_request_id uuid default null,p_cursor uuid default null,p_legacy boolean default false)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare organization uuid;entry public.marketvision_intakes;anchor timestamptz;items jsonb;total bigint;legacy jsonb;begin
 select p.org_id into organization from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id;if not found then return '{"state":"forbidden"}';end if;
 if p_request_id is not null and p_cursor is not null then raise exception 'Choose a saved intake or history cursor';end if;
 if p_legacy then
  if p_request_id is not null then
   select jsonb_build_object('id',b.id,'created_at',b.created_at,'status',b.status,'rawText',b.raw_text,'trust','historical_unverified','candidates',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.seed_name,'location',c.seed_location,'url',c.seed_url,'sourceText',c.seed_snippet,'reportedClaims',c.seed_claims,'status',c.enrichment_status,'competitorId',c.competitor_id)order by c.created_at,c.id)from public.competitor_intake_candidates c where c.batch_id=b.id and c.property_id=p_property_id),'[]'))into legacy from public.competitor_intake_batches b where b.id=p_request_id and b.property_id=p_property_id;
   if not found then return '{"state":"not_found"}';end if;return jsonb_build_object('state','ready','legacy',legacy);
  end if;
  if p_cursor is not null then select created_at into anchor from public.competitor_intake_batches where id=p_cursor and property_id=p_property_id;if not found then return '{"state":"cursor_changed"}';end if;end if;
  select count(*)into total from public.competitor_intake_batches where property_id=p_property_id;
  select coalesce(jsonb_agg(to_jsonb(q)order by q.created_at desc,q.id desc),'[]')into items from(select id,created_at,status as state from public.competitor_intake_batches where property_id=p_property_id and(p_cursor is null or(created_at,id)<(anchor,p_cursor))order by created_at desc,id desc limit 21)q;
 else
  if p_request_id is not null then
   select *into entry from public.marketvision_intakes where id=p_request_id and property_id=p_property_id and org_id=organization;if not found then return '{"state":"not_found"}';end if;
   return jsonb_build_object('state','ready','intake',to_jsonb(entry),'existing',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'isActive',is_active)order by id)from public.competitors where property_id=p_property_id),'[]'),'decision',(select jsonb_build_object('actorId',actor_id,'input',input,'createdAt',created_at)from public.marketvision_decisions where id=entry.decision_id and property_id=p_property_id));
  end if;
  if p_cursor is not null then select created_at into anchor from public.marketvision_intakes where id=p_cursor and property_id=p_property_id and org_id=organization;if not found then return '{"state":"cursor_changed"}';end if;end if;
  select count(*)into total from public.marketvision_intakes where property_id=p_property_id and org_id=organization;
  select coalesce(jsonb_agg(to_jsonb(q)order by q.created_at desc,q.id desc),'[]')into items from(select id,created_at,state,version,jsonb_array_length(preview)as candidate_count from public.marketvision_intakes where property_id=p_property_id and org_id=organization and(p_cursor is null or(created_at,id)<(anchor,p_cursor))order by created_at desc,id desc limit 21)q;
 end if;
 return jsonb_build_object('state','ready','intakes',case when jsonb_array_length(items)>20 then items-20 else items end,'nextCursor',case when jsonb_array_length(items)>20 then items->19->>'id'else null end,'total',total,'legacy',p_legacy);
end$$;
revoke all on function public.guard_marketvision_intake(),public.begin_marketvision_intake(uuid,uuid,uuid,jsonb,jsonb),public.decide_marketvision_intake(uuid,uuid,uuid,jsonb),public.read_marketvision_intakes(uuid,uuid,uuid,uuid,boolean)from public,anon,authenticated;
grant execute on function public.begin_marketvision_intake(uuid,uuid,uuid,jsonb,jsonb),public.decide_marketvision_intake(uuid,uuid,uuid,jsonb),public.read_marketvision_intakes(uuid,uuid,uuid,uuid,boolean)to service_role;
revoke insert,update,delete on public.competitor_intake_batches,public.competitor_intake_candidates from public,anon,authenticated;

create or replace function public.marketvision_monitoring_rows(p_property_id uuid,p_org_id uuid)
returns table(id uuid,created_at timestamptz,updated_at timestamptz,kind text,request_state text,category text,label text,competitor_id uuid,brief_id uuid,handoff_id uuid,legacy_status text)
language sql stable security invoker set search_path=''as $$
 with saved as(
 select j.id,j.created_at,j.updated_at,
 case j.domain when 'marketvision.source'then 'source'when 'marketvision.extraction'then 'extraction'when 'marketvision.brief'then 'brief'when 'marketvision.intake'then 'intake'when 'marketvision.handoff'then 'handoff'else 'legacy'end kind,
 case j.domain when 'marketvision.source'then s.state when 'marketvision.extraction'then e.state when 'marketvision.brief'then b.state when 'marketvision.intake'then i.state when 'marketvision.handoff'then h.state else 'historical'end request_state,
 case j.domain when 'marketvision.source'then s.competitor_id when 'marketvision.extraction'then e.competitor_id end competitor_id,
 case j.domain when 'marketvision.brief'then b.id when 'marketvision.handoff'then h.brief_id end brief_id,
 h.id handoff_id,
 case when j.domain in('marketvision.ingestion','marketvision.proposal')then j.lifecycle_status end legacy_status,
 case when j.domain in('marketvision.ingestion','marketvision.proposal')then case j.subject_type when 'discovery'then 'Earlier competitor discovery'when 'observation_refresh'then 'Earlier price refresh'when 'brand_extraction'then 'Earlier brand extraction'when 'embedding'then 'Earlier search indexing'when 'change_detection'then 'Earlier change detection'when 'brief_generation'then 'Earlier brief generation'else 'Earlier MarketVision work'end
 when j.domain='marketvision.intake'then 'Saved competitor intake'when j.domain='marketvision.brief'then 'Saved market brief'when j.domain='marketvision.handoff'then coalesce(h.draft->>'title','Saved draft handoff')else coalesce(c.name,'Saved competitor work')end label
 from public.shared_jobs j
 left join public.marketvision_source_requests s on s.id=j.id and s.property_id=j.property_id and s.org_id=j.org_id
 left join public.marketvision_extraction_requests e on e.id=j.id and e.property_id=j.property_id and e.org_id=j.org_id
 left join public.marketvision_briefs b on b.id=j.id and b.property_id=j.property_id and b.org_id=j.org_id
 left join public.marketvision_intakes i on i.id=j.id and i.property_id=j.property_id and i.org_id=j.org_id
 left join public.marketvision_handoffs h on h.id=j.id and h.property_id=j.property_id and h.org_id=j.org_id
 left join public.competitors c on c.id=coalesce(s.competitor_id,e.competitor_id)and c.property_id=j.property_id
 where j.property_id=p_property_id and j.org_id=p_org_id and j.domain in('marketvision.intake','marketvision.source','marketvision.extraction','marketvision.brief','marketvision.handoff','marketvision.ingestion','marketvision.proposal')
 )
 select id,created_at,updated_at,kind,coalesce(request_state,'missing_record'),
 case when kind='legacy'then 'legacy'when request_state in('queued','running')then 'active'when request_state in('ready','completed','applied')then 'complete'when request_state in('stopped','rejected','withdrawn')then 'closed'else 'attention'end,
 label,competitor_id,brief_id,handoff_id,legacy_status from saved;
$$;

-- Generic job or context endpoints cannot rewrite the authority of a saved intake.
create function public.guard_marketvision_intake_job()returns trigger language plpgsql security invoker set search_path=''as $$
declare entry public.marketvision_intakes;begin
 if not exists(select 1 from public.properties where id=old.property_id)then return new;end if;
 select *into entry from public.marketvision_intakes where id=old.id;if not found then return new;end if;
 if(to_jsonb(new)-array['lifecycle_status','status_reason','stage','progress','current_step','updated_at'])is distinct from(to_jsonb(old)-array['lifecycle_status','status_reason','stage','progress','current_step','updated_at'])then raise exception 'Review this saved intake in MarketVision';end if;
 if entry.state='preview_ready'or new.lifecycle_status is distinct from(case when entry.state='applied'then 'succeeded'else 'cancelled'end)or new.status_reason is distinct from(case when entry.state='applied'then 'intake.applied'else 'intake.stopped'end)or new.stage is distinct from(case when entry.state='applied'then 'completed'else 'cancelled'end)or new.progress is distinct from 100 or new.current_step is distinct from 'Reviewed intake decision saved'then raise exception 'Review this saved intake in MarketVision';end if;
 return new;
end$$;
create trigger marketvision_intake_job_guard before update on public.shared_jobs for each row execute function public.guard_marketvision_intake_job();
create function public.guard_marketvision_intake_context()returns trigger language plpgsql security invoker set search_path=''as $$begin
 if exists(select 1 from public.marketvision_intakes i join public.properties p on p.id=i.property_id where i.context_id=old.id)then raise exception 'Saved intake context is immutable';end if;
 if tg_op='DELETE'then return old;end if;return new;
end$$;
create trigger marketvision_intake_context_guard before update or delete on public.shared_context_snapshots for each row execute function public.guard_marketvision_intake_context();
revoke all on function public.guard_marketvision_intake_job(),public.guard_marketvision_intake_context()from public,anon,authenticated;
