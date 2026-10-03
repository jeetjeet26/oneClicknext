create or replace function public.append_shared_action_event(p_id uuid,p_episode_id uuid,p_property_id uuid,p_actor_id uuid,p_product text,p_action text,p_evidence text,p_phase text,p_request jsonb,p_before jsonb,p_after jsonb,p_result jsonb,p_links jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare organization uuid;e public.shared_action_events;episode public.shared_action_episodes;origin text;job uuid;attempt uuid;context_id uuid;
begin
 if p_id is null or p_episode_id is null or p_actor_id is null or jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_result) is distinct from 'object'
  or length(coalesce(p_request::text,''))+length(coalesce(p_before::text,''))+length(coalesce(p_after::text,''))+length(coalesce(p_result::text,''))>32768 then raise exception 'Invalid action event';end if;
 if p_product not in ('platform','siteforge','lumaleasing','propertyaudit','brandforge','tourspark','leadpulse','crm','forgestudio','reviewflow','marketvision','bi','knowledge','property','integrations','reports','pipelines','settings','team','agency')
  or p_action not in ('console.page.viewed','workflow.pause','workflow.resume','workflow.stop','workflow.delivery.reviewed','tour.outcome.recorded','tour.no_show.corrected','tour.rescheduled','tour.cancelled','tour.reminder.reviewed','tour.booked','tour.timezone.set','tour.schedule_delivery.reviewed','tour.calendar_change.reviewed','tour.calendar_event.bound','brand.operation.requested','brand.operation.cancelled','brand.brief.saved','brand.section.generated','brand.section.regenerated','brand.section.edited','brand.section.approved','brand.contract.generated','brand.contract.imported','brand.export.created','brand.revision.started','brand.visuals.generated','brand.knowledge.published','calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced','luma.configuration.created','luma.configuration.saved') then raise exception 'Unregistered action';end if;
 if p_action='console.page.viewed' then
  if p_evidence<>'browser_observed' or p_phase<>'observed' or p_request-array['path']<>'{}' or p_before is not null or p_after is not null or p_links<>'{}' then raise exception 'Invalid observation';end if;
 elsif p_action in ('calendar.disconnected','integration.authorization.completed','integration.authorization.started','integration.authorization.cancelled','integration.authorization.failed','email.disconnected','integration.invite.created','integration.invite.revoked','integration.replacement.requested','integration.account.replaced') then
  if p_product<>'integrations' or p_evidence<>'server_confirmed' or p_phase not in ('succeeded','failed') then raise exception 'Invalid connection evidence';end if;
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
 origin:=case when p_action in ('console.page.viewed','luma.configuration.created','luma.configuration.saved') then 'console' else 'workflow' end;
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(p_episode_id,organization,p_property_id,p_actor_id,origin) on conflict(id) do nothing;
 select * into episode from public.shared_action_episodes where id=p_episode_id;
 if (episode.org_id,episode.property_id,episode.actor_id,episode.origin) is distinct from (organization,p_property_id,p_actor_id,origin) then return '{"state":"episode_conflict"}';end if;
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,before_state,after_state,result,shared_job_ref,shared_attempt_ref,context_snapshot_ref)
 values(p_id,p_episode_id,organization,p_property_id,p_actor_id,p_product,p_action,p_evidence,p_phase,p_request,p_before,p_after,p_result,job,attempt,context_id);
 return jsonb_build_object('state','recorded','eventId',p_id);
end; $$;

-- The revision changes for every saved BrandForge change, including older service writers.
alter table public.property_brand_assets add column if not exists revision bigint not null default 1,
 add column if not exists proposed_sections jsonb;
create or replace function public.version_brand_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (to_jsonb(new)-array['revision','updated_at']) is distinct from (to_jsonb(old)-array['revision','updated_at']) then
  new.revision:=old.revision+1;
  if (to_jsonb(new)-array['revision','updated_at','brand_book_pdf_url','pdf_generated_at','embedded_at','embedded_to_kb']) is distinct from (to_jsonb(old)-array['revision','updated_at','brand_book_pdf_url','pdf_generated_at','embedded_at','embedded_to_kb']) then
   new.brand_book_pdf_url:=null;new.pdf_generated_at:=null;
  end if;
 else new.revision:=old.revision;end if;
 return new;
end; $$;
create trigger brand_asset_revision before update on public.property_brand_assets for each row execute function public.version_brand_asset();
create table public.brand_operations (
 id uuid primary key,property_id uuid not null references public.properties(id) on delete cascade,
 brand_asset_id uuid not null references public.property_brand_assets(id) on delete cascade,
 actor_id uuid not null references public.profiles(id),kind text not null check(kind in ('brief','generate','regenerate','edit','approve','contract','import','export','revise','visuals','publish')),
 expected_revision bigint not null, input jsonb not null, claim_token uuid not null default gen_random_uuid(),
 state text not null default 'running' check(state in ('running','succeeded','failed','cancelled')),
 result jsonb,started_at timestamptz not null default now(),finished_at timestamptz
);
create unique index brand_one_active_operation on public.brand_operations(brand_asset_id) where state='running';
create index brand_operations_property_started on public.brand_operations(property_id,started_at desc,id);
create index brand_operations_actor on public.brand_operations(actor_id);
create index brand_operations_brand_started on public.brand_operations(brand_asset_id,started_at desc);
create table public.brand_revisions (
 brand_asset_id uuid not null references public.property_brand_assets(id) on delete cascade,
 revision bigint not null,property_id uuid not null references public.properties(id) on delete cascade,
 snapshot jsonb not null,created_at timestamptz not null default now(),primary key(brand_asset_id,revision)
);
create index brand_revisions_property on public.brand_revisions(property_id,created_at desc);
alter table public.brand_operations enable row level security;
alter table public.brand_revisions enable row level security;
-- Operation inputs, claim tokens and content snapshots stay private. UI reads a reduced server DTO.
create policy brand_operations_service on public.brand_operations for all to service_role using (true) with check (true);
create policy brand_revisions_service on public.brand_revisions for all to service_role using (true) with check (true);
revoke all on public.brand_operations,public.brand_revisions from public,anon,authenticated;
grant all on public.brand_operations,public.brand_revisions to service_role;
create or replace function public.protect_brand_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' or pg_trigger_depth()=1 then raise exception 'Brand revision history is immutable';end if;
 return old;
end; $$;
create trigger brand_revision_immutable before update or delete on public.brand_revisions for each row execute function public.protect_brand_revision();
revoke all on function public.protect_brand_revision() from public,anon,authenticated;
grant execute on function public.protect_brand_revision() to service_role;
create or replace function public.snapshot_brand_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into public.brand_revisions(brand_asset_id,revision,property_id,snapshot) values(new.id,new.revision,new.property_id,to_jsonb(new)) on conflict do nothing;
 return new;
end; $$;
create trigger brand_revision_saved after insert or update on public.property_brand_assets for each row execute function public.snapshot_brand_revision();
insert into public.brand_revisions(brand_asset_id,revision,property_id,snapshot) select id,revision,property_id,to_jsonb(b) from public.property_brand_assets b;
-- Hosted and reconstructed baselines used different names for these policies.
-- Replace both known sets with the same scoped reads and service-only writes.
drop policy if exists "Users manage property brand assets in their org" on public.property_brand_assets;
drop policy if exists "Service role full access brand assets" on public.property_brand_assets;
drop policy if exists "Users view property brand assets in their org" on public.property_brand_assets;
drop policy if exists "Users manage their org brand assets" on public.property_brand_assets;
drop policy if exists "Service role full access to brand assets" on public.property_brand_assets;
drop policy if exists "Users view their org brand assets" on public.property_brand_assets;
create policy "Service role full access brand assets" on public.property_brand_assets for all to service_role using (true) with check (true);
create policy "Users view property brand assets in their org" on public.property_brand_assets for select to authenticated using (exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=property_brand_assets.property_id and u.id=(select auth.uid())));

revoke insert,update,delete on public.property_brand_assets from anon,authenticated;
create or replace function public.brand_action_summary(p_brand public.property_brand_assets) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('brandAssetId',p_brand.id,'revision',p_brand.revision,'step',p_brand.current_step,'draftVersion',p_brand.draft_section->'version','approvalStatus',p_brand.approval_status,'generationStatus',p_brand.generation_status,'hasExport',p_brand.brand_book_pdf_url is not null);
$$;
create or replace function public.begin_brand_operation(p_property_id uuid,p_brand_asset_id uuid,p_actor_id uuid,p_request_id uuid,p_revision bigint,p_kind text,p_input jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.property_brand_assets;o public.brand_operations;e jsonb;event_id uuid;
begin
 if p_request_id is null or p_actor_id is null or p_revision is null or p_revision<0 or p_kind not in ('brief','generate','regenerate','edit','approve','contract','import','export','revise','visuals','publish') or jsonb_typeof(p_input) is distinct from 'object' or length(p_input::text)>524288 then raise exception 'Invalid brand operation';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into o from public.brand_operations where id=p_request_id;
 if found then
  if (o.property_id,o.actor_id,o.kind,o.expected_revision,o.input) is distinct from (p_property_id,p_actor_id,p_kind,p_revision,p_input) or (p_brand_asset_id is not null and o.brand_asset_id<>p_brand_asset_id) then return '{"state":"request_conflict"}';end if;
  return case when o.state='succeeded' then o.result||jsonb_build_object('state','replayed') else jsonb_build_object('state',o.state,'requestId',o.id,'brandAssetId',o.brand_asset_id,'result',o.result) end;
 end if;
 select * into b from public.property_brand_assets where property_id=p_property_id for update;
 if not found then
  if p_revision<>0 or p_brand_asset_id is not null or p_kind not in ('brief','contract','import') then return '{"state":"not_found"}';end if;
  insert into public.property_brand_assets(property_id,generated_by,generation_status,current_step,current_step_name) values(p_property_id,p_actor_id,'draft',1,'introduction') returning * into b;
 elsif (p_brand_asset_id is not null and b.id<>p_brand_asset_id) or b.revision<>p_revision then return jsonb_build_object('state','stale','revision',b.revision);end if;
 if exists(select 1 from public.brand_operations where brand_asset_id=b.id and state='running') then return '{"state":"busy"}';end if;
 if p_kind in ('edit','approve','regenerate') and (jsonb_typeof(b.draft_section) is distinct from 'object' or b.current_step<>(b.draft_section->>'step')::int) then return '{"state":"no_draft"}';end if;
 if p_kind='brief' and b.generation_status not in ('draft','conversation') then return '{"state":"brief_closed"}';end if;
 if p_kind in ('revise','visuals') and b.draft_section is not null then return '{"state":"draft_exists"}';end if;
 if p_kind='generate' and (b.draft_section is not null or b.current_step not between 1 and 12 or b.approval_status='approved') then return '{"state":"draft_exists"}';end if;
 if p_kind in ('export','publish') and (b.approval_status<>'approved' or b.approved_by is null or b.approved_at is null or b.draft_section is not null) then return '{"state":"approval_required"}';end if;
 insert into public.brand_operations(id,property_id,brand_asset_id,actor_id,kind,expected_revision,input) values(p_request_id,p_property_id,b.id,p_actor_id,p_kind,b.revision,p_input) returning * into o;
 -- For a new asset, retain the caller's zero revision in the replay identity; the snapshot's revision fences completion.
 if p_revision=0 then update public.brand_operations set expected_revision=0 where id=o.id;end if;
 event_id:=gen_random_uuid();
 e:=public.append_shared_action_event(event_id,p_request_id,p_property_id,p_actor_id,'brandforge','brand.operation.requested','server_confirmed','succeeded',jsonb_build_object('brandAssetId',b.id,'kind',p_kind,'requestId',p_request_id,'revision',p_revision,'inputHash',encode(sha256(convert_to(p_input::text,'UTF8')),'hex')),public.brand_action_summary(b),public.brand_action_summary(b),jsonb_build_object('state','running','execution',case when p_kind in ('generate','regenerate','contract','brief','visuals') then 'delegated' else 'user' end));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Brand request could not be recorded';end if;
 return jsonb_build_object('state','claimed','claimToken',o.claim_token,'brandAssetId',b.id,'revision',b.revision);
end; $$;
create or replace function public.finish_brand_operation(p_request_id uuid,p_claim_token uuid,p_updates jsonb,p_result jsonb,p_error text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.brand_operations;b public.property_brand_assets;before_state jsonb;next_row public.property_brand_assets;r jsonb;e jsonb;action text;allowed text[];col text;names text[]:=array['introduction','positioning','target_audience','personas','name_story','logo','typography','colors','design_elements','photo_yep','photo_nope','implementation'];expected bigint;code text;imp public.property_brand_imports;asset_id uuid;doc jsonb;source_id uuid;
begin
 select * into o from public.brand_operations where id=p_request_id;
 if not found or p_claim_token is distinct from o.claim_token then return '{"state":"claim_conflict"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(o.property_id::text,12));
 select * into o from public.brand_operations where id=p_request_id for update;
 if o.state='succeeded' then return o.result||'{"state":"replayed"}'::jsonb;end if;
 if o.state<>'running' then return jsonb_build_object('state',o.state);end if;
 select * into b from public.property_brand_assets where id=o.brand_asset_id for update;
 if not found then return '{"state":"not_found"}';end if;
 before_state:=public.brand_action_summary(b);expected:=greatest(o.expected_revision,1);
 code:=p_error;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=o.property_id and u.id=o.actor_id) then code:='access_changed';
 elsif b.revision<>expected then code:='stale';end if;
 if p_error is not null and p_error not in ('generation_failed','save_failed','export_failed','invalid_result','dispatch_unknown') then raise exception 'Invalid failure code';end if;
 if code is null then
  if jsonb_typeof(p_updates) is distinct from 'object' or length(p_updates::text)>2097152 or jsonb_typeof(p_result) is distinct from 'object' or length(p_result::text)>2097152 then raise exception 'Invalid brand result';end if;
  allowed:=case o.kind
   when 'brief' then array['gemini_conversation_history','conversation_summary','competitive_analysis','generation_status','current_step','current_step_name']
   when 'edit' then array['draft_section','approval_status','approved_by','approved_at']
   when 'generate' then array['draft_section','generation_status','approval_status','contract_version','brand_origin','approved_by','approved_at']
   when 'regenerate' then array['draft_section','approval_status','approved_by','approved_at']
   when 'approve' then array['current_step','current_step_name','draft_section','contract_version','brand_origin','approval_status','contract_hash','generation_status','approved_by','approved_at','section_'||b.current_step||'_'||names[b.current_step]]
   when 'export' then array['brand_book_pdf_url','pdf_generated_at']
   when 'publish' then array[]::text[]
   else array['section_1_introduction','section_2_positioning','section_3_target_audience','section_4_personas','section_5_name_story','section_6_logo','section_7_typography','section_8_colors','section_9_design_elements','section_10_photo_yep','section_11_photo_nope','section_12_implementation','proposed_sections','generation_status','current_step','current_step_name','draft_section','contract_version','brand_origin','approval_status','approved_by','approved_at','contract_hash','competitive_analysis','source_manifest','conversation_summary'] end;
  if p_updates-allowed<>'{}' then raise exception 'Unexpected brand fields';end if;
  next_row:=jsonb_populate_record(b,p_updates);
  if o.kind in ('generate','regenerate','edit') then
   if jsonb_typeof(next_row.draft_section->'data') is distinct from 'object' or next_row.draft_section->>'step' is distinct from b.current_step::text or next_row.draft_section->>'name' is distinct from names[b.current_step]
    or (next_row.draft_section->>'version')::int is distinct from (case when o.kind='generate' then 1 else coalesce((b.draft_section->>'version')::int,1)+1 end) then raise exception 'Invalid section revision';end if;
   next_row.approval_status:='reviewing';next_row.approved_by:=null;next_row.approved_at:=null;
  elsif o.kind='approve' then
   col:='section_'||b.current_step||'_'||names[b.current_step];
   if b.draft_section->>'name' is distinct from names[b.current_step] or next_row.draft_section is not null or (to_jsonb(next_row)->col) is null or jsonb_typeof(to_jsonb(next_row)->col) is distinct from 'object' or next_row.current_step<>least(b.current_step+1,12) then raise exception 'Invalid section approval';end if;
   -- Approval is attributed here to the current decision, never supplied by the model.
   if b.current_step=12 then
    foreach col in array array['section_1_introduction','section_2_positioning','section_3_target_audience','section_4_personas','section_5_name_story','section_6_logo','section_7_typography','section_8_colors','section_9_design_elements','section_10_photo_yep','section_11_photo_nope','section_12_implementation'] loop
     if jsonb_typeof(to_jsonb(next_row)->col) is distinct from 'object' then raise exception 'Missing approved section';end if;
    end loop;
    next_row.approval_status:='approved';next_row.approved_by:=o.actor_id;next_row.approved_at:=clock_timestamp();next_row.generation_status:='complete';
   else next_row.approval_status:='reviewing';next_row.approved_by:=null;next_row.approved_at:=null;end if;
  elsif o.kind in ('revise','visuals') then
   if next_row.approval_status<>'reviewing' or next_row.approved_by is not null or next_row.approved_at is not null or jsonb_typeof(next_row.proposed_sections) is distinct from 'object' or next_row.draft_section->>'step' is distinct from next_row.current_step::text or next_row.draft_section->>'name' is distinct from names[next_row.current_step] then raise exception 'Brand revision requires review';end if;
  elsif o.kind='contract' then
   if next_row.approval_status<>'reviewing' or next_row.approved_by is not null or next_row.approved_at is not null or next_row.current_step<>1 or jsonb_typeof(next_row.proposed_sections) is distinct from 'object' or next_row.draft_section->>'step'<>'1' then raise exception 'Generated contract requires review';end if;
  elsif o.kind='import' then
   if not exists(select 1 from public.profiles where id=o.actor_id and role in ('admin','manager')) then raise exception 'Brand approval requires a manager';end if;
   select * into imp from public.property_brand_imports where id=(p_result->'importReceipt'->>'id')::uuid and property_id=o.property_id for update;
   if not found or imp.status<>'needs_review' or imp.updated_at is distinct from (p_result->'importReceipt'->>'updatedAt')::timestamptz then raise exception 'Import preview changed';end if;
   if jsonb_typeof(p_result->'importReceipt'->'assetIds') is distinct from 'array' then raise exception 'Missing asset references';end if;
   for asset_id in select value::uuid from jsonb_array_elements_text(p_result->'importReceipt'->'assetIds') loop
    perform 1 from public.content_assets where id=asset_id and property_id=o.property_id and approval_status='approved' and rights_status in ('owned','licensed','generated') and (expires_at is null or expires_at>clock_timestamp()) and duplicate_of is null for share;
    if not found then raise exception 'Brand asset is no longer approved';end if;
   end loop;
   update public.content_assets set curation_status='approved' where property_id=o.property_id and id in (select value::uuid from jsonb_array_elements_text(p_result->'importReceipt'->'assetIds'));
   update public.property_brand_imports set status='confirmed',extracted_contract=p_result->'contract',content_hash=p_result->>'contractHash',conflicts=p_result->'importReceipt'->'conflicts',confirmed_by=o.actor_id,confirmed_at=clock_timestamp() where id=imp.id;
   next_row.approved_by:=o.actor_id;next_row.approved_at:=clock_timestamp();next_row.approval_status:='approved';next_row.proposed_sections:=null;
  elsif o.kind='publish' then
   if b.approval_status<>'approved' or b.approved_by is null then raise exception 'Approval required for publication';end if;
   if jsonb_typeof(p_result->'knowledgeReceipt'->'documents') is distinct from 'array' or jsonb_array_length(p_result->'knowledgeReceipt'->'documents') not between 1 and 100 then raise exception 'Complete knowledge documents required';end if;
   for doc in select value from jsonb_array_elements(p_result->'knowledgeReceipt'->'documents') loop
    if jsonb_typeof(doc) is distinct from 'object' or nullif(trim(doc->>'content'),'') is null or length(doc->>'content')>200000 or jsonb_typeof(doc->'metadata') is distinct from 'object' or jsonb_typeof(doc->'embedding') is distinct from 'array' or jsonb_array_length(doc->'embedding')<>1536 or exists(select 1 from jsonb_array_elements(doc->'embedding') x where jsonb_typeof(x)<>'number') then raise exception 'Invalid knowledge document';end if;
   end loop;
   select id into source_id from public.knowledge_sources where property_id=o.property_id and source_type='brand_book' and extracted_data->>'brand_asset_id'=b.id::text order by created_at,id limit 1 for update;
   if source_id is null then
    insert into public.knowledge_sources(property_id,source_type,source_name,status,documents_created,extracted_data,last_synced_at) values(o.property_id,'brand_book',left(coalesce(p_result->'knowledgeReceipt'->>'sourceName','Brand book'),300),'completed',jsonb_array_length(p_result->'knowledgeReceipt'->'documents'),jsonb_build_object('brand_asset_id',b.id,'brand_revision',b.revision,'request_id',o.id),clock_timestamp()) returning id into source_id;
   else
    update public.knowledge_sources set source_name=left(coalesce(p_result->'knowledgeReceipt'->>'sourceName','Brand book'),300),status='completed',documents_created=jsonb_array_length(p_result->'knowledgeReceipt'->'documents'),extracted_data=jsonb_build_object('brand_asset_id',b.id,'brand_revision',b.revision,'request_id',o.id),last_synced_at=clock_timestamp(),error_message=null where id=source_id;
   end if;
   delete from public.documents where property_id=o.property_id and metadata->>'type'='brand_book';
   for doc in select value from jsonb_array_elements(p_result->'knowledgeReceipt'->'documents') loop
    insert into public.documents(id,property_id,content,metadata,embedding) values((doc->>'id')::uuid,o.property_id,doc->>'content',(doc->'metadata')||jsonb_build_object('type','brand_book','brand_asset_id',b.id,'brand_revision',b.revision,'source_id',source_id,'request_id',o.id,'embedded_at',clock_timestamp()),(doc->'embedding')::text::public.vector);
   end loop;
   update public.property_chatbot_contexts set status=case when requires_review then 'needs_review' else 'stale' end,last_change_summary='Approved brand knowledge changed; refresh the assistant context to use this version.',updated_at=clock_timestamp() where property_id=o.property_id;
  elsif o.kind='export' then
   if b.approval_status<>'approved' or b.approved_by is null or next_row.brand_book_pdf_url is null or next_row.pdf_generated_at is null then raise exception 'Approval required for export';end if;
  end if;
  update public.property_brand_assets set
   gemini_conversation_history=next_row.gemini_conversation_history,conversation_summary=next_row.conversation_summary,competitive_analysis=next_row.competitive_analysis,
   section_1_introduction=next_row.section_1_introduction,section_2_positioning=next_row.section_2_positioning,section_3_target_audience=next_row.section_3_target_audience,section_4_personas=next_row.section_4_personas,section_5_name_story=next_row.section_5_name_story,section_6_logo=next_row.section_6_logo,section_7_typography=next_row.section_7_typography,section_8_colors=next_row.section_8_colors,section_9_design_elements=next_row.section_9_design_elements,section_10_photo_yep=next_row.section_10_photo_yep,section_11_photo_nope=next_row.section_11_photo_nope,section_12_implementation=next_row.section_12_implementation,
   proposed_sections=next_row.proposed_sections,generation_status=next_row.generation_status,current_step=next_row.current_step,current_step_name=next_row.current_step_name,draft_section=next_row.draft_section,contract_version=next_row.contract_version,brand_origin=next_row.brand_origin,approval_status=next_row.approval_status,approved_by=next_row.approved_by,approved_at=next_row.approved_at,contract_hash=next_row.contract_hash,source_manifest=next_row.source_manifest,brand_book_pdf_url=next_row.brand_book_pdf_url,pdf_generated_at=next_row.pdf_generated_at where id=b.id returning * into b;
  r:=(p_result-array['importReceipt','knowledgeReceipt'])||jsonb_build_object('state','applied','success',true,'brandAssetId',b.id,'revision',b.revision);
  if source_id is not null then r:=r||jsonb_build_object('sourceId',source_id);end if;
 else r:=jsonb_build_object('state','failed','code',code,'brandAssetId',b.id,'revision',b.revision);end if;
 action:=case o.kind when 'brief' then 'brand.brief.saved' when 'generate' then 'brand.section.generated' when 'regenerate' then 'brand.section.regenerated' when 'edit' then 'brand.section.edited' when 'approve' then 'brand.section.approved' when 'publish' then 'brand.knowledge.published' when 'revise' then 'brand.revision.started' when 'visuals' then 'brand.visuals.generated' when 'contract' then 'brand.contract.generated' when 'import' then 'brand.contract.imported' else 'brand.export.created' end;
 -- An actor who has lost access cannot acquire another property-scoped action. The private operation still terminates.
 if code is distinct from 'access_changed' then
  e:=public.append_shared_action_event(o.id,o.id,o.property_id,o.actor_id,'brandforge',action,'server_confirmed',case when code is null then 'succeeded' else 'failed' end,jsonb_build_object('brandAssetId',b.id,'kind',o.kind,'requestId',o.id,'revision',o.expected_revision,'inputHash',encode(sha256(convert_to(o.input::text,'UTF8')),'hex')),before_state,public.brand_action_summary(b),jsonb_build_object('state',case when code is null then 'saved' else code end,'execution',case when o.kind in ('generate','regenerate','contract','brief','visuals') then 'delegated' else 'user' end,'resultHash',encode(sha256(convert_to(r::text,'UTF8')),'hex'))||case when source_id is not null then jsonb_build_object('sourceId',source_id,'publishedRevision',b.revision,'documentCount',jsonb_array_length(p_result->'knowledgeReceipt'->'documents'),'contextRefresh','pending') else '{}'::jsonb end);
  if e->>'state' not in ('recorded','replayed') then raise exception 'Brand result could not be recorded';end if;
 end if;
 update public.brand_operations set state=case when code is null then 'succeeded' else 'failed' end,result=r,finished_at=clock_timestamp() where id=o.id;
 return r;
end; $$;
create or replace function public.cancel_brand_operation(p_property_id uuid,p_request_id uuid,p_actor_id uuid,p_decision_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.brand_operations;e jsonb;
begin
 if p_decision_id is null then raise exception 'Decision ID required';end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text,12));
 select * into o from public.brand_operations where id=p_request_id and property_id=p_property_id for update;
 if not found then return '{"state":"not_found"}';end if;
 if o.state<>'running' then return jsonb_build_object('state',o.state);end if;
 e:=public.append_shared_action_event(p_decision_id,p_decision_id,p_property_id,p_actor_id,'brandforge','brand.operation.cancelled','server_confirmed','succeeded',jsonb_build_object('brandAssetId',o.brand_asset_id,'requestId',o.id,'kind',o.kind),jsonb_build_object('state','running'),jsonb_build_object('state','cancelled'),jsonb_build_object('state','saved','lateSavesBlocked',true));
 if e->>'state' not in ('recorded','replayed') then raise exception 'Brand cancellation could not be recorded';end if;
 update public.brand_operations set state='cancelled',finished_at=clock_timestamp(),result='{"state":"cancelled"}' where id=o.id;
 return '{"state":"cancelled"}';
end; $$;
create or replace function public.check_brand_operation(p_request_id uuid,p_claim_token uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare o public.brand_operations;b public.property_brand_assets;
begin
 select * into o from public.brand_operations where id=p_request_id;
 if not found or o.claim_token is distinct from p_claim_token then return '{"state":"claim_conflict"}';end if;
 if o.state<>'running' then return jsonb_build_object('state',o.state);end if;
 if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=o.property_id and u.id=o.actor_id) then return '{"state":"forbidden"}';end if;
 select * into b from public.property_brand_assets where id=o.brand_asset_id;
 if not found or b.revision<>greatest(o.expected_revision,1) then return '{"state":"stale"}';end if;
 return '{"state":"active"}';
end; $$;
revoke all on function public.check_brand_operation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_brand_operation(uuid,uuid) to service_role;
revoke all on function public.version_brand_asset(),public.snapshot_brand_revision(),public.brand_action_summary(public.property_brand_assets),public.begin_brand_operation(uuid,uuid,uuid,uuid,bigint,text,jsonb),public.finish_brand_operation(uuid,uuid,jsonb,jsonb,text),public.cancel_brand_operation(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.version_brand_asset(),public.snapshot_brand_revision(),public.brand_action_summary(public.property_brand_assets),public.begin_brand_operation(uuid,uuid,uuid,uuid,bigint,text,jsonb),public.finish_brand_operation(uuid,uuid,jsonb,jsonb,text),public.cancel_brand_operation(uuid,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
