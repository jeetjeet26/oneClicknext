create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
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


-- Browser access to CRM credentials is replaced by scoped status DTOs.
-- Existing non-CRM platform access retains its current policies.
create policy crm_credentials_private on public.integration_credentials as restrictive for all to anon,authenticated
 using(platform not in ('crm','yardi','realpage','salesforce','hubspot','lasso'))
 with check(platform not in ('crm','yardi','realpage','salesforce','hubspot','lasso'));
alter table public.integration_credentials add column crm_revision bigint not null default 1;
alter table public.integration_credentials add column crm_approved_review_id uuid;
alter table public.integration_credentials add column crm_validation_receipt_id uuid;

create table public.crm_mapping_reviews(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),integration_id uuid not null references public.integration_credentials(id) on delete cascade,
 kind text not null check(kind in ('save','preview','approve')),input_hash text not null,
 revision bigint not null,field_mapping jsonb not null,credentials_hash text not null,
 snapshot jsonb not null default '{}',result jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create index crm_mapping_reviews_property on public.crm_mapping_reviews(property_id,created_at desc);
create index crm_mapping_reviews_actor on public.crm_mapping_reviews(actor_id);
create index crm_mapping_reviews_integration on public.crm_mapping_reviews(integration_id,revision);
create trigger crm_mapping_reviews_immutable before update or delete on public.crm_mapping_reviews for each row execute function public.protect_shared_action_history();
alter table public.crm_mapping_reviews enable row level security;
create policy crm_mapping_reviews_service on public.crm_mapping_reviews for all to service_role using(true) with check(true);
revoke all on public.crm_mapping_reviews from public,anon,authenticated;grant all on public.crm_mapping_reviews to service_role;

-- Qualified provider evidence will be bound to a specific configuration; a client boolean is insufficient.
create table public.crm_validation_receipts(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 integration_id uuid not null references public.integration_credentials(id) on delete cascade,
 revision bigint not null,credentials_hash text not null,mapping_hash text not null,
 provider_identity jsonb not null,capabilities jsonb not null,evidence jsonb not null,
 state text not null check(state in ('verified','needs_reconciliation','failed')),
 created_at timestamptz not null default clock_timestamp()
);
create index crm_validation_receipts_property on public.crm_validation_receipts(property_id);
create index crm_validation_receipts_integration on public.crm_validation_receipts(integration_id,revision);
create trigger crm_validation_receipts_immutable before update or delete on public.crm_validation_receipts for each row execute function public.protect_shared_action_history();
alter table public.crm_validation_receipts enable row level security;
create policy crm_validation_receipts_service on public.crm_validation_receipts for all to service_role using(true) with check(true);
revoke all on public.crm_validation_receipts from public,anon,authenticated;grant all on public.crm_validation_receipts to service_role;

create function public.crm_configuration_hash(p_value jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(coalesce(p_value,'{}')::text,'UTF8')),'hex');
$$;
create function public.crm_configuration_guard() returns trigger language plpgsql security invoker set search_path='' as $$
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
 if new.mapping_validated is true or new.status in ('connected','verified') then
  if new.crm_approved_review_id is null or not exists(select 1 from public.crm_validation_receipts r where r.id=new.crm_validation_receipt_id and r.integration_id=new.id and r.property_id=new.property_id and r.revision=new.crm_revision and r.credentials_hash=public.crm_configuration_hash(new.credentials) and r.mapping_hash=public.crm_configuration_hash(new.field_mapping) and r.state='verified') then raise exception 'CRM activation requires current saved provider evidence';end if;
 end if;
 return new;
end;$$;
create trigger crm_configuration_version before insert or update on public.integration_credentials for each row execute function public.crm_configuration_guard();

create function public.save_crm_mapping_review(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_platform text,p_revision bigint,p_credentials jsonb,p_mapping jsonb)
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

create function public.read_crm_workspace(p_property_id uuid,p_actor_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'platform',c.platform,'revision',c.crm_revision,'fieldMapping',c.field_mapping,'hasCredentials',c.credentials is not null and c.credentials<>'{}',
 'reviewApproved',c.crm_approved_review_id is not null,'latestPreview',(select jsonb_build_object('id',r.id,'snapshot',r.snapshot,'createdAt',r.created_at) from public.crm_mapping_reviews r where r.integration_id=c.id and r.kind='preview' and r.revision=c.crm_revision order by r.created_at desc,r.id desc limit 1),'providerVerified',c.crm_validation_receipt_id is not null and c.mapping_validated is true,'storedStatus',c.status,
 'status',case when c.crm_validation_receipt_id is not null and c.mapping_validated is true then 'qualified' when c.crm_approved_review_id is not null then 'awaiting_provider' else 'review_required' end) order by c.platform),'[]') into rows
 from public.integration_credentials c where property_id=p_property_id and platform in ('crm','yardi','realpage','salesforce','hubspot','lasso');
 return jsonb_build_object('state','saved','integrations',rows,'canManage',exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','manager')));
end;$$;

revoke all on function public.crm_configuration_hash(jsonb),public.crm_configuration_guard(),public.save_crm_mapping_review(uuid,uuid,uuid,text,bigint,jsonb,jsonb),public.read_crm_workspace(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_configuration_hash(jsonb),public.crm_configuration_guard(),public.save_crm_mapping_review(uuid,uuid,uuid,text,bigint,jsonb,jsonb),public.read_crm_workspace(uuid,uuid) to service_role;
notify pgrst,'reload schema';

create function public.crm_lead_preview_input(p_property_id uuid,p_lead_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('first_name',first_name,'last_name',last_name,'email',email,'phone',phone,'source',source,'status',status,'move_in_date',move_in_date,'bedrooms',bedrooms,'notes',notes)
 from public.leads where id=p_lead_id and property_id=p_property_id;
$$;
create function public.preview_crm_mapping(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_integration_id uuid,p_revision bigint,p_lead_id uuid default null)
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
 if exists(select 1 from jsonb_each(c.field_mapping) m where jsonb_typeof(m.value)<>'string') or exists(select 1 from jsonb_each_text(c.field_mapping) m where m.key not in ('first_name','last_name','email','phone','source','status','move_in_date','bedrooms','notes') or m.value !~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$') then return '{"state":"invalid_mapping"}';end if;
 if (select count(*) from jsonb_each_text(c.field_mapping))<>(select count(distinct value) from jsonb_each_text(c.field_mapping)) then return '{"state":"duplicate_targets"}';end if;
 if p_lead_id is null then source_data:='{"first_name":"Example","last_name":"Lead","email":"example@example.invalid","phone":"+12025550123","source":"website","status":"new","move_in_date":"2030-01-01","bedrooms":2,"notes":"Example only; this record will not be sent."}';
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
create function public.approve_crm_mapping(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_preview_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare preview public.crm_mapping_reviews;prior public.crm_mapping_reviews;c public.integration_credentials;input_hash text;source_data jsonb;result jsonb;e jsonb;
begin
 if p_request_id is null or p_preview_id is null then raise exception 'Saved preview and decision identity required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 input_hash:=public.crm_configuration_hash(jsonb_build_object('previewId',p_preview_id));
 select * into prior from public.crm_mapping_reviews where id=p_request_id;
 if found then
  if (prior.property_id,prior.actor_id,prior.kind,prior.input_hash) is distinct from (p_property_id,p_actor_id,'approve',input_hash) then return '{"state":"request_conflict"}';end if;
  return prior.result||'{"state":"replayed"}';
 end if;
 select * into preview from public.crm_mapping_reviews where id=p_preview_id and property_id=p_property_id and kind='preview';
 if not found then return '{"state":"not_found"}';end if;
 select * into c from public.integration_credentials where id=preview.integration_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if c.crm_revision<>preview.revision or c.field_mapping<>preview.field_mapping or public.crm_configuration_hash(c.credentials)<>preview.credentials_hash then return '{"state":"stale"}';end if;
 if preview.snapshot->>'leadId' is not null then
  source_data:=public.crm_lead_preview_input(p_property_id,(preview.snapshot->>'leadId')::uuid);
  if source_data is null or public.crm_configuration_hash(source_data)<>preview.snapshot->>'sourceHash' then return '{"state":"stale_preview"}';end if;
 end if;
 if not (c.field_mapping ? 'email' or c.field_mapping ? 'phone') then return '{"state":"identity_mapping_required"}';end if;
 result:=jsonb_build_object('state','applied','reviewId',p_request_id,'integrationId',c.id,'revision',c.crm_revision,'providerVerified',false,'status','awaiting_provider');
 insert into public.crm_mapping_reviews(id,property_id,actor_id,integration_id,kind,input_hash,revision,field_mapping,credentials_hash,snapshot,result)
 values(p_request_id,p_property_id,p_actor_id,c.id,'approve',input_hash,c.crm_revision,c.field_mapping,preview.credentials_hash,jsonb_build_object('previewId',p_preview_id,'exampleOnly',preview.snapshot->'exampleOnly','sourceHash',preview.snapshot->'sourceHash'),result);
 update public.integration_credentials set crm_approved_review_id=p_request_id,mapping_validated=false,mapping_validated_at=null,status='pending',crm_validation_receipt_id=null where id=c.id;
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.mapping.approved','server_confirmed','succeeded',
 jsonb_build_object('integrationId',c.id,'previewId',p_preview_id,'revision',c.crm_revision),null,null,result);
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM approval history unavailable';end if;
 return result;
end;$$;
revoke all on function public.crm_lead_preview_input(uuid,uuid),public.preview_crm_mapping(uuid,uuid,uuid,uuid,bigint,uuid),public.approve_crm_mapping(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_lead_preview_input(uuid,uuid),public.preview_crm_mapping(uuid,uuid,uuid,uuid,bigint,uuid),public.approve_crm_mapping(uuid,uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
-- Read-only provider work has a saved request, single claim, immutable result and explicit stop.
create table public.crm_setup_operations(
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),integration_id uuid not null references public.integration_credentials(id) on delete cascade,
 kind text not null check(kind in ('connection','schema')),revision bigint not null,credentials_hash text not null,
 state text not null default 'queued' check(state in ('queued','running','completed','failed','stopped')),
 claim_id uuid,requested_at timestamptz not null default clock_timestamp(),started_at timestamptz,finished_at timestamptz,
 stopped_by uuid references public.profiles(id)
);
create index crm_setup_operations_property on public.crm_setup_operations(property_id,requested_at desc);
create index crm_setup_operations_actor on public.crm_setup_operations(actor_id);
create index crm_setup_operations_stopper on public.crm_setup_operations(stopped_by);
create index crm_setup_operations_integration on public.crm_setup_operations(integration_id,revision);
alter table public.crm_setup_operations enable row level security;
create policy crm_setup_operations_service on public.crm_setup_operations for all to service_role using(true) with check(true);
revoke all on public.crm_setup_operations from public,anon,authenticated;grant all on public.crm_setup_operations to service_role;
create table public.crm_setup_receipts(
 operation_id uuid primary key references public.crm_setup_operations(id) on delete cascade,
 property_id uuid not null references public.properties(id) on delete cascade,result jsonb not null,
 current_configuration boolean not null,accepted boolean not null,received_at timestamptz not null default clock_timestamp()
);
create index crm_setup_receipts_property on public.crm_setup_receipts(property_id);
create trigger crm_setup_receipts_immutable before update or delete on public.crm_setup_receipts for each row execute function public.protect_shared_action_history();
alter table public.crm_setup_receipts enable row level security;
create policy crm_setup_receipts_service on public.crm_setup_receipts for all to service_role using(true) with check(true);
revoke all on public.crm_setup_receipts from public,anon,authenticated;grant all on public.crm_setup_receipts to service_role;

create function public.crm_setup_operation_view(p_operation_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',o.id,'kind',o.kind,'integrationId',o.integration_id,'revision',o.revision,'state',o.state,'requestedAt',o.requested_at,'startedAt',o.started_at,'finishedAt',o.finished_at,
 'currentConfiguration',o.revision=c.crm_revision and o.credentials_hash=public.crm_configuration_hash(c.credentials),
 'receipt',case when r.operation_id is not null then jsonb_build_object('result',r.result,'accepted',r.accepted,'currentConfiguration',r.current_configuration,'receivedAt',r.received_at) end)
 from public.crm_setup_operations o join public.integration_credentials c on c.id=o.integration_id left join public.crm_setup_receipts r on r.operation_id=o.id where o.id=p_operation_id;
$$;
create function public.request_crm_setup_operation(p_property_id uuid,p_actor_id uuid,p_request_id uuid,p_integration_id uuid,p_revision bigint,p_kind text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.integration_credentials;o public.crm_setup_operations;e jsonb;
begin
 if p_request_id is null or p_kind is null or p_kind not in ('connection','schema') then raise exception 'Invalid CRM setup request';end if;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into o from public.crm_setup_operations where id=p_request_id;
 if found then
  if (o.property_id,o.actor_id,o.integration_id,o.revision,o.kind) is distinct from (p_property_id,p_actor_id,p_integration_id,p_revision,p_kind) then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','operation',public.crm_setup_operation_view(o.id));
 end if;
 select * into c from public.integration_credentials where id=p_integration_id and property_id=p_property_id and platform in ('yardi','realpage','salesforce','hubspot','lasso') for share;
 if not found then return '{"state":"not_found"}';end if;
 if c.crm_revision<>p_revision then return '{"state":"stale"}';end if;
 if exists(select 1 from public.crm_setup_operations where integration_id=c.id and state in ('queued','running')) then return '{"state":"operation_in_progress"}';end if;
 insert into public.crm_setup_operations(id,property_id,actor_id,integration_id,kind,revision,credentials_hash)values(p_request_id,p_property_id,p_actor_id,c.id,p_kind,c.crm_revision,public.crm_configuration_hash(c.credentials));
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.operation.requested','server_confirmed','succeeded',jsonb_build_object('kind',p_kind,'integrationId',c.id,'revision',c.crm_revision),null,null,'{"state":"queued","providerVerified":false}');
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM request history unavailable';end if;
 return jsonb_build_object('state','applied','operation',public.crm_setup_operation_view(p_request_id));
end;$$;

create function public.claim_crm_setup_operation(p_operation_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_setup_operations;c public.integration_credentials;claim uuid:=gen_random_uuid();
begin
 select * into o from public.crm_setup_operations where id=p_operation_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.property_id::text,12));
 select * into o from public.crm_setup_operations where id=p_operation_id for update;
 if o.state<>'queued' then return jsonb_build_object('state',o.state);end if;
 select * into c from public.integration_credentials where id=o.integration_id for share;
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=o.property_id and u.id=o.actor_id and u.role in ('admin','manager')) or c.crm_revision<>o.revision or public.crm_configuration_hash(c.credentials)<>o.credentials_hash then
  update public.crm_setup_operations set state='stopped',finished_at=clock_timestamp() where id=o.id;
  return '{"state":"stale"}';
 end if;
 update public.crm_setup_operations set state='running',claim_id=claim,started_at=clock_timestamp() where id=o.id;
 return jsonb_build_object('state','claimed','claimId',claim,'operationId',o.id,'kind',o.kind,'platform',c.platform,'credentials',c.credentials,'mapping',c.field_mapping);
end;$$;

create function public.finish_crm_setup_operation(p_operation_id uuid,p_claim_id uuid,p_result jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_setup_operations;c public.integration_credentials;r public.crm_setup_receipts;current_config boolean;accepted boolean;e jsonb;
begin
 if jsonb_typeof(p_result) is distinct from 'object' or p_result->>'status' is null or p_result->>'status' not in ('checked','limited','failed') or length(p_result::text)>256000 or p_result-array['status','connection','schema','suggestions','mappingIssues','messageCode']<>'{}' then raise exception 'Invalid CRM setup result';end if;
 select * into o from public.crm_setup_operations where id=p_operation_id;
 if not found then return '{"state":"not_found"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.property_id::text,12));
 select * into o from public.crm_setup_operations where id=p_operation_id for update;
 if o.claim_id is distinct from p_claim_id or p_claim_id is null then return '{"state":"claim_conflict"}';end if;
 select * into r from public.crm_setup_receipts where operation_id=o.id;
 if found then
  if r.result is distinct from p_result then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed');
 end if;
 select * into c from public.integration_credentials where id=o.integration_id;
 current_config:=c.crm_revision=o.revision and public.crm_configuration_hash(c.credentials)=o.credentials_hash;
 accepted:=o.state='running' and current_config and exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=o.property_id and u.id=o.actor_id and u.role in ('admin','manager'));
 insert into public.crm_setup_receipts(operation_id,property_id,result,current_configuration,accepted)values(o.id,o.property_id,p_result,current_config,accepted);
 update public.crm_setup_operations set state=case when not accepted then 'stopped' when p_result->>'status'='failed' then 'failed' else 'completed' end,finished_at=clock_timestamp() where id=o.id;
 if exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=o.property_id and u.id=o.actor_id) then
  e:=public.append_shared_action_event(gen_random_uuid(),o.id,o.property_id,o.actor_id,'crm','crm.operation.completed','server_confirmed',case when accepted and p_result->>'status'<>'failed' then 'succeeded' else 'failed' end,
   jsonb_build_object('operationId',o.id,'kind',o.kind,'revision',o.revision),null,null,jsonb_build_object('status',p_result->>'status','accepted',accepted,'currentConfiguration',current_config,'providerVerified',false));
  if e->>'state' not in ('recorded','replayed') then raise exception 'CRM result history unavailable';end if;
 end if;
 return jsonb_build_object('state','saved','accepted',accepted);
end;$$;

create function public.stop_crm_setup_operation(p_property_id uuid,p_actor_id uuid,p_operation_id uuid,p_request_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.crm_setup_operations;e jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in ('admin','manager')) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into o from public.crm_setup_operations where id=p_operation_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if o.state not in ('queued','running') then return jsonb_build_object('state','saved','operation',public.crm_setup_operation_view(o.id));end if;
 update public.crm_setup_operations set state='stopped',stopped_by=p_actor_id,finished_at=clock_timestamp() where id=o.id;
 e:=public.append_shared_action_event(p_request_id,p_request_id,p_property_id,p_actor_id,'crm','crm.operation.stopped','server_confirmed','succeeded',jsonb_build_object('operationId',o.id,'kind',o.kind),null,null,'{"state":"stopped","providerCallMayHaveFinished":true}');
 if e->>'state' not in ('recorded','replayed') then raise exception 'CRM stop history unavailable';end if;
 return jsonb_build_object('state','applied','operation',public.crm_setup_operation_view(o.id));
end;$$;

create function public.read_crm_setup_operations(p_property_id uuid,p_actor_id uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare rows jsonb;
begin
 if not exists(select 1 from public.properties p join public.profiles u on p.org_id=u.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 select coalesce(jsonb_agg(public.crm_setup_operation_view(id) order by requested_at desc),'[]') into rows from (select id,requested_at from public.crm_setup_operations where property_id=p_property_id order by requested_at desc,id desc limit 30) o;
 return jsonb_build_object('state','saved','operations',rows);
end;$$;
revoke all on function public.crm_setup_operation_view(uuid),public.request_crm_setup_operation(uuid,uuid,uuid,uuid,bigint,text),public.claim_crm_setup_operation(uuid),public.finish_crm_setup_operation(uuid,uuid,jsonb),public.stop_crm_setup_operation(uuid,uuid,uuid,uuid),public.read_crm_setup_operations(uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_setup_operation_view(uuid),public.request_crm_setup_operation(uuid,uuid,uuid,uuid,bigint,text),public.claim_crm_setup_operation(uuid),public.finish_crm_setup_operation(uuid,uuid,jsonb),public.stop_crm_setup_operation(uuid,uuid,uuid,uuid),public.read_crm_setup_operations(uuid,uuid) to service_role;
notify pgrst,'reload schema';
