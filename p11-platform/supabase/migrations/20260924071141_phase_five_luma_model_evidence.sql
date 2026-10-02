-- Private originals are separate from safe shared activity. No training eligibility.
create table public.luma_request_inputs(
 property_id uuid not null references public.properties(id)on delete cascade,request_id uuid not null,raw_input text not null,
 config_id uuid not null,key_hash text not null,config_source jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(property_id,request_id),foreign key(property_id,request_id)references public.luma_requests(property_id,request_id)on delete cascade
);
create table public.luma_request_results(
 property_id uuid not null references public.properties(id)on delete cascade,request_id uuid not null,response jsonb not null,http_status integer not null,
 created_at timestamptz not null default clock_timestamp(),primary key(property_id,request_id),foreign key(property_id,request_id)references public.luma_request_inputs(property_id,request_id)on delete cascade
);
create table public.luma_model_intents(
 id uuid primary key default gen_random_uuid(),property_id uuid not null references public.properties(id)on delete cascade,request_id uuid not null,purpose text not null check(purpose in('answer','extraction','summary')),
 params jsonb not null,source jsonb not null,reserved_units bigint not null,created_at timestamptz not null default clock_timestamp(),
 unique(property_id,request_id,purpose),foreign key(property_id,request_id)references public.luma_request_inputs(property_id,request_id)on delete cascade
);
create table public.luma_model_results(
 id uuid primary key references public.luma_model_intents(id)on delete cascade,property_id uuid not null references public.properties(id)on delete cascade,
 outcome text not null check(outcome in('received','unknown')),response jsonb,issue text,created_at timestamptz not null default clock_timestamp(),
 check((outcome='received'and response is not null and issue is null)or(outcome='unknown'and response is null and issue is not null))
);
create table public.luma_request_reviews(
 id uuid primary key,property_id uuid not null references public.properties(id)on delete cascade,request_id uuid not null,actor_id uuid not null,input jsonb not null,source jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(property_id,request_id)references public.luma_requests(property_id,request_id)on delete cascade
);
create index luma_request_inputs_history on public.luma_request_inputs(property_id,created_at desc,request_id);
create index luma_request_reviews_history on public.luma_request_reviews(property_id,created_at desc,id);
create function public.guard_luma_request_evidence()returns trigger language plpgsql security invoker set search_path=''as $$
begin
 if tg_op='DELETE'and not exists(select 1 from public.properties where id=old.property_id)then return old;end if;
 if tg_op<>'INSERT'then raise exception 'Luma request evidence is immutable';end if;
 if current_setting('p11.luma_request_scope',true)is distinct from new.property_id::text then raise exception 'Recorded request scope required';end if;return new;
end$$;
do $$declare t text;begin foreach t in array array['luma_request_inputs','luma_request_results','luma_model_intents','luma_model_results','luma_request_reviews']loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger recorded_luma_request_evidence before insert or update or delete on public.%I for each row execute function public.guard_luma_request_evidence()',t);
end loop;end$$;
create function public.record_luma_request_service(p_property_id uuid,p_request_id uuid,p_kind text,p_ref uuid default null)returns void language plpgsql security invoker set search_path=''as $$
declare event_id uuid:=gen_random_uuid();organization uuid;
begin
 select org_id into organization from public.properties where id=p_property_id;
 if organization is null or p_kind not in('accepted','response_retained','model_started','model_received','model_unknown')then raise exception 'Invalid request service event';end if;
 insert into public.shared_action_episodes(id,org_id,property_id,service_principal,origin)values(event_id,organization,p_property_id,'lumaleasing.request_service','workflow');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,service_principal,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,'lumaleasing.request_service','lumaleasing','luma.request.'||p_kind,'server_confirmed','succeeded',jsonb_build_object('requestId',p_request_id),jsonb_build_object('evidenceId',p_ref));
end$$;
create function public.luma_request_authority(p_property_id uuid,p_request_id uuid,p_token uuid)returns boolean language plpgsql stable security invoker set search_path=''as $$
declare original public.luma_request_inputs;request public.luma_requests;session_id uuid;session_data jsonb;observed timestamptz;
begin
 select*into request from public.luma_requests where property_id=p_property_id and request_id=p_request_id;
 if not found or request.state<>'running'or request.lease_token is distinct from p_token or request.expires_at<=now()then return false;end if;
 select*into original from public.luma_request_inputs where property_id=p_property_id and request_id=p_request_id;
 if not found or not exists(select 1 from public.lumaleasing_config c where c.id=original.config_id and c.property_id=p_property_id and c.is_active and encode(sha256(convert_to(c.api_key,'UTF8')),'hex')=original.key_hash and(to_jsonb(c)-'api_key')=original.config_source)then return false;end if;
 session_id:=nullif(original.raw_input::jsonb->>'sessionId','')::uuid;
 if session_id is not null then
  select to_jsonb(s)into session_data from public.widget_sessions s where s.id=session_id and s.property_id=p_property_id;
  observed:=coalesce(session_data->>'last_activity_at',session_data->>'started_at',session_data->>'session_start',session_data->>'created_at')::timestamptz;
  if observed is null or observed<=now()-interval'48 hours'or observed>now()+interval'5 minutes'then return false;end if;
 end if;return true;
end$$;
create function public.claim_recorded_luma_request(p_property_id uuid,p_request_id uuid,p_operation text,p_raw_input text,p_actor text,p_key_hash text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare config public.lumaleasing_config;claimed jsonb;
begin
 if p_raw_input is null or octet_length(p_raw_input)>24000 or jsonb_typeof(p_raw_input::jsonb)is distinct from'object'then return'{"state":"invalid_input"}';end if;
 select*into config from public.lumaleasing_config c where c.property_id=p_property_id and c.is_active and encode(sha256(convert_to(c.api_key,'UTF8')),'hex')=p_key_hash;
 if not found then return'{"state":"forbidden"}';end if;
 claimed:=public.claim_luma_request(p_property_id,p_request_id,p_operation,encode(sha256(convert_to(p_raw_input,'UTF8')),'hex'),p_actor);
 if claimed->>'state'='claimed'then
  perform set_config('p11.luma_request_scope',p_property_id::text,true);
  insert into public.luma_request_inputs(property_id,request_id,raw_input,config_id,key_hash,config_source)values(p_property_id,p_request_id,p_raw_input,config.id,p_key_hash,to_jsonb(config)-'api_key');
  perform public.record_luma_request_service(p_property_id,p_request_id,'accepted');
 end if;return claimed;
end$$;
create function public.finish_recorded_luma_request(p_property_id uuid,p_request_id uuid,p_token uuid,p_response jsonb,p_status integer)returns boolean language plpgsql security invoker set search_path=''as $$
declare prior public.luma_request_results;request public.luma_requests;
begin
 select*into request from public.luma_requests where property_id=p_property_id and request_id=p_request_id for update;
 if not found or request.lease_token is distinct from p_token or not exists(select 1 from public.luma_request_inputs where property_id=p_property_id and request_id=p_request_id)then return false;end if;
 if p_response is null or octet_length(p_response::text)>262144 or p_status is null or p_status<200 or p_status>599 then raise exception 'Invalid request response';end if;
 select*into prior from public.luma_request_results where property_id=p_property_id and request_id=p_request_id;
 if found then
  if prior.response<>p_response or prior.http_status<>p_status then raise exception 'Original response conflict';end if;
  return request.state='completed';
 end if;
 perform set_config('p11.luma_request_scope',p_property_id::text,true);
 insert into public.luma_request_results(property_id,request_id,response,http_status)values(p_property_id,p_request_id,p_response,p_status);
 perform public.record_luma_request_service(p_property_id,p_request_id,'response_retained');
 if not public.luma_request_authority(p_property_id,p_request_id,p_token)then
  update public.luma_requests set state='review'where property_id=p_property_id and request_id=p_request_id and state='running';return false;
 end if;
 return public.finish_luma_request(p_property_id,p_request_id,p_token,p_response,p_status);
end$$;
create function public.claim_luma_model(p_property_id uuid,p_request_id uuid,p_token uuid,p_purpose text,p_params jsonb,p_source jsonb,p_units bigint,p_limit bigint)returns jsonb language plpgsql security invoker set search_path=''as $$
declare intent public.luma_model_intents;receipt public.luma_model_results;convo public.conversations;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_property_id::text||p_request_id::text,7));
 if not public.luma_request_authority(p_property_id,p_request_id,p_token)then return'{"state":"authority_changed"}';end if;
 if p_purpose is null or p_purpose not in('answer','extraction','summary')or jsonb_typeof(p_params)is distinct from'object'or jsonb_typeof(p_source)is distinct from'object'or octet_length(p_params::text)>262144 or octet_length(p_source::text)>262144 or p_units is null or p_limit is null or p_units<1 or p_limit<1 then return'{"state":"invalid_input"}';end if;
 select*into convo from public.conversations where id=(p_source->>'conversationId')::uuid and property_id=p_property_id;
 if not found or convo.is_human_mode or convo.mode_revision is distinct from(p_source->>'modeRevision')::bigint then return'{"state":"authority_changed"}';end if;
 select*into intent from public.luma_model_intents where property_id=p_property_id and request_id=p_request_id and purpose=p_purpose;
 if found then
  if intent.params<>p_params or intent.source<>p_source then return'{"state":"request_conflict"}';end if;
  select*into receipt from public.luma_model_results where id=intent.id;
  if found and receipt.outcome='received'then return jsonb_build_object('state','received','id',intent.id,'response',receipt.response);end if;
  return jsonb_build_object('state','unknown','id',intent.id);
 end if;
 if not public.reserve_luma_allowance(p_property_id,'ai:'||to_char(now()at time zone'UTC','YYYY-MM-DD'),p_units,p_limit,now()+interval'2 days')then return'{"state":"limited"}';end if;
 perform set_config('p11.luma_request_scope',p_property_id::text,true);
 insert into public.luma_model_intents(property_id,request_id,purpose,params,source,reserved_units)values(p_property_id,p_request_id,p_purpose,p_params,p_source,p_units)returning*into intent;
 perform public.record_luma_request_service(p_property_id,p_request_id,'model_started',intent.id);
 return jsonb_build_object('state','claimed','id',intent.id);
end$$;
create function public.finish_luma_model(p_id uuid,p_property_id uuid,p_request_id uuid,p_token uuid,p_outcome text,p_response jsonb,p_issue text)returns jsonb language plpgsql security invoker set search_path=''as $$
declare intent public.luma_model_intents;receipt public.luma_model_results;usable boolean;
begin
 select*into intent from public.luma_model_intents where id=p_id and property_id=p_property_id and request_id=p_request_id for update;
 if not found or not exists(select 1 from public.luma_requests where property_id=p_property_id and request_id=p_request_id and lease_token=p_token)then return'{"state":"not_found"}';end if;
 if p_outcome is null or p_outcome not in('received','unknown')or(p_outcome='received'and(p_response is null or p_issue is not null))or(p_outcome='unknown'and(p_response is not null or (p_issue is null or p_issue not in('provider_error','provider_timeout','invalid_response'))))or octet_length(p_response::text)>524288 then return'{"state":"invalid_input"}';end if;
 select*into receipt from public.luma_model_results where id=p_id;
 if found then
  if receipt.outcome<>p_outcome or receipt.response is distinct from p_response or receipt.issue is distinct from p_issue then return'{"state":"request_conflict"}';end if;
 else
  perform set_config('p11.luma_request_scope',p_property_id::text,true);
  insert into public.luma_model_results(id,property_id,outcome,response,issue)values(p_id,p_property_id,p_outcome,p_response,p_issue);
  perform public.record_luma_request_service(p_property_id,p_request_id,case when p_outcome='received'then'model_received'else'model_unknown'end,p_id);
 end if;
 usable:=p_outcome='received'and public.luma_request_authority(p_property_id,p_request_id,p_token)and exists(select 1 from public.conversations c where c.id=(intent.source->>'conversationId')::uuid and c.property_id=p_property_id and not c.is_human_mode and c.mode_revision=(intent.source->>'modeRevision')::bigint);
 return jsonb_build_object('state','saved','usable',usable,'id',p_id);
end$$;
create function public.luma_request_source(p_property_id uuid,p_request_id uuid)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('request',to_jsonb(r)-'lease_token'-'input_hash','original',to_jsonb(i)-'key_hash','response',to_jsonb(o),'models',coalesce((select jsonb_agg(jsonb_build_object('intent',to_jsonb(m),'receipt',to_jsonb(z))order by m.created_at,m.id)from public.luma_model_intents m left join public.luma_model_results z on z.id=m.id where m.property_id=r.property_id and m.request_id=r.request_id),'[]'))from public.luma_requests r left join public.luma_request_inputs i on i.property_id=r.property_id and i.request_id=r.request_id left join public.luma_request_results o on o.property_id=r.property_id and o.request_id=r.request_id where r.property_id=p_property_id and r.request_id=p_request_id;
$$;
create function public.read_luma_request_evidence(p_actor_id uuid,p_property_id uuid,p_request_id uuid default null,p_offset integer default 0,p_hash text default null,p_review_id uuid default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare source jsonb;all_items jsonb;items jsonb;hash text;actor_role text;saved_review public.luma_request_reviews;
begin
 select u.role into actor_role from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id;
 if actor_role is null then return'{"state":"forbidden"}';end if;
 if p_review_id is not null then
  select*into saved_review from public.luma_request_reviews where id=p_review_id and property_id=p_property_id and actor_id=p_actor_id;
  if not found then return'{"state":"not_found"}';end if;return saved_review.result;
 end if;
 if p_offset<0 or p_offset>100000 then return'{"state":"invalid_input"}';end if;
 if p_request_id is not null then
  source:=public.luma_request_source(p_property_id,p_request_id);if source is null then return'{"state":"not_found"}';end if;
  select coalesce(jsonb_agg(to_jsonb(r)order by r.created_at desc,r.id desc),'[]')into all_items from public.luma_request_reviews r where property_id=p_property_id and request_id=p_request_id;
 else
  select coalesce(jsonb_agg(jsonb_build_object('id',r.request_id,'operation',r.operation,'state',case when r.state='running'and r.expires_at<=now()then'review'else r.state end,'createdAt',r.created_at,'originalRetained',i.request_id is not null,'responseRetained',o.request_id is not null)order by r.created_at desc,r.request_id desc),'[]')into all_items from public.luma_requests r left join public.luma_request_inputs i on i.property_id=r.property_id and i.request_id=r.request_id left join public.luma_request_results o on o.property_id=r.property_id and o.request_id=r.request_id where r.property_id=p_property_id;
 end if;
 hash:=encode(sha256(convert_to(coalesce(source,'{}')::text||all_items::text,'UTF8')),'hex');if p_hash is not null and p_hash<>hash then return'{"state":"source_changed"}';end if;
 select coalesce(jsonb_agg(value order by ordinal),'[]')into items from jsonb_array_elements(all_items)with ordinality t(value,ordinal)where ordinal>p_offset and ordinal<=p_offset+20;
 return jsonb_build_object('state','ready','propertyId',p_property_id,'actorId',p_actor_id,'canReview',actor_role in('admin','owner','manager'),'source',source,'sourceHash',case when source is not null then encode(sha256(convert_to(source::text,'UTF8')),'hex')else null end,'hash',hash,'items',items,'total',jsonb_array_length(all_items),'offset',p_offset,'complete',true);
end$$;
create function public.review_luma_request(p_id uuid,p_actor_id uuid,p_property_id uuid,p_request_id uuid,p_input jsonb)returns jsonb language plpgsql security invoker set search_path=''as $$
declare organization uuid;saved public.luma_request_reviews;source jsonb;receipt public.luma_request_results;original public.luma_request_inputs;result jsonb;event_id uuid:=gen_random_uuid();op text:=p_input->>'operation';
begin
 select p.org_id into organization from public.properties p join public.profiles u on u.org_id=p.org_id where p.id=p_property_id and u.id=p_actor_id and u.role in('admin','owner','manager');if organization is null then return'{"state":"forbidden"}';end if;
 if p_id is null or jsonb_typeof(p_input)is distinct from'object'or op is null or op not in('retain_hold','release_saved_response','cancel')or p_input-array['operation','sourceHash','reason']<>'{}'or(op<>'cancel'and coalesce(length(btrim(p_input->>'reason')),0)not between 3 and 2000) then return'{"state":"invalid_input"}';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,996));select*into saved from public.luma_request_reviews where id=p_id;
 if found then if saved.property_id<>p_property_id or saved.actor_id<>p_actor_id or saved.request_id<>p_request_id then return'{"state":"not_found"}';end if;if saved.input->>'operation'='cancel'or op='cancel'then return saved.result;end if;if saved.input<>p_input then return'{"state":"request_conflict"}';end if;return saved.result;end if;
 perform 1 from public.luma_requests where property_id=p_property_id and request_id=p_request_id for update;
 source:=public.luma_request_source(p_property_id,p_request_id);if source is null then return'{"state":"not_found"}';end if;
 if op<>'cancel'and encode(sha256(convert_to(source::text,'UTF8')),'hex')is distinct from p_input->>'sourceHash'then return'{"state":"source_changed"}';end if;
 if op='release_saved_response'then
  select*into receipt from public.luma_request_results where property_id=p_property_id and request_id=p_request_id;
  if not found or receipt.http_status>=500 then return'{"state":"no_releasable_response"}';end if;
  select*into original from public.luma_request_inputs where property_id=p_property_id and request_id=p_request_id;
  if not exists(select 1 from public.lumaleasing_config c where c.id=original.config_id and c.property_id=p_property_id and c.is_active and encode(sha256(convert_to(c.api_key,'UTF8')),'hex')=original.key_hash and to_jsonb(c)-'api_key'=original.config_source)then return'{"state":"authority_changed"}';end if;
  if source->'request'->>'state'='completed'or(source->'request'->>'state'='running'and(source->'request'->>'expires_at')::timestamptz>now())then return'{"state":"review_required"}';end if;
  update public.luma_requests set state='completed',response=receipt.response,http_status=receipt.http_status where property_id=p_property_id and request_id=p_request_id;
 end if;
 perform set_config('p11.luma_request_scope',p_property_id::text,true);
 result:=jsonb_build_object('state','saved','id',p_id,'propertyId',p_property_id,'actorId',p_actor_id,'requestId',p_request_id,'operation',op);
 insert into public.luma_request_reviews(id,property_id,request_id,actor_id,input,source,result)values(p_id,p_property_id,p_request_id,p_actor_id,p_input,source,result);
 insert into public.shared_action_episodes(id,org_id,property_id,actor_id,origin)values(event_id,organization,p_property_id,p_actor_id,'console');
 insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,product,action,evidence,phase,request,result)values(event_id,event_id,organization,p_property_id,p_actor_id,'lumaleasing','luma.request.'||op,'server_confirmed','succeeded',jsonb_build_object('requestId',p_request_id),jsonb_build_object('reviewId',p_id));
 return result;
end$$;

revoke all on function public.guard_luma_request_evidence(),public.record_luma_request_service(uuid,uuid,text,uuid),public.luma_request_authority(uuid,uuid,uuid),public.claim_recorded_luma_request(uuid,uuid,text,text,text,text),public.finish_recorded_luma_request(uuid,uuid,uuid,jsonb,integer),public.claim_luma_model(uuid,uuid,uuid,text,jsonb,jsonb,bigint,bigint),public.finish_luma_model(uuid,uuid,uuid,uuid,text,jsonb,text),public.luma_request_source(uuid,uuid),public.read_luma_request_evidence(uuid,uuid,uuid,integer,text,uuid),public.review_luma_request(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_luma_request_service(uuid,uuid,text,uuid),public.luma_request_authority(uuid,uuid,uuid),public.claim_recorded_luma_request(uuid,uuid,text,text,text,text),public.finish_recorded_luma_request(uuid,uuid,uuid,jsonb,integer),public.claim_luma_model(uuid,uuid,uuid,text,jsonb,jsonb,bigint,bigint),public.finish_luma_model(uuid,uuid,uuid,uuid,text,jsonb,text),public.luma_request_source(uuid,uuid),public.read_luma_request_evidence(uuid,uuid,uuid,integer,text,uuid),public.review_luma_request(uuid,uuid,uuid,uuid,jsonb) to service_role;
