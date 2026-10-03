create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('property.setup.saved','site.delivery.recorded','site.delivery.reviewed','site.delivery.withdrawn','site.brief.saved','site.brief.export_prepared','site.brief.export_reported','lead.note.created','lead.note.corrected','lead.note.withdrawn','lead.note.restored','market.brand_search.saved','market.brand.requested','market.brand.stopped','market.brand.recovered','market.brand.published','market.brand.withdrawn','market.alert.created','market.alert.read','market.alert.dismissed','market.alert.restored','market.intake.prepared','market.intake.applied','market.intake.stopped','market.handoff.prepared','market.handoff.decided','market.brief.requested','market.brief.recovered','market.brief.reviewed','market.brief.exported','market.source.requested','market.source.stopped','market.source.recovered','market.listing.saved','market.listing.removed','market.extraction.requested','market.extraction.stopped','market.extraction.recovered','market.extraction.rebased','market.extraction.applied','market.competitor.saved','market.competitor.archived','market.competitor.restored','market.unit.saved','market.unit.removed','market.configuration.saved','review.testimonial.approved','review.testimonial.revoked','review.insights.saved','review.batch.prepared','review.batch.approved','review.batch.stopped','review.batch.recovered','review.configuration.saved','review.connection.saved','review.connection.disconnected','review.intake.requested','review.intake.applied','review.intake.stopped','review.intake.recovered','review.intake.rebased','review.publication.prepared','review.publication.reported','review.publication.cancelled','review.publication.uncertain','review.response.draft_saved','review.response.approved','review.response.rejected','review.response.generation_requested','review.response.generation_started','review.response.generation_result_received','review.response.generation_completed','review.response.generation_stopped','review.response.generation_recovered','review.case.created','review.case.updated','review.case.resolved','review.case.dismissed','review.case.reopened','review.case.note_added','review.ticket.created','review.ticket.updated','review.ticket.reopened','review.analysis.started','review.analysis.result_received','review.analysis.requested','review.analysis.completed','review.analysis.stopped','review.analysis.recovered','studio.credentials.renewal_requested','studio.credentials.renewal_completed','studio.app_configuration.save','studio.app_configuration.disable','studio.connection.disconnected','studio.authorization.started','studio.authorization.cancelled','studio.authorization.applied','studio.configuration.saved','studio.metrics.requested','studio.metrics.reported','studio.metrics.reviewed','studio.attribution.reviewed','studio.media.requested','studio.media.stopped','studio.media.recovered','studio.media.completed','studio.asset.saved','studio.asset.reviewed','studio.asset.archived','studio.asset.restored','studio.asset.upload.requested','studio.asset.uploaded','studio.asset.replaced','studio.asset.upload.recovered','studio.sources.refreshed','studio.generation.recovered','studio.generation.requested','studio.generation.stopped','studio.publication.recovery_reviewed','studio.publications.scheduled','studio.publication.cancel','studio.publication.reschedule','studio.brief.saved','studio.package.created','studio.revision.saved','studio.revision.reviewed','crm.qualification.prepared','crm.qualification.approved','crm.qualification.recovered','crm.qualification.activated','crm.qualification.stopped','crm.qualification.completed','crm.bulk.prepared','crm.bulk.approved','crm.bulk.stopped','crm.delivery.recovery_requested','crm.delivery.recovery_checked','crm.delivery.approved','crm.delivery.requested','crm.delivery.completed','crm.delivery.cancelled','crm.delivery.reconciled','crm.mapping.saved','crm.mapping.previewed','crm.mapping.approved','crm.operation.requested','crm.operation.completed','crm.operation.stopped','lead.score.reviewed','lead.engagement.recorded','lead.engagement.corrected','lead.score.recalculated','lead.scoring.started','lead.scoring.completed','lead.scoring.cancelled','console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.research.requested','brand.research.completed','brand.research.cancelled','brand.source.saved','brand.asset.upload.requested','brand.asset.uploaded','brand.asset.reviewed','brand.import.previewed','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
 elsif p_action='site.brief.export_reported' then
  if p_product<>'siteforge' or p_evidence<>'browser_observed' or p_phase<>'observed' then raise exception 'Invalid reported handoff evidence';end if;
 elsif p_action='property.setup.saved' then
  if p_product<>'property' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid property evidence';end if;
 elsif p_action like 'site.%' then
  if p_product<>'siteforge' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid brief evidence';end if;
 elsif p_action like 'review.%' then
  if p_product<>'reviewflow' or p_evidence<>'server_confirmed' or p_phase not in('succeeded','failed') then raise exception 'Invalid review evidence';end if;
 elsif p_action like 'market.%' then
  if p_product<>'marketvision' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid market evidence';end if;
 elsif p_action like 'studio.%' then
  if p_product<>'forgestudio' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid editorial evidence';end if;
 elsif p_action like 'crm.%' then
  if p_product<>'crm' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid CRM evidence';end if;
 elsif p_action like 'lead.note.%' then
  if p_product<>'tourspark' or p_evidence<>'server_confirmed' or p_phase<>'succeeded' then raise exception 'Invalid internal note evidence';end if;
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
 origin:=case when p_action='property.setup.saved' then 'console' when p_action like 'site.%' then 'console' when p_action like 'market.%' then 'console' when p_action in('review.response.generation_started','review.response.generation_result_received','review.response.generation_completed') or(p_action='review.response.draft_saved' and p_result->>'origin'='model_result') then 'workflow' when p_action in('review.analysis.started','review.analysis.result_received','review.analysis.completed') then 'workflow' when p_action like 'review.%' then 'console' when p_action in('studio.media.completed','studio.credentials.renewal_completed') then 'workflow' when p_action like 'studio.%' then 'console' when p_action like 'lead.%' or p_action like 'crm.%' then 'console' when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;




create table public.property_setup_state (
 property_id uuid primary key references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 connection_requests jsonb not null default '[]',
 updated_at timestamptz not null default clock_timestamp()
);
create index property_setup_state_org on public.property_setup_state(org_id);
create table public.property_setup_changes (
 id uuid primary key,
 change_sequence bigint generated always as identity unique,
 property_id uuid not null references public.properties(id) on delete cascade,
 org_id uuid not null references public.organizations(id),
 actor_id uuid not null references public.profiles(id),
 input jsonb not null,
 before_state jsonb not null,
 after_state jsonb not null,
 before_hash text not null,
 after_hash text not null,
 changed_sections jsonb not null,
 context_invalidated boolean not null,
 created_at timestamptz not null default clock_timestamp()
);
create index property_setup_changes_property on public.property_setup_changes(property_id,change_sequence desc);
create index property_setup_changes_org on public.property_setup_changes(org_id);
create index property_setup_changes_actor on public.property_setup_changes(actor_id);
alter table public.property_setup_state enable row level security;
alter table public.property_setup_changes enable row level security;
revoke all on public.property_setup_state,public.property_setup_changes from public,anon,authenticated;
grant all on public.property_setup_state,public.property_setup_changes to service_role;
create policy property_setup_state_service on public.property_setup_state for all to service_role using(true) with check(true);
create policy property_setup_changes_service on public.property_setup_changes for all to service_role using(true) with check(true);
revoke all on sequence public.property_setup_changes_change_sequence_seq from public,anon,authenticated;
grant usage,select on sequence public.property_setup_changes_change_sequence_seq to service_role;
create trigger property_setup_history_immutable before update or delete on public.property_setup_changes for each row execute function public.guard_siteforge_brief_history();

-- Only fields owned by this editor participate; unrelated runtime settings remain intact.
create function public.property_edit_snapshot(p_property_id uuid)returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('profile',jsonb_build_object(
  'name',p.name,'propertyType',p.property_type,'address',jsonb_build_object('street',coalesce(p.address->>'street',''),'city',coalesce(p.address->>'city',''),'state',coalesce(p.address->>'state',''),'zip',coalesce(p.address->>'zip','')),
  'websiteUrl',coalesce(p.website_url,''),'additionalUrls',coalesce(nullif(p.settings->'additionalUrls','null'::jsonb),'[]'::jsonb),'unitCount',p.unit_count,'yearBuilt',p.year_built,
  'amenities',coalesce(to_jsonb(p.amenities),'[]'::jsonb),'specialFeatures',coalesce(to_jsonb(p.special_features),'[]'::jsonb),'brandVoice',coalesce(p.brand_voice,''),'targetAudience',coalesce(p.target_audience,'')),
  'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'type',c.contact_type,'name',c.name,'email',c.email,'phone',coalesce(c.phone,''),'role',coalesce(c.role,''),'billingAddress',jsonb_build_object('street',coalesce(c.billing_address->>'street',''),'city',coalesce(c.billing_address->>'city',''),'state',coalesce(c.billing_address->>'state',''),'zip',coalesce(c.billing_address->>'zip','')),'billingMethod',coalesce(c.billing_method,''),'specialInstructions',coalesce(c.special_instructions,''),'needsW9',coalesce(c.needs_w9,false),'isPrimary',coalesce(c.is_primary,false))order by c.id)from public.property_contacts c where c.property_id=p.id),'[]'::jsonb),
  'contextCity',p.settings->'city','connectionRequests',coalesce((select s.connection_requests from public.property_setup_state s where s.property_id=p.id and s.org_id=p.org_id),'[]'::jsonb))
 from public.properties p where p.id=p_property_id
$$;

create function public.save_property_setup(p_id uuid,p_property_id uuid,p_actor_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_role text;v_property public.properties;v_saved public.property_setup_changes;v_before jsonb;v_after jsonb;v_hash text;v_after_hash text;v_profile jsonb;v_contact jsonb;v_request jsonb;v_event jsonb;v_sections jsonb:='[]';v_invalidated boolean:=false;v_now timestamptz:=clock_timestamp();v_key text;v_value jsonb;v_contact_id uuid;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if v_org is null or not coalesce(v_role in('admin','manager'),false)then return '{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object' or p_input-array['expectedHash','profile','contacts','connectionRequests','reason']<>'{}' or not(p_input?&array['expectedHash','profile','contacts','connectionRequests','reason'])or octet_length(p_input::text)>524288 or length(btrim(coalesce(p_input->>'reason','')))not between 3 and 2000 or coalesce(p_input->>'expectedHash','')!~'^[a-f0-9]{64}$'then raise exception 'Invalid property edit';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select *into v_property from public.properties where id=p_property_id and org_id=v_org for update;
 if not found or not exists(select 1 from public.profiles where id=p_actor_id and org_id=v_org and role in('admin','manager'))then return '{"state":"forbidden"}';end if;
 -- Serialize identical identities across properties too, then recheck saved scope.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,852));
 select *into v_saved from public.property_setup_changes where id=p_id;
 if found then
  if(v_saved.property_id,v_saved.org_id,v_saved.actor_id,v_saved.input)is distinct from(p_property_id,v_org,p_actor_id,p_input)then return '{"state":"request_conflict"}';end if;
  return jsonb_build_object('state','replayed','id',v_saved.id,'afterHash',v_saved.after_hash,'contextInvalidated',v_saved.context_invalidated,'changedSections',v_saved.changed_sections);
 end if;
 perform 1 from public.property_contacts where property_id=p_property_id for update;
 v_before:=public.property_edit_snapshot(p_property_id);v_hash:=encode(extensions.digest(v_before::text,'sha256'),'hex');
 if v_hash<>p_input->>'expectedHash'then return '{"state":"source_changed"}';end if;
 v_profile:=p_input->'profile';
 if jsonb_typeof(v_profile)is distinct from'object'or v_profile-array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience']<>'{}' or not(v_profile?&array['name','propertyType','address','websiteUrl','additionalUrls','unitCount','yearBuilt','amenities','specialFeatures','brandVoice','targetAudience'])then raise exception 'Invalid property facts';end if;
 foreach v_key in array array['name','websiteUrl','brandVoice','targetAudience']loop
  if jsonb_typeof(v_profile->v_key)is distinct from'string'or length(v_profile->>v_key)>(case when v_key='name'then 300 else 4000 end) then raise exception 'Invalid property text';end if;
 end loop;
 if length(btrim(v_profile->>'name'))<1 then raise exception 'Property name is required';end if;
 if v_profile->'propertyType'<>'null'::jsonb and (jsonb_typeof(v_profile->'propertyType')is distinct from'string'or(v_profile->>'propertyType'not in('multifamily','senior','student','mixed_use','affordable','luxury','townhome','condo','single_family','master_planned')and v_profile->'propertyType'is distinct from v_before->'profile'->'propertyType'))then raise exception 'Select a supported property classification';end if;
 foreach v_key in array array['unitCount','yearBuilt']loop
  if v_profile->v_key<>'null'::jsonb and (jsonb_typeof(v_profile->v_key)is distinct from'number'or(v_profile->>v_key)!~'^\d+$'or(v_profile->>v_key)::numeric>(case when v_key='unitCount'then 1000000 else 9999 end) or(v_key='yearBuilt'and(v_profile->>v_key)::numeric<1))then raise exception 'Use a whole nonnegative unit count and a valid year';end if;
 end loop;
 if jsonb_typeof(v_profile->'address')is distinct from'object'or (v_profile->'address')-array['street','city','state','zip']<>'{}'or not(v_profile->'address'?&array['street','city','state','zip'])then raise exception 'Invalid property address';end if;
 for v_key,v_value in select *from jsonb_each(v_profile->'address')loop if jsonb_typeof(v_value)is distinct from'string'or length(v_value#>>'{}')>500 then raise exception 'Invalid property address';end if;end loop;
 foreach v_key in array array['additionalUrls','amenities','specialFeatures']loop
  if jsonb_typeof(v_profile->v_key)is distinct from'array'or jsonb_array_length(v_profile->v_key)>(case when v_key='additionalUrls'then 50 else 200 end) then raise exception 'Property list exceeds its supported size';end if;
  for v_value in select value from jsonb_array_elements(v_profile->v_key)loop if jsonb_typeof(v_value)is distinct from'string'or length(btrim(v_value#>>'{}'))not between 1 and 4000 then raise exception 'Invalid property list';end if;end loop;
 end loop;
 -- These are stored references only; no URL is fetched by this operation.
 for v_value in select value from jsonb_array_elements((v_profile->'additionalUrls')||jsonb_build_array(v_profile->>'websiteUrl'))loop
  if(v_value#>>'{}')<>''and(v_value#>>'{}')!~'^https?://[^[:space:]@]+$'then raise exception 'Use an HTTP or HTTPS website address without embedded credentials';end if;
 end loop;
 if jsonb_typeof(p_input->'contacts')is distinct from'array'or jsonb_array_length(p_input->'contacts')>100 then raise exception 'Edit at most 100 contacts in one property save';end if;
 if(select count(*)<>count(distinct c->>'id')from jsonb_array_elements(p_input->'contacts')c)then raise exception 'Contact identities must be unique';end if;
 if(select count(*)>1 from jsonb_array_elements(p_input->'contacts')c where c->>'type'='primary'or c->'isPrimary'='true')then raise exception 'Choose at most one primary contact';end if;
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  if jsonb_typeof(v_contact)is distinct from'object'or v_contact-array['id','type','name','email','phone','role','billingAddress','billingMethod','specialInstructions','needsW9','isPrimary']<>'{}'or not(v_contact?&array['id','type','name','email','phone','role','billingAddress','billingMethod','specialInstructions','needsW9','isPrimary'])then raise exception 'Invalid contact';end if;
  v_contact_id:=(v_contact->>'id')::uuid;
  if v_contact_id is null or exists(select 1 from public.property_contacts c where c.id=v_contact_id and c.property_id<>p_property_id)then return '{"state":"contact_conflict"}';end if;
  if v_contact->>'type'not in('primary','secondary','billing','emergency')or jsonb_typeof(v_contact->'needsW9')is distinct from'boolean'or jsonb_typeof(v_contact->'isPrimary')is distinct from'boolean'then raise exception 'Invalid contact type';end if;
  foreach v_key in array array['name','email','phone','role','billingMethod','specialInstructions']loop
   if jsonb_typeof(v_contact->v_key)is distinct from'string'or length(v_contact->>v_key)>(case when v_key='specialInstructions'then 4000 else 500 end) then raise exception 'Invalid contact details';end if;
  end loop;
  if length(btrim(v_contact->>'name'))<1 or v_contact->>'email'!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'then raise exception 'Each contact needs a name and email address';end if;
  if v_contact->>'billingMethod'not in('','ops_merchant','nexus','ach','check','credit_card','other')then raise exception 'Invalid billing method';end if;
  if jsonb_typeof(v_contact->'billingAddress')is distinct from'object'or (v_contact->'billingAddress')-array['street','city','state','zip']<>'{}'or not(v_contact->'billingAddress'?&array['street','city','state','zip'])then raise exception 'Invalid billing address';end if;
  for v_key,v_value in select *from jsonb_each(v_contact->'billingAddress')loop if jsonb_typeof(v_value)is distinct from'string'or length(v_value#>>'{}')>500 then raise exception 'Invalid billing address';end if;end loop;
 end loop;
 if jsonb_typeof(p_input->'connectionRequests')is distinct from'array'or jsonb_array_length(p_input->'connectionRequests')>11 then raise exception 'Invalid connection requests';end if;
 if(select count(*)<>count(distinct x->>'platform')from jsonb_array_elements(p_input->'connectionRequests')x)then raise exception 'Connection requests must be unique';end if;
 for v_request in select value from jsonb_array_elements(p_input->'connectionRequests')loop
  if jsonb_typeof(v_request)is distinct from'object'or v_request-array['platform','accountId','accountName','notes']<>'{}'or not(v_request?&array['platform','accountId','accountName','notes'])or v_request->>'platform'not in('google_analytics','google_search_console','google_tag_manager','google_ads','google_business_profile','meta_ads','linkedin_ads','tiktok_ads','email_marketing','crm','pms')then raise exception 'Invalid connection request';end if;
  foreach v_key in array array['platform','accountId','accountName','notes']loop if jsonb_typeof(v_request->v_key)is distinct from'string'or length(v_request->>v_key)>(case when v_key='notes'then 4000 else 500 end) then raise exception 'Invalid connection request details';end if;end loop;
 end loop;
 perform set_config('p11.property_setup_scope',p_property_id::text,true);
 update public.properties set name=btrim(v_profile->>'name'),property_type=v_profile->>'propertyType',address=coalesce(address,'{}')||(v_profile->'address'),website_url=nullif(v_profile->>'websiteUrl',''),unit_count=(v_profile->>'unitCount')::integer,year_built=(v_profile->>'yearBuilt')::integer,
 amenities=array(select jsonb_array_elements_text(v_profile->'amenities')),special_features=array(select jsonb_array_elements_text(v_profile->'specialFeatures')),brand_voice=nullif(v_profile->>'brandVoice',''),target_audience=nullif(v_profile->>'targetAudience',''),settings=coalesce(settings,'{}')||jsonb_build_object('additionalUrls',v_profile->'additionalUrls','city',v_profile->'address'->>'city'),updated_at=v_now where id=p_property_id;
 delete from public.property_contacts c where c.property_id=p_property_id and not exists(select 1 from jsonb_array_elements(p_input->'contacts')x where(x->>'id')::uuid=c.id);
 for v_contact in select value from jsonb_array_elements(p_input->'contacts')loop
  insert into public.property_contacts(id,property_id,contact_type,name,email,phone,role,billing_address,billing_method,special_instructions,needs_w9,is_primary,updated_at)
  values((v_contact->>'id')::uuid,p_property_id,v_contact->>'type',v_contact->>'name',v_contact->>'email',nullif(v_contact->>'phone',''),nullif(v_contact->>'role',''),v_contact->'billingAddress',nullif(v_contact->>'billingMethod',''),nullif(v_contact->>'specialInstructions',''),(v_contact->>'needsW9')::boolean,(v_contact->>'isPrimary')::boolean,v_now)
  on conflict(id)do update set contact_type=excluded.contact_type,name=excluded.name,email=excluded.email,phone=excluded.phone,role=excluded.role,billing_address=coalesce(public.property_contacts.billing_address,'{}')||excluded.billing_address,billing_method=excluded.billing_method,special_instructions=excluded.special_instructions,needs_w9=excluded.needs_w9,is_primary=excluded.is_primary,updated_at=excluded.updated_at where public.property_contacts.property_id=p_property_id;
 end loop;
 insert into public.property_setup_state(property_id,org_id,connection_requests,updated_at)values(p_property_id,v_org,p_input->'connectionRequests',v_now)on conflict(property_id)do update set connection_requests=excluded.connection_requests,org_id=excluded.org_id,updated_at=excluded.updated_at;
 v_after:=public.property_edit_snapshot(p_property_id);v_after_hash:=encode(extensions.digest(v_after::text,'sha256'),'hex');
 foreach v_key in array array['profile','contacts','connectionRequests']loop if v_before->v_key is distinct from v_after->v_key then v_sections:=v_sections||jsonb_build_array(v_key);end if;end loop;
 if v_before->'profile'is distinct from v_after->'profile'or v_before->'contextCity'is distinct from v_after->'contextCity'then
  update public.property_chatbot_contexts set status='stale',stale_at=v_now,last_change_summary='Saved property facts changed; refresh assistant facts before serving the new version.',version=version+1,updated_at=v_now where property_id=p_property_id;
  v_invalidated:=found;
 end if;
 insert into public.property_setup_changes(id,property_id,org_id,actor_id,input,before_state,after_state,before_hash,after_hash,changed_sections,context_invalidated)values(p_id,p_property_id,v_org,p_actor_id,p_input,v_before,v_after,v_hash,v_after_hash,v_sections,v_invalidated);
 v_event:=public.append_shared_action_event(p_id,p_id,p_property_id,p_actor_id,'property','property.setup.saved','server_confirmed','succeeded',jsonb_build_object('changeId',p_id,'inputHash',encode(extensions.digest(p_input::text,'sha256'),'hex')),jsonb_build_object('hash',v_hash),jsonb_build_object('hash',v_after_hash),jsonb_build_object('changedSections',v_sections,'contextInvalidated',v_invalidated,'connectionsActivated',false,'websiteFetched',false));
 if v_event->>'state'not in('recorded','replayed')then raise exception 'Could not record property change';end if;
 perform set_config('p11.property_setup_scope','',true);
 return jsonb_build_object('state','saved','id',p_id,'afterHash',v_after_hash,'contextInvalidated',v_invalidated,'changedSections',v_sections);
end$$;

create function public.read_property_setup(p_property_id uuid,p_actor_id uuid,p_cursor uuid default null,p_change_id uuid default null)returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_role text;v_snapshot jsonb;v_cursor bigint;v_rows jsonb;v_selected jsonb;v_next uuid;v_property jsonb;v_connections jsonb;v_context jsonb;
begin
 select p.org_id,u.role into v_org,v_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id for share of p,u;
 if v_org is null then return '{"state":"forbidden"}';end if;
 v_snapshot:=public.property_edit_snapshot(p_property_id);
 if octet_length(v_snapshot::text)>5242880 then raise exception 'Property setup is too large to read safely';end if;
 if p_cursor is not null then select change_sequence into v_cursor from public.property_setup_changes where id=p_cursor and property_id=p_property_id and org_id=v_org;if not found then return '{"state":"cursor_changed"}';end if;end if;
 with page as(select c.* from public.property_setup_changes c where c.property_id=p_property_id and c.org_id=v_org and(v_cursor is null or c.change_sequence<v_cursor)order by c.change_sequence desc limit 21)
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'actorId',x.actor_id,'actorName',u.full_name,'createdAt',x.created_at,'reason',x.input->>'reason','changedSections',x.changed_sections,'contextInvalidated',x.context_invalidated)order by x.change_sequence desc)filter(where x.n<=20),'[]'::jsonb),(array_agg(x.id order by x.change_sequence desc))[20] into v_rows,v_next from(select page.*,row_number()over(order by change_sequence desc)n from page)x left join public.profiles u on u.id=x.actor_id;
 if jsonb_array_length(v_rows)<20 or not exists(select 1 from public.property_setup_changes where property_id=p_property_id and org_id=v_org and change_sequence<(select change_sequence from public.property_setup_changes where id=v_next))then v_next:=null;end if;
 if p_change_id is not null then select jsonb_build_object('id',c.id,'actorId',c.actor_id,'actorName',u.full_name,'createdAt',c.created_at,'reason',c.input->>'reason','changedSections',c.changed_sections,'before',c.before_state,'after',c.after_state,'beforeHash',c.before_hash,'afterHash',c.after_hash,'contextInvalidated',c.context_invalidated)into v_selected from public.property_setup_changes c left join public.profiles u on u.id=c.actor_id where c.id=p_change_id and c.property_id=p_property_id and c.org_id=v_org;if not found then return '{"state":"not_found"}';end if;end if;
 select jsonb_build_object('id',p.id,'name',p.name,'org_id',p.org_id,'address',p.address,'property_type',p.property_type,'website_url',p.website_url,'unit_count',p.unit_count,'year_built',p.year_built,'amenities',p.amenities,'pet_policy',p.pet_policy,'parking_info',p.parking_info,'special_features',p.special_features,'brand_voice',p.brand_voice,'target_audience',p.target_audience,'office_hours',p.office_hours,'social_media',p.social_media,'created_at',p.created_at,'settings',jsonb_build_object('additionalUrls',p.settings->'additionalUrls','brand_insights',p.settings->'brand_insights'))into v_property from public.properties p where p.id=p_property_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'platform',i.platform,'status',i.status,'account_id',i.account_id,'account_name',i.account_name,'notes',i.notes)order by i.platform,i.id),'[]'::jsonb)into v_connections from public.integration_credentials i where i.property_id=p_property_id;
 select jsonb_build_object('status',c.status,'requiresReview',c.requires_review,'lastGeneratedAt',c.last_generated_at,'changeSummary',c.last_change_summary)into v_context from public.property_chatbot_contexts c where c.property_id=p_property_id;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'canEdit',coalesce(v_role in('admin','manager'),false),'snapshot',v_snapshot-'contextCity','snapshotHash',encode(extensions.digest(v_snapshot::text,'sha256'),'hex'),'property',v_property,'connections',v_connections,'context',v_context,'changes',v_rows,'nextCursor',v_next,'total',(select count(*)from public.property_setup_changes where property_id=p_property_id and org_id=v_org),'selected',v_selected);
end$$;
revoke all on function public.property_edit_snapshot(uuid),public.save_property_setup(uuid,uuid,uuid,jsonb),public.read_property_setup(uuid,uuid,uuid,uuid)from public,anon,authenticated;
grant execute on function public.property_edit_snapshot(uuid),public.save_property_setup(uuid,uuid,uuid,jsonb),public.read_property_setup(uuid,uuid,uuid,uuid)to service_role;

-- Once adopted, older partial writers cannot change the editor-owned values without the transaction.
-- Parent deletion still cascades through historical records under its separate authorization.
create function public.guard_recorded_property_setup()returns trigger language plpgsql security invoker set search_path='' as $$
declare v_property uuid;
begin
 if tg_table_name='properties'then
  if (new.name,new.property_type,new.address,new.website_url,new.unit_count,new.year_built,new.amenities,new.special_features,new.brand_voice,new.target_audience,new.settings->'additionalUrls',new.settings->'city')is not distinct from(old.name,old.property_type,old.address,old.website_url,old.unit_count,old.year_built,old.amenities,old.special_features,old.brand_voice,old.target_audience,old.settings->'additionalUrls',old.settings->'city')then return new;end if;
  v_property:=old.id;
 else
  if tg_op<>'INSERT'then
   if not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
   if exists(select 1 from public.property_setup_changes where property_id=old.property_id)and coalesce(current_setting('p11.property_setup_scope',true),'')<>old.property_id::text then raise exception 'Use the recorded property editor to change saved contacts';end if;
  end if;
  if tg_op='DELETE'then return old;end if;
  v_property:=new.property_id;
 end if;
 if exists(select 1 from public.property_setup_changes where property_id=v_property)and coalesce(current_setting('p11.property_setup_scope',true),'')<>v_property::text then raise exception 'Use the recorded property editor to change saved property details';end if;
 return new;
end$$;
create trigger recorded_property_setup_guard before update on public.properties for each row execute function public.guard_recorded_property_setup();
create trigger recorded_property_contacts_guard before insert or update or delete on public.property_contacts for each row execute function public.guard_recorded_property_setup();
revoke all on function public.guard_recorded_property_setup()from public,anon,authenticated;
grant execute on function public.guard_recorded_property_setup()to service_role;
