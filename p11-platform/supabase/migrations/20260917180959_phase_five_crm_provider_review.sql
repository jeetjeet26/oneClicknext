create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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

create or replace function public.crm_lead_preview_input(p_property_id uuid,p_lead_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('first_name',l.first_name,'last_name',l.last_name,'email',l.email,'phone',l.phone,'source',l.source,'status',l.status,'move_in_date',l.move_in_date,'bedrooms',l.bedrooms,'notes',l.notes,'property_name',p.name)
 from public.leads l join public.properties p on p.id=l.property_id where l.id=p_lead_id and p.id=p_property_id;
$$;


create or replace function public.save_crm_mapping_review(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_platform text,p_revision bigint,p_credentials jsonb,p_mapping jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;r public.crm_mapping_reviews;input_hash text;creds jsonb;result jsonb;e jsonb;before_state jsonb;
begin
 if p_request_id is null or p_platform is null or p_platform not in ('yardi','realpage','salesforce','hubspot','lasso') or p_revision is null or p_revision<0 or jsonb_typeof(p_mapping) is distinct from 'object' or length(p_mapping::text)>8000
  or (p_credentials is not null and (jsonb_typeof(p_credentials) is distinct from 'object' or length(p_credentials::text)>16000)) then raise exception 'Invalid CRM mapping request';end if;
 if exists(select 1 from jsonb_each_text(p_mapping) m where m.key not in ('first_name','last_name','email','phone','source','status','move_in_date','bedrooms','notes','property_name') or m.value !~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$') or exists(select 1 from jsonb_each(p_mapping) m where jsonb_typeof(m.value)<>'string') then raise exception 'Invalid CRM field mapping';end if;
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
 if exists(select 1 from public.crm_qualifications o where o.integration_id=c.id and exists(select 1 from public.crm_qualification_receipts evidence where evidence.operation_id=o.id and evidence.stage='create_intent') and not exists(select 1 from public.crm_qualification_receipts evidence where evidence.operation_id=o.id and evidence.stage='cleanup' and evidence.result->'absent'='true')) then return '{"state":"unfinished_test"}';end if;
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
end;$$;

create or replace function public.preview_crm_mapping(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_integration_id uuid,p_revision bigint,p_lead_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;r public.crm_mapping_reviews;input_hash text;source_data jsonb;payload jsonb;omitted jsonb;result jsonb;snapshot jsonb;e jsonb;
begin
 if p_request_id is null then raise exception 'Preview identity required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input_hash:=public.crm_configuration_hash(jsonb_build_object('integrationId',p_integration_id,'revision',p_revision,'leadId',p_lead_id));
 select * into r from public.crm_mapping_reviews where id=p_request_id;
 if found then
  if (r.property_id,r.actor_id,r.kind,r.input_hash) is distinct from (p_property_id,p_actor_id,'preview',input_hash) then return '{"state":"request_conflict"}';end if;
  return r.result||jsonb_build_object('state','replayed','preview',r.snapshot);
 end if;
 select * into c from public.integration_credentials where id=p_integration_id and property_id=p_property_id and platform in ('yardi','realpage','salesforce','hubspot','lasso') for share;
 if not found then return '{"state":"not_found"}';end if;
 if c.crm_revision<>p_revision then return '{"state":"stale"}';end if;
 if c.field_mapping is null or c.field_mapping='{}' then return '{"state":"mapping_required"}';end if;
 if jsonb_typeof(c.field_mapping)<>'object' then return '{"state":"invalid_mapping"}';end if;
 if exists(select 1 from jsonb_each(c.field_mapping) m where jsonb_typeof(m.value)<>'string') or exists(select 1 from jsonb_each_text(c.field_mapping) m where m.key not in ('first_name','last_name','email','phone','source','status','move_in_date','bedrooms','notes','property_name') or m.value !~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$') then return '{"state":"invalid_mapping"}';end if;
 if (select count(*) from jsonb_each_text(c.field_mapping))<>(select count(distinct value) from jsonb_each_text(c.field_mapping)) then return '{"state":"duplicate_targets"}';end if;
 if p_lead_id is null then source_data:='{"property_name":"Example community","first_name":"Example","last_name":"Lead","email":"example@example.invalid","phone":"+12025550123","source":"website","status":"new","move_in_date":"2030-01-01","bedrooms":2,"notes":"Example only; this record will not be sent."}';
 else source_data:=public.crm_lead_preview_input(p_property_id,p_lead_id);if source_data is null then return '{"state":"not_found"}';end if;end if;
 if length(source_data::text)>100000 then return '{"state":"preview_too_large"}';end if;
 select coalesce(jsonb_object_agg(m.value,source_data->m.key) filter(where source_data->m.key is not null and source_data->m.key<>'null'::jsonb),'{}') into payload from jsonb_each_text(c.field_mapping) m;
 select coalesce(jsonb_agg(key order by key),'[]') into omitted from jsonb_object_keys(source_data) key where not c.field_mapping ? key;
 snapshot:=jsonb_build_object('source',source_data,'mapped',payload,'omittedFields',omitted,'leadId',p_lead_id,'exampleOnly',p_lead_id is null,'sourceHash',public.crm_configuration_hash(source_data),'providerSchemaVerified',false);
 result:=jsonb_build_object('state','applied','previewId',p_request_id,'integrationId',c.id,'revision',c.crm_revision,'providerVerified',false);
 insert into public.crm_mapping_reviews(id,property_id,actor_id,integration_id,kind,input_hash,revision,field_mapping,credentials_hash,snapshot,result)
 values(p_request_id,p_property_id,p_actor_id,c.id,'preview',input_hash,c.crm_revision,c.field_mapping,public.crm_configuration_hash(c.credentials),snapshot,result);
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.mapping.previewed','server_confirmed','succeeded',
 jsonb_build_object('integrationId',c.id,'revision',c.crm_revision,'leadId',p_lead_id,'exampleOnly',p_lead_id is null),null,null,result||jsonb_build_object('sourceHash',public.crm_configuration_hash(source_data),'mappedFieldCount',(select count(*) from jsonb_each(payload))));
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM preview history unavailable';end if;
 return result||jsonb_build_object('preview',snapshot);
end;$$;

create or replace function public.request_crm_handoff(p_property_id uuid,p_lead_id uuid,p_request_key text,p_origin text,p_actor_id uuid default null,p_note text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if kind='lead' and c.platform in('hubspot','salesforce') and not ((nullif(trim(l.email),'') is not null and c.field_mapping->>'email'=case when c.platform='hubspot' then 'email' else 'Email' end) or (nullif(trim(l.phone),'') is not null and c.field_mapping->>'phone'=case when c.platform='hubspot' then 'phone' else 'Phone' end)) then return '{"state":"contact_mapping_required"}';end if;
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

create table public.crm_qualifications(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 integration_id uuid not null references public.integration_credentials(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),worker_actor_id uuid references public.profiles(id),
 revision bigint not null,credentials_hash text not null,mapping_hash text not null,approved_review_id uuid not null,
 source jsonb not null,payload jsonb not null,payload_hash text not null,
 state text not null default 'prepared' check(state in('prepared','queued','running','verified','failed','needs_reconciliation','cancelled')),
 claim_id uuid,approved_at timestamptz,claimed_at timestamptz,finished_at timestamptz,created_at timestamptz not null default clock_timestamp()
);
create index crm_qualifications_property on public.crm_qualifications(property_id,created_at desc,id desc);
create index crm_qualifications_integration on public.crm_qualifications(integration_id,state);
create index crm_qualifications_actor on public.crm_qualifications(actor_id);
create index crm_qualifications_worker on public.crm_qualifications(worker_actor_id);
create table public.crm_qualification_receipts(
 id uuid primary key default gen_random_uuid(),operation_id uuid not null references public.crm_qualifications(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 stage text not null check(stage in('preflight','create_intent','created','readback','search','cleanup_intent','cleanup','failure')),
 result jsonb not null,claim_id uuid not null,created_at timestamptz not null default clock_timestamp(),unique(operation_id,stage)
);
create index crm_qualification_receipts_property on public.crm_qualification_receipts(property_id);
create table public.crm_qualification_commands(
 id uuid primary key,operation_id uuid not null references public.crm_qualifications(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in('run','recover','activate','stop')),
 payload_hash text not null,result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index crm_qualification_commands_operation on public.crm_qualification_commands(operation_id,kind);
create index crm_qualification_commands_property on public.crm_qualification_commands(property_id);
create index crm_qualification_commands_actor on public.crm_qualification_commands(actor_id);
alter table public.crm_qualifications enable row level security;
alter table public.crm_qualification_receipts enable row level security;
alter table public.crm_qualification_commands enable row level security;
create policy crm_qualifications_service on public.crm_qualifications for all to service_role using(true) with check(true);
create policy crm_qualification_receipts_service on public.crm_qualification_receipts for all to service_role using(true) with check(true);
create policy crm_qualification_commands_service on public.crm_qualification_commands for all to service_role using(true) with check(true);
revoke all on public.crm_qualifications,public.crm_qualification_receipts,public.crm_qualification_commands from public,anon,authenticated;
grant all on public.crm_qualifications,public.crm_qualification_receipts,public.crm_qualification_commands to service_role;
create trigger crm_qualification_receipts_immutable before update or delete on public.crm_qualification_receipts for each row execute function public.protect_shared_action_history();
create trigger crm_qualification_commands_immutable before update or delete on public.crm_qualification_commands for each row execute function public.protect_shared_action_history();
create function public.protect_crm_qualification() returns trigger language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
 if tg_op='DELETE' or (new.id,new.property_id,new.integration_id,new.actor_id,new.revision,new.credentials_hash,new.mapping_hash,new.approved_review_id,new.source,new.payload,new.payload_hash,new.created_at) is distinct from (old.id,old.property_id,old.integration_id,old.actor_id,old.revision,old.credentials_hash,old.mapping_hash,old.approved_review_id,old.source,old.payload,old.payload_hash,old.created_at) then raise exception 'CRM test request is immutable';end if;
 return new;
end;$$;
create trigger crm_qualification_immutable before update or delete on public.crm_qualifications for each row execute function public.protect_crm_qualification();

create function public.crm_qualification_current(p_operation_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.crm_qualifications o join public.integration_credentials c on c.id=o.integration_id join public.crm_mapping_reviews a on a.id=c.crm_approved_review_id
 where o.id=p_operation_id and c.property_id=o.property_id and c.crm_revision=o.revision and public.crm_configuration_hash(c.credentials)=o.credentials_hash and public.crm_configuration_hash(c.field_mapping)=o.mapping_hash
 and c.crm_approved_review_id=o.approved_review_id and a.kind='approve' and a.integration_id=c.id and a.revision=c.crm_revision and a.field_mapping=c.field_mapping and a.credentials_hash=o.credentials_hash);
$$;
create function public.crm_qualification_event(p_id uuid,p_operation_id uuid,p_actor_id uuid,p_action text,p_result jsonb) returns void language plpgsql security invoker set search_path='' as $$
declare o public.crm_qualifications;e jsonb;
begin
 select * into o from public.crm_qualifications where id=p_operation_id;
 e:=public.append_shared_action_event(p_id,p_id,o.property_id,p_actor_id,'crm',p_action,'server_confirmed','succeeded',jsonb_build_object('operationId',o.id,'integrationId',o.integration_id,'revision',o.revision,'payloadHash',o.payload_hash),null,null,p_result);
 if e->>'state' not in('recorded','replayed') then raise exception 'CRM qualification history unavailable';end if;
end;$$;
create function public.prepare_crm_qualification(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_integration_id uuid,p_revision bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;o public.crm_qualifications;source jsonb;payload jsonb;
begin
 if p_request_id is null then raise exception 'Saved test identity required';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into o from public.crm_qualifications where id=p_request_id;
 if found then
  if (o.property_id,o.actor_id,o.integration_id,o.revision) is distinct from (p_property_id,p_actor_id,p_integration_id,p_revision) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','operationId',o.id);
 end if;
 select * into c from public.integration_credentials where id=p_integration_id and property_id=p_property_id for share;
 if not found then return '{"state":"not_found"}';end if;
 if c.platform not in('hubspot','salesforce') then return '{"state":"provider_contract_required"}';end if;
 if c.crm_revision<>p_revision then return '{"state":"stale_configuration"}';end if;
 if not exists(select 1 from public.crm_mapping_reviews where id=c.crm_approved_review_id and integration_id=c.id and kind='approve' and revision=c.crm_revision and field_mapping=c.field_mapping and credentials_hash=public.crm_configuration_hash(c.credentials)) then return '{"state":"mapping_approval_required"}';end if;
 if c.field_mapping->>'email' is distinct from (case when c.platform='hubspot' then 'email' else 'Email' end) then return '{"state":"email_mapping_required"}';end if;
 if c.field_mapping ? 'phone' and c.field_mapping->>'phone' is distinct from (case when c.platform='hubspot' then 'phone' else 'Phone' end) then return '{"state":"phone_mapping_required"}';end if;
 if exists(select 1 from public.crm_qualifications where integration_id=c.id and state in('prepared','queued','running','needs_reconciliation')) then return '{"state":"operation_in_progress"}';end if;
 source:=jsonb_build_object('first_name','OneClick test','last_name','Qualification '||left(p_request_id::text,8),'email','p11-qualification-'||p_request_id::text||'@example.invalid','property_name',(select name from public.properties where id=p_property_id));
 select coalesce(jsonb_object_agg(m.value,source->m.key),'{}') into payload from jsonb_each_text(c.field_mapping) m where source ? m.key;
 insert into public.crm_qualifications(id,property_id,integration_id,actor_id,revision,credentials_hash,mapping_hash,approved_review_id,source,payload,payload_hash)
 values(p_request_id,p_property_id,c.id,p_actor_id,c.crm_revision,public.crm_configuration_hash(c.credentials),public.crm_configuration_hash(c.field_mapping),c.crm_approved_review_id,source,payload,public.crm_configuration_hash(payload));
 perform public.crm_qualification_event(p_request_id,p_request_id,p_actor_id,'crm.qualification.prepared','{"state":"prepared","providerCall":false}');
 return jsonb_build_object('state','saved','operationId',p_request_id);
end;$$;

create function public.command_crm_qualification(p_property_id uuid,p_actor_id uuid,p_operation_id uuid,p_request_id uuid,p_kind text,p_payload_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_qualifications;c public.crm_qualification_commands;result jsonb;
begin
 if p_request_id is null or p_kind is null or p_kind not in('run','recover','activate','stop') or p_payload_hash is null then raise exception 'Exact saved test review required';end if;
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into o from public.crm_qualifications where id=p_operation_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if o.payload_hash<>p_payload_hash then return '{"state":"preview_conflict"}';end if;
 select * into c from public.crm_qualification_commands where id=p_request_id;
 if found then
  if (c.operation_id,c.actor_id,c.kind,c.payload_hash) is distinct from (o.id,p_actor_id,p_kind,p_payload_hash) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','operationId',o.id,'result',c.result);
 end if;
 if p_kind='run' then
  if o.actor_id<>p_actor_id then return '{"state":"owner_required"}';end if;
  if o.state<>'prepared' then return '{"state":"already_started"}';end if;
  if not public.crm_qualification_current(o.id) then return '{"state":"stale_configuration"}';end if;
  update public.crm_qualifications set state='queued',approved_at=clock_timestamp(),worker_actor_id=p_actor_id where id=o.id;
  result:='{"state":"queued","mayCreateTestRecord":true,"activated":false}';
 elsif p_kind='recover' then
  if o.state not in('queued','running','needs_reconciliation') then return '{"state":"not_recoverable"}';end if;
  if o.state='running' and o.claimed_at>clock_timestamp()-interval '2 minutes' then return '{"state":"worker_pending"}';end if;
  if not public.crm_qualification_current(o.id) then return '{"state":"stale_configuration"}';end if;
  update public.crm_qualifications set state='queued',worker_actor_id=p_actor_id,claim_id=null where id=o.id;
  result:='{"state":"queued","recovery":true,"activated":false}';
 elsif p_kind='activate' then
  if o.state<>'verified' or not exists(select 1 from public.crm_validation_receipts r where r.id=o.id and r.state='verified' and r.created_at>clock_timestamp()-interval '24 hours') then return '{"state":"verification_required"}';end if;
  if not public.crm_qualification_current(o.id) then return '{"state":"stale_configuration"}';end if;
  update public.integration_credentials set crm_validation_receipt_id=o.id,mapping_validated=true,status='connected' where id=o.integration_id;
  result:='{"state":"activated","leadTransfers":true,"noteTransfers":false}';
 else
  if exists(select 1 from public.crm_qualification_receipts where operation_id=o.id and stage='create_intent') and not exists(select 1 from public.crm_qualification_receipts evidence where evidence.operation_id=o.id and evidence.stage='cleanup' and evidence.result->'absent'='true') then return '{"state":"cleanup_required"}';end if;
  if o.state in('verified','failed','cancelled') then return '{"state":"already_finished"}';end if;
  update public.crm_qualifications set state='cancelled',finished_at=clock_timestamp(),claim_id=null where id=o.id;
  result:='{"state":"cancelled","activated":false}';
 end if;
 insert into public.crm_qualification_commands(id,operation_id,property_id,actor_id,kind,payload_hash,result)values(p_request_id,o.id,o.property_id,p_actor_id,p_kind,p_payload_hash,result);
 perform public.crm_qualification_event(p_request_id,o.id,p_actor_id,case p_kind when 'run' then 'crm.qualification.approved' when 'recover' then 'crm.qualification.recovered' when 'activate' then 'crm.qualification.activated' else 'crm.qualification.stopped' end,result);
 return jsonb_build_object('state','applied','operationId',o.id,'result',result);
end;$$;

create function public.claim_crm_qualification(p_operation_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_qualifications;c public.integration_credentials;claim uuid:=gen_random_uuid();receipts jsonb;
begin
 select * into o from public.crm_qualifications where id=p_operation_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.property_id::text,12));
 select * into o from public.crm_qualifications where id=p_operation_id for update;
 if o.state<>'queued' or o.approved_at is null then return jsonb_build_object('state',o.state);end if;
 if not public.crm_qualification_current(o.id) or not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=o.property_id and u.id=o.worker_actor_id and u.role in('admin','manager')) then return '{"state":"stale"}';end if;
 select * into c from public.integration_credentials where id=o.integration_id for share;
 update public.crm_qualifications set state='running',claim_id=claim,claimed_at=clock_timestamp() where id=o.id;
 select coalesce(jsonb_object_agg(stage,result),'{}') into receipts from public.crm_qualification_receipts where operation_id=o.id;
 return jsonb_build_object('state','claimed','claimId',claim,'operationId',o.id,'platform',c.platform,'credentials',c.credentials,'mapping',c.field_mapping,'source',o.source,'payload',o.payload,'receipts',receipts);
end;$$;

create function public.checkpoint_crm_qualification(p_operation_id uuid,p_claim_id uuid,p_stage text,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_qualifications;r public.crm_qualification_receipts;created jsonb;
begin
 if p_stage is null or p_stage not in('preflight','create_intent','created','readback','search','cleanup_intent','cleanup','failure') or jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>16000 or p_result-array['identity','contractVersion','externalId','matches','confirmed','absent','reason','recovered']<>'{}' then raise exception 'Invalid CRM test evidence';end if;
 select * into o from public.crm_qualifications where id=p_operation_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.property_id::text,12));
 select * into o from public.crm_qualifications where id=p_operation_id for update;
 if o.state<>'running' or p_claim_id is null or o.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 select * into r from public.crm_qualification_receipts where operation_id=o.id and stage=p_stage;
 if found then return jsonb_build_object('state',case when r.result=p_result then 'replayed' else 'request_conflict' end);end if;
 select result into created from public.crm_qualification_receipts where operation_id=o.id and stage='created';
 if p_stage='preflight' and (p_result->>'contractVersion' is distinct from 'crm-exact-v1' or nullif(p_result->'identity'->>'id','') is null) then raise exception 'Provider identity and contract required';end if;
 if p_stage='create_intent' then
  if not public.crm_qualification_current(o.id) or not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=o.property_id and u.id=o.worker_actor_id and u.role in('admin','manager')) then return '{"state":"stale"}';end if;
  if not exists(select 1 from public.crm_qualification_receipts where operation_id=o.id and stage='preflight') then return '{"state":"preflight_required"}';end if;
 elsif p_stage='created' then
  if not exists(select 1 from public.crm_qualification_receipts where operation_id=o.id and stage='create_intent') or (p_result->>'externalId') is null or (p_result->>'externalId') !~ '^[A-Za-z0-9_-]+$' or length(p_result->>'externalId')>256 then raise exception 'Original create intent and destination required';end if;
 elsif p_stage in('readback','search','cleanup_intent','cleanup') then
  if created is null or p_result->>'externalId' is distinct from created->>'externalId' then return '{"state":"destination_conflict"}';end if;
  if p_stage='cleanup_intent' and not exists(select 1 from public.crm_qualification_receipts where operation_id=o.id and stage='readback' and result->'matches'='true') then return '{"state":"exact_test_record_required"}';end if;
  if p_stage='cleanup' and not exists(select 1 from public.crm_qualification_receipts where operation_id=o.id and stage='cleanup_intent') and not coalesce(p_result->'recovered'='true' and p_result->'absent'='true',false) then return '{"state":"cleanup_intent_required"}';end if;
 end if;
 insert into public.crm_qualification_receipts(operation_id,property_id,stage,result,claim_id)values(o.id,o.property_id,p_stage,p_result,p_claim_id);
 return jsonb_build_object('state',case when p_stage in('create_intent','cleanup_intent') then 'proceed_once' else 'saved' end);
end;$$;

create function public.finish_crm_qualification(p_operation_id uuid,p_claim_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_qualifications;receipts jsonb;verified boolean;final_state text;
begin
 select * into o from public.crm_qualifications where id=p_operation_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.property_id::text,12));
 select * into o from public.crm_qualifications where id=p_operation_id for update;
 if p_claim_id is null or o.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 if o.state<>'running' then return jsonb_build_object('state','replayed','qualificationState',o.state);end if;
 select coalesce(jsonb_object_agg(stage,result),'{}') into receipts from public.crm_qualification_receipts where operation_id=o.id;
 verified:=coalesce(receipts->'created'->'confirmed'='true' and receipts->'readback'->'matches'='true' and receipts->'search'->'matches'='true' and receipts->'cleanup'->'absent'='true',false);
 final_state:=case when verified then 'verified' when receipts ? 'create_intent' and not coalesce(receipts->'cleanup'->'absent'='true',false) then 'needs_reconciliation' else 'failed' end;
 update public.crm_qualifications set state=final_state,finished_at=clock_timestamp() where id=o.id;
 if verified then
  insert into public.crm_validation_receipts(id,property_id,integration_id,revision,credentials_hash,mapping_hash,provider_identity,capabilities,evidence,state)
  values(o.id,o.property_id,o.integration_id,o.revision,o.credentials_hash,o.mapping_hash,receipts->'preflight'->'identity','{"leadSearch":true,"leadRead":true,"leadWrite":true,"noteWrite":false,"cleanup":true,"contractVersion":"crm-exact-v1"}',jsonb_build_object('operationId',o.id,'payloadHash',o.payload_hash,'receiptStages',(select jsonb_agg(stage order by created_at) from public.crm_qualification_receipts where operation_id=o.id)),'verified');
 end if;
 if exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=o.property_id and u.id=o.worker_actor_id) then
  perform public.crm_qualification_event(gen_random_uuid(),o.id,o.worker_actor_id,'crm.qualification.completed',jsonb_build_object('state',final_state,'activated',false));
 end if;
 return jsonb_build_object('state','saved','qualificationState',final_state);
end;$$;

create function public.read_crm_qualifications(p_property_id uuid,p_actor_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'integrationId',o.integration_id,'revision',o.revision,'state',o.state,'payload',o.payload,'payloadHash',o.payload_hash,'canApprove',o.actor_id=p_actor_id,'currentConfiguration',public.crm_qualification_current(o.id),'activated',c.crm_validation_receipt_id=o.id and c.mapping_validated is true,'requestedAt',o.created_at,'receipts',coalesce((select jsonb_agg(jsonb_build_object('stage',r.stage,'result',r.result,'receivedAt',r.created_at) order by r.created_at) from public.crm_qualification_receipts r where r.operation_id=o.id),'[]')) order by o.created_at desc,o.id desc),'[]') into rows
 from (select * from public.crm_qualifications where property_id=p_property_id order by created_at desc,id desc limit 30)o join public.integration_credentials c on c.id=o.integration_id;
 return jsonb_build_object('state','saved','operations',rows);
end;$$;
revoke all on function public.protect_crm_qualification(),public.crm_qualification_current(uuid),public.crm_qualification_event(uuid,uuid,uuid,text,jsonb),public.prepare_crm_qualification(uuid,uuid,uuid,uuid,bigint),public.command_crm_qualification(uuid,uuid,uuid,uuid,text,text),public.claim_crm_qualification(uuid),public.checkpoint_crm_qualification(uuid,uuid,text,jsonb),public.finish_crm_qualification(uuid,uuid),public.read_crm_qualifications(uuid,uuid) from public,anon,authenticated;
grant execute on function public.protect_crm_qualification(),public.crm_qualification_current(uuid),public.crm_qualification_event(uuid,uuid,uuid,text,jsonb),public.prepare_crm_qualification(uuid,uuid,uuid,uuid,bigint),public.command_crm_qualification(uuid,uuid,uuid,uuid,text,text),public.claim_crm_qualification(uuid),public.checkpoint_crm_qualification(uuid,uuid,text,jsonb),public.finish_crm_qualification(uuid,uuid),public.read_crm_qualifications(uuid,uuid) to service_role;


create or replace function public.guard_crm_unfinished_delivery() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' and not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
 if old.platform not in ('crm','yardi','realpage','salesforce','hubspot','lasso') then if tg_op='DELETE' then return old;end if;return new;end if;
 if tg_op='UPDATE' and (new.credentials,new.field_mapping,new.platform,new.property_id) is not distinct from (old.credentials,old.field_mapping,old.platform,old.property_id) then return new;end if;
 if exists(select 1 from public.crm_qualifications o where o.integration_id=old.id and exists(select 1 from public.crm_qualification_receipts evidence where evidence.operation_id=o.id and evidence.stage='create_intent') and not exists(select 1 from public.crm_qualification_receipts evidence where evidence.operation_id=o.id and evidence.stage='cleanup' and evidence.result->'absent'='true')) then raise exception 'Resolve the unfinished CRM test record before replacing its connection';end if;
 if exists(select 1 from public.crm_handoffs where integration_id=old.id and state in ('sending','needs_reconciliation')) then raise exception 'Resolve the unfinished CRM delivery before replacing its connection';end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;

create or replace function public.read_crm_monitor(p_property_id uuid,p_actor_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare states jsonb;outcomes jsonb;legacy bigint;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select coalesce(jsonb_object_agg(status,count),'{}') into states from (
  select case when state='queued' and execution_approved_at is null then 'review' when state='queued' then 'approved' else state end status,count(*) count from public.crm_handoffs where property_id=p_property_id group by 1
 ) counts;
 select coalesce(jsonb_object_agg(outcome,count),'{}') into outcomes from (
  select receipt.result->>'outcome' outcome,count(*) count from public.crm_handoffs h cross join lateral (
   select r.result from public.crm_handoff_receipts r where r.handoff_id=h.id and r.stage in('result','reconciliation','late_result') order by r.created_at desc,r.id desc limit 1
  ) receipt where h.property_id=p_property_id and h.state='confirmed' group by 1
 ) counts;
 select count(*) into legacy from public.leads l where l.property_id=p_property_id and (l.external_crm_id is not null or l.crm_sync_status in('created','linked','retrying','failed','dead_lettered')) and not exists(select 1 from public.crm_handoffs h where h.lead_id=l.id and h.property_id=p_property_id);
 return jsonb_build_object('state','saved','counts',states,'confirmedOutcomes',outcomes,'legacyLeads',legacy,'observedAt',statement_timestamp());
end;$$;
revoke all on function public.read_crm_monitor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_crm_monitor(uuid,uuid) to service_role;


notify pgrst,'reload schema';