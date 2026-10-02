create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;


-- Exact CRM requests and receipts remain private; shared jobs contain only safe summaries.
create table public.crm_handoffs(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 lead_id uuid not null references public.leads(id) on delete cascade,
 integration_id uuid not null references public.integration_credentials(id) on delete cascade,
 actor_id uuid references public.profiles(id),origin text not null check(origin in ('operator','lumaleasing','siteforge','tourspark','workflow')),
 request_key text not null,input_hash text not null,kind text not null check(kind in ('lead','note')),
 revision bigint not null,approved_review_id uuid not null,validation_receipt_id uuid not null,
 credentials_hash text not null,field_mapping jsonb not null,source_snapshot jsonb not null,source_hash text not null,
 payload jsonb not null,external_id text,job_id uuid not null references public.shared_jobs(id) on delete cascade,
 attempt_id uuid not null references public.shared_action_attempts(id) on delete cascade,
 state text not null default 'queued' check(state in ('queued','searching','sending','confirmed','failed','needs_reconciliation','cancelled')),
 execution_approved_by uuid references public.profiles(id),execution_approved_at timestamptz,
 claim_id uuid,requested_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz,
 unique(property_id,request_key)
);
create index crm_handoffs_property_requested on public.crm_handoffs(property_id,requested_at desc);
create index crm_handoffs_lead on public.crm_handoffs(lead_id,requested_at desc);
create index crm_handoffs_integration on public.crm_handoffs(integration_id,state);
create index crm_handoffs_actor on public.crm_handoffs(actor_id);
create index crm_handoffs_job on public.crm_handoffs(job_id);
create index crm_handoffs_attempt on public.crm_handoffs(attempt_id);
alter table public.crm_handoffs enable row level security;
create policy crm_handoffs_service on public.crm_handoffs for all to service_role using(true) with check(true);
revoke all on public.crm_handoffs from public,anon,authenticated;grant all on public.crm_handoffs to service_role;

create table public.crm_handoff_receipts(
 id uuid primary key default gen_random_uuid(),handoff_id uuid not null references public.crm_handoffs(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,stage text not null check(stage in ('search','write_intent','result','reconciliation')),
 claim_id uuid not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(handoff_id,stage,claim_id)
);
create index crm_handoff_receipts_property on public.crm_handoff_receipts(property_id,created_at desc);
create trigger crm_handoff_receipts_immutable before update or delete on public.crm_handoff_receipts for each row execute function public.protect_shared_action_history();
alter table public.crm_handoff_receipts enable row level security;
create policy crm_handoff_receipts_service on public.crm_handoff_receipts for all to service_role using(true) with check(true);
revoke all on public.crm_handoff_receipts from public,anon,authenticated;grant all on public.crm_handoff_receipts to service_role;

create table public.crm_lead_links(
 lead_id uuid not null references public.leads(id) on delete cascade,
 integration_id uuid not null references public.integration_credentials(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 external_id text not null,handoff_id uuid not null references public.crm_handoffs(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(),primary key(lead_id,integration_id)
);
create index crm_lead_links_integration on public.crm_lead_links(integration_id);
create index crm_lead_links_property on public.crm_lead_links(property_id);
create index crm_lead_links_handoff on public.crm_lead_links(handoff_id);
create trigger crm_lead_links_immutable before update or delete on public.crm_lead_links for each row execute function public.protect_shared_action_history();
alter table public.crm_lead_links enable row level security;
create policy crm_lead_links_service on public.crm_lead_links for all to service_role using(true) with check(true);
revoke all on public.crm_lead_links from public,anon,authenticated;grant all on public.crm_lead_links to service_role;

create function public.crm_handoff_configuration_ready(p_integration_id uuid,p_revision bigint,p_review_id uuid,p_receipt_id uuid,p_credentials_hash text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.integration_credentials c join public.crm_mapping_reviews a on a.id=c.crm_approved_review_id join public.crm_validation_receipts r on r.id=c.crm_validation_receipt_id
 where c.id=p_integration_id and c.crm_revision=p_revision and c.crm_approved_review_id=p_review_id and c.crm_validation_receipt_id=p_receipt_id
 and c.mapping_validated is true and c.status in ('connected','verified') and public.crm_configuration_hash(c.credentials)=p_credentials_hash
 and a.integration_id=c.id and a.property_id=c.property_id and a.kind='approve' and a.revision=c.crm_revision and a.field_mapping=c.field_mapping and a.credentials_hash=p_credentials_hash
 and r.integration_id=c.id and r.property_id=c.property_id and r.revision=c.crm_revision and r.credentials_hash=p_credentials_hash and r.mapping_hash=public.crm_configuration_hash(c.field_mapping) and r.state='verified' and r.capabilities->'leadSearch'='true' and r.capabilities->'leadRead'='true' and r.capabilities->'leadWrite'='true');
$$;

create function public.request_crm_handoff(p_property_id uuid,p_lead_id uuid,p_request_key text,p_origin text,p_actor_id uuid default null,p_note text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;h public.crm_handoffs;l public.leads;organization uuid;input_hash text;source jsonb;payload jsonb;handoff uuid:=gen_random_uuid();job uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();link public.crm_lead_links;kind text;
begin
 if p_request_key is null or length(p_request_key) not between 8 and 200 or p_origin is null or p_origin not in ('operator','lumaleasing','siteforge','tourspark','workflow') or (p_origin='operator')<>(p_actor_id is not null) or (p_note is not null and length(trim(p_note)) not between 1 and 16000) then raise exception 'Invalid CRM handoff request';end if;
 select org_id into organization from public.properties where id=p_property_id;
 if organization is null then return '{"state":"not_found"}';end if;
 if p_actor_id is not null and not exists(select 1 from public.profiles where id=p_actor_id and org_id=organization and role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 kind:=case when p_note is null then 'lead' else 'note' end;
 input_hash:=public.crm_configuration_hash(jsonb_build_object('leadId',p_lead_id,'origin',p_origin,'actorId',p_actor_id,'note',p_note));
 select * into h from public.crm_handoffs where property_id=p_property_id and request_key=p_request_key;
 if found then
  if h.input_hash<>input_hash then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','handoffId',h.id,'deliveryState',h.state,'jobId',h.job_id);
 end if;
 select * into l from public.leads where id=p_lead_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if (select count(*) from public.integration_credentials where property_id=p_property_id and platform in ('crm','yardi','realpage','salesforce','hubspot','lasso'))<>1 then return '{"state":"configuration_required"}';end if;
 select * into c from public.integration_credentials where property_id=p_property_id and platform in ('yardi','realpage','salesforce','hubspot','lasso') for share;
 if c.id is null or not public.crm_handoff_configuration_ready(c.id,c.crm_revision,c.crm_approved_review_id,c.crm_validation_receipt_id,public.crm_configuration_hash(c.credentials)) then return '{"state":"qualification_required"}';end if;
 if kind='note' and not exists(select 1 from public.crm_validation_receipts where id=c.crm_validation_receipt_id and capabilities->'noteWrite'='true') then return '{"state":"note_capability_required"}';end if;
 if exists(select 1 from public.crm_handoffs where lead_id=l.id and integration_id=c.id and state in ('queued','searching','sending','needs_reconciliation')) then return '{"state":"handoff_in_progress"}';end if;
 select * into link from public.crm_lead_links where lead_id=l.id and integration_id=c.id;
 if l.external_crm_id is not null and link.lead_id is null then return '{"state":"legacy_link_review_required"}';end if;
 if kind='note' and link.lead_id is null then return '{"state":"confirmed_link_required"}';end if;
 if kind='lead' and link.lead_id is not null then return jsonb_build_object('state','already_linked','externalId',link.external_id,'handoffId',link.handoff_id);end if;
 source:=public.crm_lead_preview_input(p_property_id,p_lead_id);
 if kind='lead' and nullif(trim(l.email),'') is null and nullif(trim(l.phone),'') is null then return '{"state":"contact_required"}';end if;
 if kind='note' then payload:=jsonb_build_object('note',p_note);else
  select coalesce(jsonb_object_agg(m.value,source->m.key),'{}') into payload from jsonb_each_text(c.field_mapping) m where source->m.key is not null and source->m.key<>'null';
 end if;
 if length(source::text)+length(payload::text)>128000 then return '{"state":"payload_too_large"}';end if;
 insert into public.shared_jobs(id,org_id,property_id,domain,subject_type,subject_id,dedupe_key,payload,max_attempts)
 values(job,organization,p_property_id,'crm.delivery','lead',p_lead_id::text,'crm/'||handoff,jsonb_build_object('handoffId',handoff,'kind',kind,'origin',p_origin,'revision',c.crm_revision,'payloadHash',public.crm_configuration_hash(payload)),1);
 insert into public.shared_action_attempts(id,job_id,org_id,property_id,action_type,proposal_decision_status,requested_by,request_payload,execution_payload,policy_snapshot)
 values(attempt,job,organization,p_property_id,'deliver_crm_'||kind,case when p_origin='operator' then 'proposed' else 'approved' end,p_actor_id,jsonb_build_object('handoffId',handoff,'kind',kind),jsonb_build_object('handoffId',handoff),jsonb_build_object('mappingApprovalId',c.crm_approved_review_id,'validationReceiptId',c.crm_validation_receipt_id,'revision',c.crm_revision,'automaticRetry',false));
 insert into public.crm_handoffs(id,property_id,lead_id,integration_id,actor_id,origin,request_key,input_hash,kind,revision,approved_review_id,validation_receipt_id,credentials_hash,field_mapping,source_snapshot,source_hash,payload,external_id,job_id,attempt_id)
 values(handoff,p_property_id,l.id,c.id,p_actor_id,p_origin,p_request_key,input_hash,kind,c.crm_revision,c.crm_approved_review_id,c.crm_validation_receipt_id,public.crm_configuration_hash(c.credentials),c.field_mapping,source,public.crm_configuration_hash(source),payload,link.external_id,job,attempt);
 perform public.crm_record_handoff_action(handoff,handoff,'crm.delivery.requested','{"outcome":"queued","delivered":false}');
 return jsonb_build_object('state','queued','handoffId',handoff,'jobId',job,'attemptId',attempt);
end;$$;

create function public.claim_crm_handoff(p_handoff_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;c public.integration_credentials;claim uuid:=gen_random_uuid();
begin
 select * into h from public.crm_handoffs where id=p_handoff_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(h.property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id for update;
 if h.state<>'queued' then return jsonb_build_object('state',h.state);end if;
 if h.origin='operator' and h.execution_approved_at is null then return '{"state":"approval_required"}';end if;
 select * into c from public.integration_credentials where id=h.integration_id for share;
 if not public.crm_handoff_configuration_ready(c.id,h.revision,h.approved_review_id,h.validation_receipt_id,h.credentials_hash)
 or (h.kind='lead' and public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id))<>h.source_hash)
 or (h.actor_id is not null and not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=h.actor_id and p.id=h.property_id and u.role in ('admin','manager'))) then
  update public.crm_handoffs set state='cancelled',finished_at=clock_timestamp() where id=h.id;
  update public.shared_jobs set lifecycle_status='cancelled',finished_at=clock_timestamp(),status_reason='CRM approval, access or source changed before claim' where id=h.job_id;
  update public.shared_action_attempts set lifecycle_status='cancelled',error_message='CRM approval, access or source changed before claim' where id=h.attempt_id;
  return '{"state":"stale"}';
 end if;
 update public.crm_handoffs set state='searching',claim_id=claim,started_at=clock_timestamp() where id=h.id;
 update public.shared_jobs set lifecycle_status='running',started_at=clock_timestamp(),attempt_count=1 where id=h.job_id;
 update public.shared_action_attempts set lifecycle_status='running',execution_status='executing' where id=h.attempt_id;
 return jsonb_build_object('state','claimed','handoffId',h.id,'claimId',claim,'kind',h.kind,'platform',c.platform,'credentials',c.credentials,'payload',h.payload,'source',h.source_snapshot,'externalId',h.external_id,'mapping',h.field_mapping);
end;$$;

revoke all on function public.crm_handoff_configuration_ready(uuid,bigint,uuid,uuid,text),public.request_crm_handoff(uuid,uuid,text,text,uuid,text),public.claim_crm_handoff(uuid) from public,anon,authenticated;
grant execute on function public.crm_handoff_configuration_ready(uuid,bigint,uuid,uuid,text),public.request_crm_handoff(uuid,uuid,text,text,uuid,text),public.claim_crm_handoff(uuid) to service_role;
create function public.record_crm_handoff_search(p_handoff_id uuid,p_claim_id uuid,p_found boolean,p_external_id text default null,p_match_type text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;r public.crm_handoff_receipts;result jsonb;
begin
 if p_found is null or (p_found and nullif(trim(p_external_id),'') is null) or (not p_found and p_external_id is not null) or length(coalesce(p_external_id,''))>256 or p_match_type is not null and p_match_type not in ('email','phone','both') then raise exception 'Invalid CRM search receipt';end if;
 select * into h from public.crm_handoffs where id=p_handoff_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(h.property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id for update;
 if p_claim_id is null or h.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 result:=jsonb_build_object('found',p_found,'externalId',p_external_id,'matchType',p_match_type);
 select * into r from public.crm_handoff_receipts where handoff_id=h.id and stage='search' and claim_id=p_claim_id;
 if found then return jsonb_build_object('state',case when r.result=result then 'replayed' else 'request_conflict' end);end if;
 if h.state not in ('searching','cancelled') or h.kind<>'lead' then return '{"state":"not_searching"}';end if;
 insert into public.crm_handoff_receipts(handoff_id,property_id,stage,claim_id,result)values(h.id,h.property_id,'search',p_claim_id,result);
 return '{"state":"saved"}';
end;$$;

create function public.mark_crm_handoff_write(p_handoff_id uuid,p_claim_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;c public.integration_credentials;
begin
 select * into h from public.crm_handoffs where id=p_handoff_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(h.property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id for update;
 if p_claim_id is null or h.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 -- A repeated or unknown write-intent acknowledgment never permits another provider write.
 if h.state<>'searching' then return jsonb_build_object('state',h.state);end if;
 if h.kind='lead' and not exists(select 1 from public.crm_handoff_receipts where handoff_id=h.id and stage='search' and claim_id=p_claim_id and result->'found'='false') then return '{"state":"search_required"}';end if;
 select * into c from public.integration_credentials where id=h.integration_id for share;
 if not public.crm_handoff_configuration_ready(c.id,h.revision,h.approved_review_id,h.validation_receipt_id,h.credentials_hash)
 or h.kind='lead' and public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id))<>h.source_hash
 or h.actor_id is not null and not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=h.actor_id and p.id=h.property_id and u.role in ('admin','manager')) then return '{"state":"stale"}';end if;
 insert into public.crm_handoff_receipts(handoff_id,property_id,stage,claim_id,result)values(h.id,h.property_id,'write_intent',p_claim_id,jsonb_build_object('payloadHash',public.crm_configuration_hash(h.payload),'kind',h.kind,'integrationId',h.integration_id,'revision',h.revision));
 update public.crm_handoffs set state='sending' where id=h.id;
 return '{"state":"write_once"}';
end;$$;

create function public.finish_crm_handoff(p_handoff_id uuid,p_claim_id uuid,p_outcome text,p_external_id text default null,p_note_id text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;r public.crm_handoff_receipts;result jsonb;v_state text;v_status text;link public.crm_lead_links;
begin
 if p_outcome is null or p_outcome not in ('created','linked','note_added','failed','needs_reconciliation') or length(coalesce(p_external_id,''))>256 or length(coalesce(p_note_id,''))>256 then raise exception 'Invalid CRM completion';end if;
 select * into h from public.crm_handoffs where id=p_handoff_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(h.property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id for update;
 if p_claim_id is null or h.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 result:=jsonb_build_object('outcome',p_outcome,'externalId',p_external_id,'noteId',p_note_id);
 select * into r from public.crm_handoff_receipts where handoff_id=h.id and stage='result' and claim_id=p_claim_id;
 if found and r.result=result then return jsonb_build_object('state','replayed','deliveryState',h.state);end if;
 -- A worker can return after a saved recovery review. Keep the actual late acknowledgment.
 if (r.id is not null and r.result->>'outcome'='needs_reconciliation' or h.state='confirmed') and p_outcome in ('created','note_added') then
  if nullif(trim(p_external_id),'') is null or not exists(select 1 from public.crm_handoff_receipts where handoff_id=h.id and stage='write_intent' and claim_id=p_claim_id)
   or p_outcome='created' and h.kind<>'lead' or p_outcome='note_added' and (h.kind<>'note' or p_external_id is distinct from h.external_id or nullif(trim(p_note_id),'') is null) then return '{"state":"write_proof_required"}';end if;
  select * into r from public.crm_handoff_receipts where handoff_id=h.id and stage='late_result' and claim_id=p_claim_id;
  if found then return jsonb_build_object('state',case when r.result=result then 'replayed' else 'request_conflict' end,'deliveryState',h.state);end if;
  insert into public.crm_handoff_receipts(handoff_id,property_id,stage,claim_id,result)values(h.id,h.property_id,'late_result',p_claim_id,result);
  if h.external_id is not null and h.external_id<>p_external_id then
   update public.crm_handoffs set state='needs_reconciliation' where id=h.id;
   update public.shared_jobs set lifecycle_status='failed',status_reason='Late provider acknowledgment conflicts with reviewed destination' where id=h.job_id;
   update public.shared_action_attempts set lifecycle_status='failed',execution_status='failed',execution_result=jsonb_build_object('handoffId',h.id,'outcome','destination_conflict','receiptId',(select id from public.crm_handoff_receipts where handoff_id=h.id and stage='late_result' and claim_id=p_claim_id)) where id=h.attempt_id;
   update public.leads set crm_sync_status='dead_lettered',crm_sync_error='Late provider acknowledgment conflicts with reviewed destination',crm_sync_next_retry_at=null where id=h.lead_id;
  end if;
  perform public.crm_record_handoff_action(h.id,(select id from public.crm_handoff_receipts where handoff_id=h.id and stage='late_result' and claim_id=p_claim_id),'crm.delivery.completed',jsonb_build_object('outcome','late_acknowledgment','destinationConflict',h.external_id is not null and h.external_id<>p_external_id));
  return jsonb_build_object('state','saved','deliveryState',(select state from public.crm_handoffs where id=h.id));
 end if;
 if r.id is not null then return jsonb_build_object('state','request_conflict','deliveryState',h.state);end if;
 if h.state not in ('searching','sending') then return jsonb_build_object('state',h.state);end if;
 if p_outcome in ('created','linked','note_added') and nullif(trim(p_external_id),'') is null then return '{"state":"external_id_required"}';end if;
 if p_outcome='linked' and (h.kind<>'lead' or h.state<>'searching' or not exists(select 1 from public.crm_handoff_receipts sr where sr.handoff_id=h.id and sr.stage='search' and sr.claim_id=p_claim_id and sr.result->>'externalId'=p_external_id and sr.result->'found'='true')) then return '{"state":"search_proof_required"}';end if;
 if p_outcome='created' and (h.kind<>'lead' or h.state<>'sending') then return '{"state":"write_proof_required"}';end if;
 if p_outcome='note_added' and (h.kind<>'note' or h.state<>'sending' or p_external_id is distinct from h.external_id or nullif(trim(p_note_id),'') is null) then return '{"state":"note_proof_required"}';end if;
 if p_outcome='failed' and h.state='sending' then return '{"state":"reconciliation_required"}';end if;
 v_state:=case when p_outcome in ('created','linked','note_added') then 'confirmed' else p_outcome end;
 insert into public.crm_handoff_receipts(handoff_id,property_id,stage,claim_id,result)values(h.id,h.property_id,'result',p_claim_id,result);
 update public.crm_handoffs set state=v_state,external_id=coalesce(p_external_id,external_id),finished_at=clock_timestamp() where id=h.id;
 if p_outcome in ('created','linked') then
  select * into link from public.crm_lead_links where lead_id=h.lead_id and integration_id=h.integration_id;
  if link.lead_id is not null and link.external_id<>p_external_id then raise exception 'CRM link conflicts with recorded destination';end if;
  insert into public.crm_lead_links(lead_id,integration_id,property_id,external_id,handoff_id)values(h.lead_id,h.integration_id,h.property_id,p_external_id,h.id)on conflict(lead_id,integration_id)do nothing;
  update public.leads set external_crm_id=p_external_id,crm_synced_at=clock_timestamp(),crm_sync_status=case when public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id))=h.source_hash then p_outcome else 'pending' end,
   crm_sync_error=null,crm_sync_next_retry_at=null,crm_dead_lettered_at=null where id=h.lead_id and property_id=h.property_id;
 elsif p_outcome in ('failed','needs_reconciliation') then
  update public.leads set crm_sync_status='dead_lettered',crm_sync_error=case when p_outcome='needs_reconciliation' then 'CRM delivery outcome is uncertain. Review the saved handoff before another attempt.' else 'CRM handoff stopped before a provider write. Review its saved result.' end,crm_sync_next_retry_at=null,crm_dead_lettered_at=clock_timestamp() where id=h.lead_id and property_id=h.property_id;
 end if;
 v_status:=case when v_state='confirmed' then 'succeeded' else 'failed' end;
 update public.shared_jobs set lifecycle_status=v_status,status_reason=case when v_state='needs_reconciliation' then 'CRM outcome requires reconciliation; replay is held' else p_outcome end,finished_at=clock_timestamp() where id=h.job_id;
 update public.shared_action_attempts set lifecycle_status=v_status,execution_status=case when v_state='confirmed' then 'executed' else 'failed' end,execution_result=jsonb_build_object('handoffId',h.id,'outcome',p_outcome,'receiptId',(select id from public.crm_handoff_receipts where handoff_id=h.id and stage='result' and claim_id=p_claim_id)),executed_at=case when v_state='confirmed' then clock_timestamp() end where id=h.attempt_id;
 perform public.crm_record_handoff_action(h.id,(select id from public.crm_handoff_receipts where handoff_id=h.id and stage='result' and claim_id=p_claim_id),'crm.delivery.completed',jsonb_build_object('outcome',p_outcome,'deliveryState',v_state));
 return jsonb_build_object('state','saved','deliveryState',v_state,'handoffId',h.id);
end;$$;

revoke all on function public.record_crm_handoff_search(uuid,uuid,boolean,text,text),public.mark_crm_handoff_write(uuid,uuid),public.finish_crm_handoff(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.record_crm_handoff_search(uuid,uuid,boolean,text,text),public.mark_crm_handoff_write(uuid,uuid),public.finish_crm_handoff(uuid,uuid,text,text,text) to service_role;
create function public.crm_record_handoff_action(p_handoff_id uuid,p_event_id uuid,p_action text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;e jsonb;
begin
 select * into h from public.crm_handoffs where id=p_handoff_id;
 if h.actor_id is null or not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=h.property_id and u.id=h.actor_id) then return;end if;
 e:=public.append_shared_action_event(p_event_id,h.id,h.property_id,h.actor_id,'crm',p_action,'server_confirmed',case when p_result->>'outcome' in ('failed','needs_reconciliation') then 'failed' else 'succeeded' end,
 jsonb_build_object('handoffId',h.id,'kind',h.kind,'origin',h.origin,'leadId',h.lead_id,'revision',h.revision,'payloadHash',public.crm_configuration_hash(h.payload)),null,null,p_result,jsonb_build_object('jobId',h.job_id,'attemptId',h.attempt_id));
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM delivery history unavailable';end if;
end;$$;

create function public.stop_crm_handoff(p_property_id uuid,p_actor_id uuid,p_handoff_id uuid,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;e jsonb;
begin
 if p_request_id is null then raise exception 'CRM stop identity required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if h.state in ('sending','needs_reconciliation') then return '{"state":"reconciliation_required"}';end if;
 if h.state not in ('queued','searching') then return jsonb_build_object('state',h.state);end if;
 update public.crm_handoffs set state='cancelled',finished_at=clock_timestamp() where id=h.id;
 update public.shared_jobs set lifecycle_status='cancelled',finished_at=clock_timestamp(),status_reason='Stopped before provider write' where id=h.job_id;
 update public.shared_action_attempts set lifecycle_status='cancelled',execution_status='cancelled' where id=h.attempt_id;
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.delivery.cancelled','server_confirmed','succeeded',jsonb_build_object('handoffId',h.id),null,null,'{"state":"cancelled","writeStarted":false}',jsonb_build_object('jobId',h.job_id,'attemptId',h.attempt_id));
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM cancellation history unavailable';end if;
 return '{"state":"cancelled"}';
end;$$;

create function public.read_crm_handoffs(p_property_id uuid,p_actor_id uuid,p_page integer default 1) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;total bigint;
begin
 if p_page is null or p_page<1 or p_page>100000 then raise exception 'Invalid delivery page';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select count(*) into total from public.crm_handoffs where property_id=p_property_id;
 select coalesce(jsonb_agg(row order by created_at desc),'[]') into rows from (
 select h.requested_at created_at,jsonb_build_object('id',h.id,'leadId',h.lead_id,'leadName',concat_ws(' ',l.first_name,l.last_name),'kind',h.kind,'platform',c.platform,'revision',h.revision,'state',h.state,'origin',h.origin,'requestedAt',h.requested_at,'startedAt',h.started_at,'finishedAt',h.finished_at,'externalId',h.external_id,'approved',h.execution_approved_at is not null,'jobId',h.job_id,'receipt',(select jsonb_build_object('id',r.id,'result',r.result,'receivedAt',r.created_at) from public.crm_handoff_receipts r where r.handoff_id=h.id and r.stage in ('result','reconciliation') order by r.created_at desc limit 1)) row
 from public.crm_handoffs h join public.leads l on l.id=h.lead_id join public.integration_credentials c on c.id=h.integration_id where h.property_id=p_property_id order by h.requested_at desc,h.id desc offset (p_page-1)*25 limit 25
 ) selected;
 return jsonb_build_object('state','saved','handoffs',rows,'total',total,'page',p_page,'pages',greatest(1,ceil(total::numeric/25)));
end;$$;

-- Prevent replacement of credentials needed to reconcile an uncertain in-flight write.
create function public.guard_crm_unfinished_delivery() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
 if old.platform not in ('crm','yardi','realpage','salesforce','hubspot','lasso') then if tg_op='DELETE' then return old;end if;return new;end if;
 if tg_op='UPDATE' and (new.credentials,new.field_mapping,new.platform,new.property_id) is not distinct from (old.credentials,old.field_mapping,old.platform,old.property_id) then return new;end if;
 if exists(select 1 from public.crm_handoffs where integration_id=old.id and state in ('sending','needs_reconciliation')) then raise exception 'Resolve the unfinished CRM delivery before replacing its connection';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
create trigger crm_unfinished_delivery before update or delete on public.integration_credentials for each row execute function public.guard_crm_unfinished_delivery();
revoke all on function public.crm_record_handoff_action(uuid,uuid,text,jsonb),public.stop_crm_handoff(uuid,uuid,uuid,uuid),public.read_crm_handoffs(uuid,uuid,integer),public.guard_crm_unfinished_delivery() from public,anon,authenticated;
grant execute on function public.crm_record_handoff_action(uuid,uuid,text,jsonb),public.stop_crm_handoff(uuid,uuid,uuid,uuid),public.read_crm_handoffs(uuid,uuid,integer),public.guard_crm_unfinished_delivery() to service_role;
create index crm_handoffs_execution_approver on public.crm_handoffs(execution_approved_by);
create table public.crm_handoff_approvals(
 id uuid primary key,handoff_id uuid not null references public.crm_handoffs(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),payload_hash text not null,created_at timestamptz not null default clock_timestamp(),unique(handoff_id)
);
create index crm_handoff_approvals_property on public.crm_handoff_approvals(property_id);
create index crm_handoff_approvals_actor on public.crm_handoff_approvals(actor_id);
create trigger crm_handoff_approvals_immutable before update or delete on public.crm_handoff_approvals for each row execute function public.protect_shared_action_history();
alter table public.crm_handoff_approvals enable row level security;
create policy crm_handoff_approvals_service on public.crm_handoff_approvals for all to service_role using(true) with check(true);
revoke all on public.crm_handoff_approvals from public,anon,authenticated;grant all on public.crm_handoff_approvals to service_role;

create function public.preview_crm_handoff(p_property_id uuid,p_actor_id uuid,p_handoff_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare h public.crm_handoffs;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select * into h from public.crm_handoffs where id=p_handoff_id and property_id=p_property_id;
 if not found then return '{"state":"not_found"}';end if;
 return jsonb_build_object('state','saved','handoffId',h.id,'kind',h.kind,'deliveryState',h.state,'payload',h.payload,'payloadHash',public.crm_configuration_hash(h.payload),'revision',h.revision,'externalId',h.external_id,'confirmationKind',(select result->>'outcome' from public.crm_handoff_receipts where handoff_id=h.id and stage in ('result','reconciliation') order by created_at desc limit 1),'recoveryChecks',(select coalesce(jsonb_agg(row order by requested_at desc),'[]') from (select c.requested_at,jsonb_build_object('id',c.id,'state',c.state,'requestedAt',c.requested_at,'evidence',r.result,'evidenceHash',case when r.id is not null then public.crm_configuration_hash(r.result) end) row from public.crm_reconciliation_checks c left join public.crm_handoff_receipts r on r.handoff_id=c.handoff_id and r.stage='reconciliation_check' and r.claim_id=c.id where c.handoff_id=h.id order by c.requested_at desc limit 10) selected),'approved',h.execution_approved_at is not null,'canApprove',h.origin='operator' and h.actor_id=p_actor_id and h.state='queued' and exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','manager')));
end;$$;

create function public.approve_crm_handoff(p_property_id uuid,p_actor_id uuid,p_handoff_id uuid,p_request_id uuid,p_payload_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;a public.crm_handoff_approvals;e jsonb;
begin
 if p_request_id is null or p_payload_hash is null then raise exception 'Saved delivery preview required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if h.origin<>'operator' or h.actor_id is distinct from p_actor_id then return '{"state":"owner_required"}';end if;
 if public.crm_configuration_hash(h.payload)<>p_payload_hash then return '{"state":"preview_conflict"}';end if;
 select * into a from public.crm_handoff_approvals where id=p_request_id;
 if found then
  if (a.handoff_id,a.property_id,a.actor_id,a.payload_hash) is distinct from (h.id,p_property_id,p_actor_id,p_payload_hash) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','deliveryState',h.state,'handoffId',h.id);
 end if;
 if h.state<>'queued' then return jsonb_build_object('state',h.state);end if;
 if h.kind='lead' and public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id))<>h.source_hash then return '{"state":"stale_source"}';end if;
 if not public.crm_handoff_configuration_ready(h.integration_id,h.revision,h.approved_review_id,h.validation_receipt_id,h.credentials_hash) then return '{"state":"stale_configuration"}';end if;
 if exists(select 1 from public.crm_handoff_approvals where handoff_id=h.id) then return '{"state":"already_approved"}';end if;
 insert into public.crm_handoff_approvals(id,handoff_id,property_id,actor_id,payload_hash)values(p_request_id,h.id,p_property_id,p_actor_id,p_payload_hash);
 update public.crm_handoffs set execution_approved_by=p_actor_id,execution_approved_at=clock_timestamp() where id=h.id;
 update public.shared_action_attempts set proposal_decision_status='approved',execution_status='approved_pending_execution',reviewed_by=p_actor_id,decided_at=clock_timestamp() where id=h.attempt_id;
 insert into public.shared_approvals(id,action_attempt_id,org_id,property_id,decision_status,decision_reason,reviewer_profile_id,decision_payload)select p_request_id,h.attempt_id,p.org_id,h.property_id,'approved','Operator approved the exact saved CRM transfer',p_actor_id,jsonb_build_object('handoffId',h.id,'payloadHash',p_payload_hash)from public.properties p where p.id=h.property_id;
 e:=public.append_shared_action_event(p_request_id,h.id,p_property_id,p_actor_id,'crm','crm.delivery.approved','server_confirmed','succeeded',jsonb_build_object('handoffId',h.id,'payloadHash',p_payload_hash,'revision',h.revision),null,null,'{"approved":true,"delivered":false}',jsonb_build_object('jobId',h.job_id,'attemptId',h.attempt_id));
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM approval history unavailable';end if;
 return jsonb_build_object('state','applied','handoffId',h.id);
end;$$;
revoke all on function public.preview_crm_handoff(uuid,uuid,uuid),public.approve_crm_handoff(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.preview_crm_handoff(uuid,uuid,uuid),public.approve_crm_handoff(uuid,uuid,uuid,uuid,text) to service_role;
create or replace function public.save_crm_mapping_review(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_platform text,p_revision bigint,p_credentials jsonb,p_mapping jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;r public.crm_mapping_reviews;input_hash text;creds jsonb;result jsonb;e jsonb;before_state jsonb;
begin
 if p_request_id is null or p_platform is null or p_platform not in ('yardi','realpage','salesforce','hubspot','lasso') or p_revision is null or p_revision<0 or jsonb_typeof(p_mapping) is distinct from 'object' or length(p_mapping::text)>8000
  or (p_credentials is not null and (jsonb_typeof(p_credentials) is distinct from 'object' or length(p_credentials::text)>16000)) then raise exception 'Invalid CRM mapping request';end if;
 if exists(select 1 from jsonb_each_text(p_mapping) m where m.key not in ('first_name','last_name','email','phone','source','status','move_in_date','bedrooms','notes') or m.value !~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$') or exists(select 1 from jsonb_each(p_mapping) m where jsonb_typeof(m.value)<>'string') then raise exception 'Invalid CRM field mapping';end if;
 if (select count(*) from jsonb_each_text(p_mapping))<>(select count(distinct value) from jsonb_each_text(p_mapping)) then return '{"state":"duplicate_targets"}';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input_hash:=public.crm_configuration_hash(jsonb_build_object('platform',p_platform,'revision',p_revision,'credentials',p_credentials,'mapping',p_mapping));
 select * into r from public.crm_mapping_reviews where id=p_request_id;
 if found then
  if (r.property_id,r.actor_id,r.kind,r.input_hash) is distinct from (p_property_id,p_actor_id,'save',input_hash) then return '{"state":"request_conflict"}';end if;
  return r.result||'{"state":"replayed"}';
 end if;
 if exists(select 1 from public.integration_credentials where property_id=p_property_id and platform in ('crm','yardi','realpage','salesforce','hubspot','lasso') and platform<>p_platform) then return '{"state":"provider_change_requires_review"}';end if;
 select * into c from public.integration_credentials where property_id=p_property_id and platform=p_platform for update;
 if exists(select 1 from public.crm_handoffs where integration_id=c.id and state in ('sending','needs_reconciliation')) then return '{"state":"unfinished_delivery"}';end if;
 if coalesce(c.crm_revision,0)<>p_revision then return '{"state":"stale"}';end if;
 creds:=coalesce(p_credentials,c.credentials);
 if creds is null or creds='{}' or jsonb_typeof(creds)<>'object' then return '{"state":"credentials_required"}';end if;
 before_state:=case when c.id is not null then jsonb_build_object('integrationId',c.id,'revision',c.crm_revision,'platform',c.platform,'status',c.status) end;
 if c.id is null then
  insert into public.integration_credentials(property_id,platform,credentials,field_mapping,mapping_validated,status) values(p_property_id,p_platform,creds,p_mapping,false,'pending') returning * into c;
 else
  update public.integration_credentials set credentials=creds,field_mapping=p_mapping,mapping_validated=false,mapping_validated_at=null,status='pending',crm_approved_review_id=null,crm_validation_receipt_id=null where id=c.id returning * into c;
 end if;
 result:=jsonb_build_object('state','applied','integrationId',c.id,'revision',c.crm_revision,'reviewId',p_request_id,'providerVerified',false);
 insert into public.crm_mapping_reviews(id,property_id,actor_id,integration_id,kind,input_hash,revision,field_mapping,credentials_hash,result)
 values(p_request_id,p_property_id,p_actor_id,c.id,'save',input_hash,c.crm_revision,p_mapping,public.crm_configuration_hash(creds),result);
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.mapping.saved','server_confirmed','succeeded',
 jsonb_build_object('platform',p_platform,'fieldCount',(select count(*) from jsonb_each(p_mapping)),'credentialsReplaced',p_credentials is not null),before_state,
 jsonb_build_object('integrationId',c.id,'revision',c.crm_revision,'status','pending','mappingHash',public.crm_configuration_hash(p_mapping)),result);
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM mapping history unavailable';end if;
 return result;
end;$$;-- Recovery reads never authorize another write. Only verified destination evidence can be accepted.
alter table public.crm_handoff_receipts drop constraint crm_handoff_receipts_stage_check;
alter table public.crm_handoff_receipts add constraint crm_handoff_receipts_stage_check check(stage in ('search','write_intent','result','reconciliation','reconciliation_check','late_result'));
create table public.crm_reconciliation_checks(
 id uuid primary key,handoff_id uuid not null references public.crm_handoffs(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,actor_id uuid not null references public.profiles(id),
 state text not null default 'queued' check(state in ('queued','running','completed','cancelled')),
 claim_id uuid,requested_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
create index crm_reconciliation_checks_handoff on public.crm_reconciliation_checks(handoff_id,requested_at desc);
create index crm_reconciliation_checks_property on public.crm_reconciliation_checks(property_id);
create index crm_reconciliation_checks_actor on public.crm_reconciliation_checks(actor_id);
alter table public.crm_reconciliation_checks enable row level security;
create policy crm_reconciliation_checks_service on public.crm_reconciliation_checks for all to service_role using(true) with check(true);
revoke all on public.crm_reconciliation_checks from public,anon,authenticated;grant all on public.crm_reconciliation_checks to service_role;

create function public.request_crm_reconciliation(p_property_id uuid,p_actor_id uuid,p_handoff_id uuid,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;c public.crm_reconciliation_checks;e jsonb;
begin
 if p_request_id is null then raise exception 'Saved recovery identity required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into c from public.crm_reconciliation_checks where id=p_request_id;
 if found then
  if (c.property_id,c.actor_id,c.handoff_id) is distinct from (p_property_id,p_actor_id,p_handoff_id) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','checkId',c.id);
 end if;
 select * into h from public.crm_handoffs where id=p_handoff_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if h.state not in ('sending','needs_reconciliation') then return '{"state":"recovery_not_required"}';end if;
 if h.state='sending' and exists(select 1 from public.crm_handoff_receipts where handoff_id=h.id and stage='write_intent' and created_at>clock_timestamp()-interval '2 minutes') then return '{"state":"worker_pending"}';end if;
 insert into public.crm_reconciliation_checks(id,handoff_id,property_id,actor_id)values(p_request_id,h.id,p_property_id,p_actor_id);
 e:=public.append_shared_action_event(p_request_id,h.id,p_property_id,p_actor_id,'crm','crm.delivery.recovery_requested','server_confirmed','succeeded',jsonb_build_object('handoffId',h.id,'checkId',p_request_id),null,null,'{"writeAuthorized":false}',jsonb_build_object('jobId',h.job_id,'attemptId',h.attempt_id));
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM recovery history unavailable';end if;
 return jsonb_build_object('state','queued','checkId',p_request_id);
end;$$;

create function public.claim_crm_reconciliation(p_check_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.crm_reconciliation_checks;h public.crm_handoffs;i public.integration_credentials;claim uuid:=gen_random_uuid();
begin
 select * into c from public.crm_reconciliation_checks where id=p_check_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.property_id::text,12));
 select * into c from public.crm_reconciliation_checks where id=p_check_id for update;
 if c.state<>'queued' then return jsonb_build_object('state',c.state);end if;
 select * into h from public.crm_handoffs where id=c.handoff_id;
 select * into i from public.integration_credentials where id=h.integration_id for share;
 if h.state not in ('sending','needs_reconciliation') or i.crm_revision<>h.revision or public.crm_configuration_hash(i.credentials)<>h.credentials_hash
 or not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=c.property_id and u.id=c.actor_id and u.role in ('admin','manager')) then
  update public.crm_reconciliation_checks set state='cancelled',finished_at=clock_timestamp() where id=c.id;return '{"state":"stale"}';end if;
 update public.crm_reconciliation_checks set state='running',claim_id=claim where id=c.id;
 return jsonb_build_object('state','claimed','claimId',claim,'kind',h.kind,'platform',i.platform,'credentials',i.credentials,'source',h.source_snapshot,'mapping',h.field_mapping,'externalId',h.external_id);
end;$$;

create function public.finish_crm_reconciliation(p_check_id uuid,p_claim_id uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.crm_reconciliation_checks;h public.crm_handoffs;r public.crm_handoff_receipts;receipt uuid:=gen_random_uuid();e jsonb;
begin
 if p_result is null or jsonb_typeof(p_result)<>'object' or length(p_result::text)>16000 or p_result->>'status' is null or p_result->>'status' not in ('match','no_match','unconfirmed','unsupported') then raise exception 'Invalid recovery evidence';end if;
 if p_result->>'status'='match' and (nullif(trim(p_result->>'externalId'),'') is null or length(p_result->>'externalId')>256 or p_result->>'matchType' is null or p_result->>'matchType' not in ('email','phone','both')) then raise exception 'Verified contact and destination required';end if;
 select * into c from public.crm_reconciliation_checks where id=p_check_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(c.property_id::text,12));
 select * into c from public.crm_reconciliation_checks where id=p_check_id for update;
 if p_claim_id is null or c.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 select * into r from public.crm_handoff_receipts where handoff_id=c.handoff_id and stage='reconciliation_check' and claim_id=c.id;
 if found then return jsonb_build_object('state',case when r.result=p_result then 'replayed' else 'request_conflict' end);end if;
 if c.state<>'running' then return jsonb_build_object('state',c.state);end if;
 select * into h from public.crm_handoffs where id=c.handoff_id;
 if h.kind='note' and p_result->>'status'='match' then raise exception 'A lead search cannot prove a note was delivered';end if;
 insert into public.crm_handoff_receipts(id,handoff_id,property_id,stage,claim_id,result)values(receipt,h.id,h.property_id,'reconciliation_check',c.id,p_result);
 update public.crm_reconciliation_checks set state='completed',finished_at=clock_timestamp() where id=c.id;
 if exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=c.property_id and u.id=c.actor_id) then
  e:=public.append_shared_action_event(receipt,h.id,c.property_id,c.actor_id,'crm','crm.delivery.recovery_checked','server_confirmed','succeeded',jsonb_build_object('handoffId',h.id,'checkId',c.id),null,null,jsonb_build_object('status',p_result->>'status','writeAuthorized',false),jsonb_build_object('jobId',h.job_id,'attemptId',h.attempt_id));
  if e->>'state' not in ('recorded','replayed') then raise exception 'CRM recovery history unavailable';end if;
 end if;
 return '{"state":"saved"}';
end;$$;

create function public.accept_crm_reconciliation(p_property_id uuid,p_actor_id uuid,p_handoff_id uuid,p_check_id uuid,p_evidence_hash text,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;c public.crm_reconciliation_checks;r public.crm_handoff_receipts;prior public.crm_handoff_receipts;i public.integration_credentials;e jsonb;destination text;
begin
 if p_request_id is null or p_evidence_hash is null then raise exception 'Exact saved recovery review required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 select * into prior from public.crm_handoff_receipts where id=p_request_id;
 if found then
  if prior.handoff_id=h.id and prior.stage='reconciliation' and prior.result->>'actorId'=p_actor_id::text and prior.result->>'checkId'=p_check_id::text and prior.result->>'evidenceHash'=p_evidence_hash then return '{"state":"replayed"}';end if;
  return '{"state":"request_conflict"}';end if;
 if h.kind<>'lead' then return '{"state":"note_evidence_required"}';end if;
 if h.state not in ('sending','needs_reconciliation') then return jsonb_build_object('state',h.state);end if;
 select * into c from public.crm_reconciliation_checks where id=p_check_id and handoff_id=h.id and state='completed';
 select * into r from public.crm_handoff_receipts where handoff_id=h.id and stage='reconciliation_check' and claim_id=c.id;
 if r.id is null or public.crm_configuration_hash(r.result)<>p_evidence_hash then return '{"state":"preview_conflict"}';end if;
 if r.result->>'status'<>'match' then return '{"state":"destination_unconfirmed"}';end if;
 if r.created_at<clock_timestamp()-interval '15 minutes' then return '{"state":"evidence_expired"}';end if;
 select * into i from public.integration_credentials where id=h.integration_id for share;
 if i.crm_revision<>h.revision or public.crm_configuration_hash(i.credentials)<>h.credentials_hash then return '{"state":"stale_configuration"}';end if;
 destination:=r.result->>'externalId';
 if exists(select 1 from public.crm_handoff_receipts where handoff_id=h.id and stage='late_result' and result->>'externalId'<>destination) or h.external_id is not null and h.external_id<>destination or exists(select 1 from public.crm_lead_links where lead_id=h.lead_id and integration_id=h.integration_id and external_id<>destination) then return '{"state":"destination_conflict"}';end if;
 insert into public.crm_handoff_receipts(id,handoff_id,property_id,stage,claim_id,result)values(p_request_id,h.id,h.property_id,'reconciliation',c.id,jsonb_build_object('outcome','destination_confirmed','externalId',destination,'checkId',c.id,'evidenceReceiptId',r.id,'evidenceHash',p_evidence_hash,'actorId',p_actor_id,'originalWriteConfirmed',false));
 insert into public.crm_lead_links(lead_id,integration_id,property_id,external_id,handoff_id)values(h.lead_id,h.integration_id,h.property_id,destination,h.id)on conflict(lead_id,integration_id)do nothing;
 update public.crm_handoffs set state='confirmed',external_id=destination,finished_at=clock_timestamp() where id=h.id;
 update public.leads set external_crm_id=destination,crm_synced_at=clock_timestamp(),crm_sync_status=case when public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id))=h.source_hash then 'linked' else 'pending' end,crm_sync_error=null,crm_sync_next_retry_at=null,crm_dead_lettered_at=null where id=h.lead_id and property_id=h.property_id;
 update public.shared_jobs set lifecycle_status='succeeded',status_reason='Destination confirmed by reviewed read evidence; original write remains unconfirmed',finished_at=clock_timestamp() where id=h.job_id;
 update public.shared_action_attempts set lifecycle_status='succeeded',execution_status='executed',execution_result=jsonb_build_object('handoffId',h.id,'outcome','destination_confirmed','receiptId',p_request_id,'originalWriteConfirmed',false) where id=h.attempt_id;
 e:=public.append_shared_action_event(p_request_id,h.id,h.property_id,p_actor_id,'crm','crm.delivery.reconciled','server_confirmed','succeeded',jsonb_build_object('handoffId',h.id,'checkId',c.id,'evidenceHash',p_evidence_hash),null,null,'{"destinationConfirmed":true,"originalWriteConfirmed":false,"resent":false}',jsonb_build_object('jobId',h.job_id,'attemptId',h.attempt_id));
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM reconciliation history unavailable';end if;
 return '{"state":"applied","deliveryState":"confirmed"}';
end;$$;
revoke all on function public.request_crm_reconciliation(uuid,uuid,uuid,uuid),public.claim_crm_reconciliation(uuid),public.finish_crm_reconciliation(uuid,uuid,jsonb),public.accept_crm_reconciliation(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.request_crm_reconciliation(uuid,uuid,uuid,uuid),public.claim_crm_reconciliation(uuid),public.finish_crm_reconciliation(uuid,uuid,jsonb),public.accept_crm_reconciliation(uuid,uuid,uuid,uuid,text,uuid) to service_role;
create function public.protect_crm_handoff_request() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
  raise exception 'CRM transfer history is immutable';
 end if;
 if (new.id,new.property_id,new.lead_id,new.integration_id,new.actor_id,new.origin,new.request_key,new.input_hash,new.kind,new.revision,new.approved_review_id,new.validation_receipt_id,new.credentials_hash,new.field_mapping,new.source_snapshot,new.source_hash,new.payload,new.job_id,new.attempt_id,new.requested_at)
 is distinct from (old.id,old.property_id,old.lead_id,old.integration_id,old.actor_id,old.origin,old.request_key,old.input_hash,old.kind,old.revision,old.approved_review_id,old.validation_receipt_id,old.credentials_hash,old.field_mapping,old.source_snapshot,old.source_hash,old.payload,old.job_id,old.attempt_id,old.requested_at) then raise exception 'CRM transfer values and source identity are immutable';end if;
 return new;
end;$$;
create trigger crm_handoff_request_immutable before update or delete on public.crm_handoffs for each row execute function public.protect_crm_handoff_request();
revoke all on function public.protect_crm_handoff_request() from public,anon,authenticated;
grant execute on function public.protect_crm_handoff_request() to service_role;

notify pgrst,'reload schema';
