-- Preserve installations already operating before this upgrade. No credentials,
-- API keys, mappings or public widget installation values are rewritten.
-- These are historical continuity records, not fabricated provider verification.
create table public.crm_existing_connections (
 integration_id uuid primary key references public.integration_credentials(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 revision bigint not null, credentials_hash text not null, mapping_hash text not null,
 captured_at timestamptz not null default clock_timestamp()
);
create index crm_existing_connections_property on public.crm_existing_connections(property_id);
create index crm_existing_connections_org on public.crm_existing_connections(org_id);
alter table public.crm_existing_connections enable row level security;
create policy crm_existing_connections_service on public.crm_existing_connections for all to service_role using(true) with check(true);
revoke all on public.crm_existing_connections from public,anon,authenticated;
grant all on public.crm_existing_connections to service_role;

insert into public.crm_existing_connections(integration_id,property_id,org_id,revision,credentials_hash,mapping_hash)
select c.id,c.property_id,p.org_id,c.crm_revision,public.crm_configuration_hash(c.credentials),public.crm_configuration_hash(c.field_mapping)
from public.integration_credentials c join public.properties p on p.id=c.property_id
where c.platform='lasso' and c.status in('connected','verified') and c.mapping_validated is true
and c.crm_approved_review_id is null and c.crm_validation_receipt_id is null
and nullif(trim(c.credentials->>'api_key'),'') is not null
and nullif(trim(c.credentials->>'client_id'),'') is not null
and nullif(trim(coalesce(c.credentials->>'project_id',c.credentials->>'community_id')),'') is not null
and coalesce(nullif(c.credentials->>'api_endpoint',''),'https://api.lassocrm.com/v1') ~ '^https://api[.]lassocrm[.]com(/[^?#]*)?$'
and c.field_mapping is not null and c.field_mapping<>'{}'
and (select count(*) from public.integration_credentials i where i.property_id=c.property_id and i.platform in('crm','lasso','yardi','realpage','hubspot','salesforce'))=1;

-- Keep the cutover backlog as evidence. A historic pending flag does not prove
-- that Lasso never received the registration, so it never authorizes a replay.
create table public.crm_upgrade_leads (
 lead_id uuid primary key references public.leads(id) on delete cascade,
 integration_id uuid not null references public.crm_existing_connections(integration_id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,
 previous_status text, external_id text, notes_hash text not null, captured_at timestamptz not null default clock_timestamp()
);
create index crm_upgrade_leads_integration on public.crm_upgrade_leads(integration_id);
create index crm_upgrade_leads_property on public.crm_upgrade_leads(property_id);
alter table public.crm_upgrade_leads enable row level security;
create policy crm_upgrade_leads_service on public.crm_upgrade_leads for all to service_role using(true) with check(true);
revoke all on public.crm_upgrade_leads from public,anon,authenticated;
grant all on public.crm_upgrade_leads to service_role;
insert into public.crm_upgrade_leads(lead_id,integration_id,property_id,previous_status,external_id,notes_hash)
select l.id,c.integration_id,l.property_id,l.crm_sync_status,l.external_crm_id,public.crm_configuration_hash(to_jsonb(coalesce(l.notes,'')))
from public.leads l join public.crm_existing_connections c on c.property_id=l.property_id;
update public.leads l set crm_sync_status='dead_lettered',crm_sync_next_retry_at=null,
 crm_dead_lettered_at=coalesce(l.crm_dead_lettered_at,clock_timestamp()),
 crm_sync_error='Pre-upgrade delivery needs review in Lasso before resending. Existing credentials and mappings were preserved.'
from public.crm_upgrade_leads b where b.lead_id=l.id and nullif(b.external_id,'') is null;
create trigger crm_existing_connections_immutable before update or delete on public.crm_existing_connections for each row execute function public.protect_shared_action_history();
create trigger crm_upgrade_leads_immutable before update or delete on public.crm_upgrade_leads for each row execute function public.protect_shared_action_history();

create function public.crm_existing_connection_ready(p_integration_id uuid,p_revision bigint,p_credentials_hash text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.crm_existing_connections e join public.integration_credentials c on c.id=e.integration_id
 join public.properties p on p.id=c.property_id and p.org_id=e.org_id
 where c.id=p_integration_id and e.property_id=c.property_id and e.revision=p_revision and c.crm_revision=e.revision
 and c.platform='lasso' and c.status in('connected','verified') and c.mapping_validated is true
 and c.crm_approved_review_id is null and c.crm_validation_receipt_id is null
 and e.credentials_hash=p_credentials_hash and e.credentials_hash=public.crm_configuration_hash(c.credentials)
 and e.mapping_hash=public.crm_configuration_hash(c.field_mapping)
 and (select count(*) from public.integration_credentials i where i.property_id=c.property_id and i.platform in('crm','lasso','yardi','realpage','hubspot','salesforce'))=1);
$$;
revoke all on function public.crm_existing_connection_ready(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.crm_existing_connection_ready(uuid,bigint,text) to service_role;

alter table public.crm_handoffs add column delivery_contract text not null default 'qualified';
alter table public.crm_handoffs add column existing_connection_id uuid references public.crm_existing_connections(integration_id);
create index crm_handoffs_existing_connection on public.crm_handoffs(existing_connection_id);
alter table public.crm_handoffs alter column approved_review_id drop not null;
alter table public.crm_handoffs alter column validation_receipt_id drop not null;
alter table public.crm_handoffs add constraint crm_handoff_contract check(
 (delivery_contract='qualified' and approved_review_id is not null and validation_receipt_id is not null and existing_connection_id is null)
 or (delivery_contract='existing_lasso' and approved_review_id is null and validation_receipt_id is null and existing_connection_id=integration_id and existing_connection_id is not null));


create or replace function public.crm_handoff_configuration_ready(p_integration_id uuid,p_revision bigint,p_review_id uuid,p_receipt_id uuid,p_credentials_hash text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.integration_credentials c join public.crm_mapping_reviews a on a.id=c.crm_approved_review_id join public.crm_validation_receipts r on r.id=c.crm_validation_receipt_id
 where c.id=p_integration_id and c.crm_revision=p_revision and c.crm_approved_review_id=p_review_id and c.crm_validation_receipt_id=p_receipt_id
 and c.mapping_validated is true and c.status in ('connected','verified') and public.crm_configuration_hash(c.credentials)=p_credentials_hash
 and a.integration_id=c.id and a.property_id=c.property_id and a.kind='approve' and a.revision=c.crm_revision and a.field_mapping=c.field_mapping and a.credentials_hash=p_credentials_hash
 and r.integration_id=c.id and r.property_id=c.property_id and r.revision=c.crm_revision and r.credentials_hash=p_credentials_hash and r.mapping_hash=public.crm_configuration_hash(c.field_mapping) and r.state='verified' and r.capabilities->'leadSearch'='true' and r.capabilities->'leadRead'='true' and r.capabilities->'leadWrite'='true')
 or (p_review_id is null and p_receipt_id is null and public.crm_existing_connection_ready(p_integration_id,p_revision,p_credentials_hash));
$$;

create or replace function public.crm_configuration_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.platform in ('crm','yardi','realpage','salesforce','hubspot','lasso') and (old.property_id,old.platform) is distinct from (new.property_id,new.platform) then raise exception 'CRM connection identity cannot change';end if;
 if new.platform not in ('crm','yardi','realpage','salesforce','hubspot','lasso') then return new;end if;
 if tg_op='INSERT' then new.crm_revision:=1;
 elsif (old.property_id,old.platform,old.credentials,old.field_mapping) is distinct from (new.property_id,new.platform,new.credentials,new.field_mapping) then
  if (old.property_id,old.platform) is distinct from (new.property_id,new.platform) then raise exception 'CRM connection identity cannot change';end if;
  new.crm_revision:=old.crm_revision+1;new.crm_approved_review_id:=null;new.crm_validation_receipt_id:=null;
  new.mapping_validated:=false;new.mapping_validated_at:=null;new.status:='pending';
 else new.crm_revision:=old.crm_revision;end if;
 if new.crm_approved_review_id is not null and not exists(select 1 from public.crm_mapping_reviews r where r.id=new.crm_approved_review_id and r.integration_id=new.id and r.property_id=new.property_id and r.kind='approve' and r.revision=new.crm_revision and r.field_mapping=new.field_mapping and r.credentials_hash=public.crm_configuration_hash(new.credentials)) then raise exception 'CRM review does not match configuration';end if;
 -- Metadata changes on a preserved connection must not demand a new login.
 if tg_op='UPDATE' and (new.credentials,new.field_mapping,new.crm_revision,new.crm_approved_review_id,new.crm_validation_receipt_id)
 is not distinct from (old.credentials,old.field_mapping,old.crm_revision,old.crm_approved_review_id,old.crm_validation_receipt_id)
 and public.crm_existing_connection_ready(old.id,old.crm_revision,public.crm_configuration_hash(old.credentials)) then return new;end if;
 if new.mapping_validated is true or new.status in ('connected','verified') then
  if new.crm_approved_review_id is null or not exists(select 1 from public.crm_validation_receipts r where r.id=new.crm_validation_receipt_id and r.integration_id=new.id and r.property_id=new.property_id and r.revision=new.crm_revision and r.credentials_hash=public.crm_configuration_hash(new.credentials) and r.mapping_hash=public.crm_configuration_hash(new.field_mapping) and r.state='verified') then raise exception 'CRM activation requires current saved provider evidence';end if;
 end if;
 return new;
end;$$;

create or replace function public.request_crm_handoff(p_property_id uuid,p_lead_id uuid,p_request_key text,p_origin text,p_actor_id uuid default null,p_note text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;h public.crm_handoffs;l public.leads;organization uuid;input_hash text;source jsonb;payload jsonb;handoff uuid:=gen_random_uuid();job uuid:=gen_random_uuid();attempt uuid:=gen_random_uuid();link public.crm_lead_links;kind text;existing_connection boolean:=false;
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
 existing_connection:=public.crm_existing_connection_ready(c.id,c.crm_revision,public.crm_configuration_hash(c.credentials));
 if kind='lead' and c.platform in('hubspot','salesforce') and not ((nullif(trim(l.email),'') is not null and c.field_mapping->>'email'=case when c.platform='hubspot' then 'email' else 'Email' end) or (nullif(trim(l.phone),'') is not null and c.field_mapping->>'phone'=case when c.platform='hubspot' then 'phone' else 'Phone' end)) then return '{"state":"contact_mapping_required"}';end if;
 if kind='note' and not existing_connection and not exists(select 1 from public.crm_validation_receipts where id=c.crm_validation_receipt_id and capabilities->'noteWrite'='true') then return '{"state":"note_capability_required"}';end if;
 if exists(select 1 from public.crm_handoffs where lead_id=l.id and integration_id=c.id and state in ('queued','searching','sending','needs_reconciliation')) then return '{"state":"handoff_in_progress"}';end if;
 select * into link from public.crm_lead_links where lead_id=l.id and integration_id=c.id;
 if l.external_crm_id is not null and link.lead_id is null and (not existing_connection or not exists(select 1 from public.crm_upgrade_leads b where b.lead_id=l.id and b.integration_id=c.id and b.external_id=l.external_crm_id)) then return '{"state":"legacy_link_review_required"}';end if;
 if kind='note' and link.lead_id is null and (not existing_connection or nullif(l.external_crm_id,'') is null) then return '{"state":"confirmed_link_required"}';end if;
 if kind='lead' and link.lead_id is not null then return jsonb_build_object('state','already_linked','externalId',link.external_id,'handoffId',link.handoff_id);end if;
 if existing_connection then
  if kind='lead' and nullif(l.external_crm_id,'') is not null then return jsonb_build_object('state','already_linked','externalId',l.external_crm_id,'historicalLink',true);end if;
  if kind='lead' and exists(select 1 from public.crm_upgrade_leads where lead_id=l.id and integration_id=c.id) then return '{"state":"legacy_delivery_review_required"}';end if;
  -- Public registration credentials cannot read/search Lasso. Prevent duplicate
  -- submissions against known local identities instead of claiming a search.
  if kind='lead' and exists(select 1 from public.leads other where other.property_id=l.property_id and other.id<>l.id
   and ((nullif(lower(trim(l.email)),'') is not null and lower(trim(other.email))=lower(trim(l.email)))
    or (length(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'))>=7 and regexp_replace(other.phone,'[^0-9]','','g')=regexp_replace(l.phone,'[^0-9]','','g')))
   and (other.external_crm_id is not null or exists(select 1 from public.crm_upgrade_leads b where b.lead_id=other.id)
    or exists(select 1 from public.crm_handoffs d where d.lead_id=other.id and d.integration_id=c.id and d.state<>'cancelled'))) then return '{"state":"existing_contact_review_required"}';end if;
 end if;
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
 insert into public.crm_handoffs(id,property_id,lead_id,integration_id,actor_id,origin,request_key,input_hash,kind,revision,approved_review_id,validation_receipt_id,credentials_hash,field_mapping,source_snapshot,source_hash,payload,external_id,job_id,attempt_id,delivery_contract,existing_connection_id)
 values(handoff,p_property_id,l.id,c.id,p_actor_id,p_origin,p_request_key,input_hash,kind,c.crm_revision,c.crm_approved_review_id,c.crm_validation_receipt_id,public.crm_configuration_hash(c.credentials),c.field_mapping,source,public.crm_configuration_hash(source),payload,coalesce(link.external_id,case when existing_connection then l.external_crm_id end),job,attempt,case when existing_connection then 'existing_lasso' else 'qualified' end,case when existing_connection then c.id end);
 perform public.crm_record_handoff_action(handoff,handoff,'crm.delivery.requested','{"outcome":"queued","delivered":false}');
 return jsonb_build_object('state','queued','handoffId',handoff,'jobId',job,'attemptId',attempt);
end;$$;

create or replace function public.claim_crm_handoff(p_handoff_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 return jsonb_build_object('state','claimed','handoffId',h.id,'claimId',claim,'kind',h.kind,'platform',c.platform,'credentials',c.credentials,'payload',h.payload,'source',h.source_snapshot,'externalId',h.external_id,'mapping',h.field_mapping,'deliveryContract',h.delivery_contract);
end;$$;

create or replace function public.mark_crm_handoff_write(p_handoff_id uuid,p_claim_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare h public.crm_handoffs;c public.integration_credentials;
begin
 select * into h from public.crm_handoffs where id=p_handoff_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(h.property_id::text,12));
 select * into h from public.crm_handoffs where id=p_handoff_id for update;
 if p_claim_id is null or h.claim_id is distinct from p_claim_id then return '{"state":"claim_conflict"}';end if;
 -- A repeated or unknown write-intent acknowledgment never permits another provider write.
 if h.state<>'searching' then return jsonb_build_object('state',h.state);end if;
 if h.kind='lead' and h.delivery_contract<>'existing_lasso' and not exists(select 1 from public.crm_handoff_receipts where handoff_id=h.id and stage='search' and claim_id=p_claim_id and result->'found'='false') then return '{"state":"search_required"}';end if;
 select * into c from public.integration_credentials where id=h.integration_id for share;
 if not public.crm_handoff_configuration_ready(c.id,h.revision,h.approved_review_id,h.validation_receipt_id,h.credentials_hash)
 or h.kind='lead' and public.crm_configuration_hash(public.crm_lead_preview_input(h.property_id,h.lead_id))<>h.source_hash
 or h.actor_id is not null and not exists(select 1 from public.profiles u join public.properties p on p.org_id=u.org_id where u.id=h.actor_id and p.id=h.property_id and u.role in ('admin','manager')) then return '{"state":"stale"}';end if;
 insert into public.crm_handoff_receipts(handoff_id,property_id,stage,claim_id,result)values(h.id,h.property_id,'write_intent',p_claim_id,jsonb_build_object('payloadHash',public.crm_configuration_hash(h.payload),'kind',h.kind,'integrationId',h.integration_id,'revision',h.revision,'deliveryContract',h.delivery_contract,'duplicateSearch',case when h.delivery_contract='existing_lasso' then 'not_supported_by_existing_connection' else 'provider_search' end));
 update public.crm_handoffs set state='sending' where id=h.id;
 return '{"state":"write_once"}';
end;$$;

create or replace function public.protect_crm_handoff_request() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if not exists(select 1 from public.properties where id=old.property_id) then return old;end if;
  raise exception 'CRM transfer history is immutable';
 end if;
 if (new.delivery_contract,new.existing_connection_id,new.id,new.property_id,new.lead_id,new.integration_id,new.actor_id,new.origin,new.request_key,new.input_hash,new.kind,new.revision,new.approved_review_id,new.validation_receipt_id,new.credentials_hash,new.field_mapping,new.source_snapshot,new.source_hash,new.payload,new.job_id,new.attempt_id,new.requested_at)
 is distinct from (old.delivery_contract,old.existing_connection_id,old.id,old.property_id,old.lead_id,old.integration_id,old.actor_id,old.origin,old.request_key,old.input_hash,old.kind,old.revision,old.approved_review_id,old.validation_receipt_id,old.credentials_hash,old.field_mapping,old.source_snapshot,old.source_hash,old.payload,old.job_id,old.attempt_id,old.requested_at) then raise exception 'CRM transfer values and source identity are immutable';end if;
 return new;
end;$$;

-- Bridge the existing pending-lead projection to durable one-attempt transfers.
-- No external I/O occurs here. Historical uncertain leads are left for review.
create function public.prepare_pending_crm_handoffs(p_limit integer default 50) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;r jsonb;prepared int:=0;held int:=0;scanned int:=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid pending CRM batch size';end if;
 -- Serialize preparation; each transfer is independently fenced again at claim/write.
 perform pg_advisory_xact_lock(hashtextextended('crm-pending-preparation',12));
 for item in
 select x.id,x.property_id,n.note,k.request_key from public.leads x
 join public.integration_credentials i on i.property_id=x.property_id
 left join public.crm_upgrade_leads b on b.lead_id=x.id
 cross join lateral(select case when nullif(x.external_crm_id,'') is not null then nullif(trim(x.notes),'') end as note)n
 cross join lateral(select case when n.note is null then 'pending/'||x.id::text||'/'||public.crm_configuration_hash(public.crm_lead_preview_input(x.property_id,x.id))
 else 'pending-note/'||x.id::text||'/'||public.crm_configuration_hash(to_jsonb(n.note)) end as request_key)k
 where x.crm_sync_status in('pending','retrying') and (x.crm_sync_next_retry_at is null or x.crm_sync_next_retry_at<=clock_timestamp())
 and public.crm_handoff_configuration_ready(i.id,i.crm_revision,i.crm_approved_review_id,i.crm_validation_receipt_id,public.crm_configuration_hash(i.credentials))
 and (b.lead_id is null or nullif(b.external_id,'') is not null)
 and (nullif(x.external_crm_id,'') is null or (n.note is not null
  and (b.lead_id is null or b.notes_hash<>public.crm_configuration_hash(to_jsonb(coalesce(x.notes,''))))
  and not exists(select 1 from public.crm_handoffs prev where prev.lead_id=x.id and prev.integration_id=i.id and prev.state='confirmed' and trim(prev.source_snapshot->>'notes')=n.note)))
 and not exists(select 1 from public.crm_handoffs h where h.lead_id=x.id and (h.state in('queued','searching','sending','needs_reconciliation','failed') or h.request_key=k.request_key))
 order by x.created_at,x.id limit p_limit
 loop
  scanned:=scanned+1;
  if length(item.note)>16000 then r:='{"state":"payload_too_large"}';
  else r:=public.request_crm_handoff(item.property_id,item.id,item.request_key,'workflow',null,item.note);end if;
  if r->>'state' in('queued','replayed') then prepared:=prepared+1;
  else
   held:=held+1;
   if r->>'state' in('existing_contact_review_required','legacy_delivery_review_required','contact_required','confirmed_link_required','legacy_link_review_required','note_capability_required','payload_too_large','contact_mapping_required') then
    update public.leads set crm_sync_status='dead_lettered',crm_sync_next_retry_at=null,crm_dead_lettered_at=clock_timestamp(),
     crm_sync_error='CRM delivery held for review: '||(r->>'state') where id=item.id;
   end if;
  end if;
 end loop;
 return jsonb_build_object('state','prepared','prepared',prepared,'held',held,'scanned',scanned);
end;$$;
revoke all on function public.prepare_pending_crm_handoffs(integer) from public,anon,authenticated;
grant execute on function public.prepare_pending_crm_handoffs(integer) to service_role;


create or replace function public.read_crm_workspace(p_property_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'platform',c.platform,'revision',c.crm_revision,'fieldMapping',c.field_mapping,'hasCredentials',c.credentials is not null and c.credentials<>'{}',
 'reviewApproved',c.crm_approved_review_id is not null,'latestPreview',(select jsonb_build_object('id',r.id,'snapshot',r.snapshot,'createdAt',r.created_at) from public.crm_mapping_reviews r where r.integration_id=c.id and r.kind='preview' and r.revision=c.crm_revision order by r.created_at desc,r.id desc limit 1),'providerVerified',c.crm_validation_receipt_id is not null and c.mapping_validated is true,'storedStatus',c.status,'existingConnection',public.crm_existing_connection_ready(c.id,c.crm_revision,public.crm_configuration_hash(c.credentials)),
 'upgradeReviewCount',(select count(*) from public.crm_upgrade_leads b where b.integration_id=c.id and nullif(b.external_id,'') is null),
 'status',case when public.crm_existing_connection_ready(c.id,c.crm_revision,public.crm_configuration_hash(c.credentials)) then 'existing_connection' when c.crm_validation_receipt_id is not null and c.mapping_validated is true then 'qualified' when c.crm_approved_review_id is not null then 'awaiting_provider' else 'review_required' end) order by c.platform),'[]') into rows
 from public.integration_credentials c where property_id=p_property_id and platform in ('crm','yardi','realpage','salesforce','hubspot','lasso');
 return jsonb_build_object('state','saved','integrations',rows,'canManage',exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','manager')));
end;$$;

create or replace function public.read_serving_assistant_facts(p_property_id uuid)returns jsonb language plpgsql security invoker set search_path=''as $$
declare v_workspace public.assistant_fact_workspaces;v_version public.assistant_fact_versions;v_context public.property_chatbot_contexts;v_snapshot jsonb;v_reason text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into v_context from public.property_chatbot_contexts where property_id=p_property_id;
 select w.*into v_workspace from public.assistant_fact_workspaces w join public.properties p on p.id=w.property_id and p.org_id=w.org_id where w.property_id=p_property_id;
 if not found then if exists(select 1 from public.assistant_fact_workspaces where property_id=p_property_id)then return'{"state":"withheld","reason":"property_scope_changed"}';end if;return jsonb_build_object('state','legacy','freshnessReviewDue',v_context.id is not null and (v_context.last_generated_at is null or v_context.last_generated_at<clock_timestamp()-interval'7 days'),'freshnessReviewReason','publication_review_due');end if;
 if v_workspace.last_release_id is null then return jsonb_build_object('state','legacy','freshnessReviewDue',v_context.id is not null and (v_context.last_generated_at is null or v_context.last_generated_at<clock_timestamp()-interval'7 days'),'freshnessReviewReason','publication_review_due');end if;
 if v_workspace.active_version_id is null then return'{"state":"withheld","reason":"withdrawn"}';end if;
 select *into v_version from public.assistant_fact_versions where id=v_workspace.active_version_id and property_id=p_property_id and org_id=v_workspace.org_id;
 select *into v_context from public.property_chatbot_contexts where property_id=p_property_id;
 if v_version.id is null or v_context.id is null then return'{"state":"withheld","reason":"publication_unavailable"}';end if;
 if v_context.status<>'current'or v_context.requires_review or v_context.context_markdown is distinct from v_version.markdown or v_context.source_snapshot->>'assistantFactVersionId'is distinct from v_version.id::text then return'{"state":"withheld","reason":"review_required"}';end if;
 v_snapshot:=public.assistant_source_snapshot(p_property_id);
 if public.knowledge_hash(v_snapshot)is distinct from v_version.source_hash then return'{"state":"withheld","reason":"sources_changed"}';end if;
 if v_context.last_generated_at is null or v_context.last_generated_at<clock_timestamp()-interval'7 days'or v_context.last_generated_at>clock_timestamp()+interval'5 minutes'then v_reason:='publication_review_due';
 elsif exists(select 1 from jsonb_array_elements(v_snapshot->'sources')s where s->>'type'='website'and s->>'status'='completed'and((s->>'lastSyncedAt')is null or(s->>'lastSyncedAt')::timestamptz<clock_timestamp()-interval'7 days'or(s->>'lastSyncedAt')::timestamptz>clock_timestamp()+interval'5 minutes'))then v_reason:='website_freshness_review_due';end if;
 -- Age alone is advisory; changed, withdrawn or explicitly unapproved facts remain withheld.
 return jsonb_build_object('state','ready','versionId',v_version.id,'releaseId',v_workspace.last_release_id,'contextMarkdown',v_version.markdown,'contextJson',v_context.context_json,'status','current','requiresReview',false,'servingMode','full','freshnessReviewDue',v_reason is not null,'freshnessReviewReason',v_reason);
end$$;

notify pgrst,'reload schema';
