begin;
alter table public.siteforge_package_jobs add column brain_context_id uuid references public.shared_context_snapshots(id);
alter table public.siteforge_package_jobs add column community_deliverable_id uuid references public.community_generation_briefs(id);
-- Native jobs retain their existing state machines. A separate, immutable binding
-- makes the shared source contract enforceable at dispatch and release.
create table public.community_generation_bindings(
 id uuid primary key default gen_random_uuid(), property_id uuid not null, org_id uuid not null,
 actor_id uuid not null references auth.users(id), context_id uuid not null,
 package_job_id uuid unique references public.siteforge_package_jobs(id),
 social_generation_id uuid unique references public.forgestudio_generations(id),
 shared_job_id uuid unique references public.shared_jobs(id),
 deliverable_id uuid references public.community_generation_briefs(id),
 created_at timestamptz not null default clock_timestamp(),
 check(num_nonnulls(package_job_id,social_generation_id,shared_job_id)=1),
 foreign key(context_id,property_id,org_id) references public.shared_context_snapshots(id,property_id,org_id),
 foreign key(deliverable_id,property_id) references public.community_generation_briefs(id,property_id)
);
alter table public.community_generation_bindings enable row level security;
revoke all on public.community_generation_bindings from public,anon,authenticated;
grant select on public.community_generation_bindings to service_role;

create function public.brain_bind_generation(p_scope_id uuid,p_context_id uuid,p_kind text,p_id uuid,p_deliverable_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;c public.shared_context_snapshots;j jsonb;b public.community_generation_bindings;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 select *into c from public.shared_context_snapshots where id=p_context_id;
 if s.kind is distinct from 'community' or c.property_id is distinct from s.property_ids[1] or c.org_id is distinct from s.org_id
 or c.captured_by is distinct from s.actor_id::text or c.context_payload->>'purpose' is distinct from s.purpose
 or not public.brain_scope_current(s.id,c.property_id) or not public.brain_context_current(c.id,s.actor_id) then raise insufficient_privilege;end if;
 if p_kind='site_package' then
  select to_jsonb(x)into j from public.siteforge_package_jobs x where x.id=p_id;
  if s.purpose<>'site' then raise insufficient_privilege;end if;
 elsif p_kind='social' then
  select to_jsonb(x)into j from public.forgestudio_generations x where x.id=p_id;
  if s.purpose<>'social' then raise insufficient_privilege;end if;
 elsif p_kind='shared' then select to_jsonb(x)into j from public.shared_jobs x where x.id=p_id;
 else raise exception 'Unsupported native generation';end if;
 if j is null or j->>'property_id' is distinct from c.property_id::text or j->>'org_id' is distinct from c.org_id::text
 or (p_kind<>'shared' and j->>'actor_id' is distinct from s.actor_id::text) then raise insufficient_privilege;end if;
 if p_deliverable_id is not null and not exists(select 1 from public.community_generation_briefs d join public.community_service_packages k on k.id=d.package_id
  where d.id=p_deliverable_id and d.property_id=c.property_id and d.context_id=c.id and d.actor_id=s.actor_id and d.purpose=s.purpose and k.state='approved'
  and not exists(select 1 from public.community_service_packages n where n.initiative_id=k.initiative_id and n.version>k.version))then raise insufficient_privilege;end if;
 insert into public.community_generation_bindings(property_id,org_id,actor_id,context_id,package_job_id,social_generation_id,shared_job_id,deliverable_id)
 values(c.property_id,c.org_id,s.actor_id,c.id,case when p_kind='site_package'then p_id end,case when p_kind='social'then p_id end,case when p_kind='shared'then p_id end,p_deliverable_id)
 on conflict do nothing;
 select *into b from public.community_generation_bindings where (p_kind='site_package'and package_job_id=p_id)or(p_kind='social'and social_generation_id=p_id)or(p_kind='shared'and shared_job_id=p_id);
 if b.context_id is distinct from c.id or b.actor_id is distinct from s.actor_id or b.deliverable_id is distinct from p_deliverable_id then raise exception 'Generation context identity conflict';end if;
 return to_jsonb(b);end$$;

create function public.brain_generation_current(p_kind text,p_id uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
declare b public.community_generation_bindings;begin
 select *into b from public.community_generation_bindings where(p_kind='site_package'and package_job_id=p_id)or(p_kind='social'and social_generation_id=p_id)or(p_kind='shared'and shared_job_id=p_id);
 if not found or not public.brain_context_current(b.context_id,b.actor_id)then return false;end if;
 if b.deliverable_id is not null and not exists(select 1 from public.community_generation_briefs d join public.community_service_packages k on k.id=d.package_id where d.id=b.deliverable_id and k.state='approved'and not exists(select 1 from public.community_service_packages n where n.initiative_id=k.initiative_id and n.version>k.version))then return false;end if;
 return true;end$$;

create function public.brain_guard_native_generation()returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;begin
 kind:=case when tg_table_name='siteforge_package_jobs'then'site_package'else'social'end;
 if new.state is distinct from old.state and new.state in('starting','generating','packaging','ready','completed')
 and not(tg_table_name='forgestudio_generations'and new.state='ready') and not public.brain_generation_current(kind,new.id)
 then raise exception 'Generation sources or authority changed; refresh and review before continuing';end if;
 return new;end$$;
create trigger brain_generation_dispatch before update on public.siteforge_package_jobs for each row execute function public.brain_guard_native_generation();
create trigger brain_generation_dispatch before update on public.forgestudio_generations for each row execute function public.brain_guard_native_generation();
create function public.brain_bind_native_context()returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;sid uuid;c public.shared_context_snapshots;did uuid;begin
 if tg_table_name='siteforge_package_jobs'then cid:=new.brain_context_id;did:=new.community_deliverable_id;
 else cid:=(new.model_input#>>'{bundle,communityContext,snapshotId}')::uuid;did:=(new.model_input#>>'{servicePackage,id}')::uuid;end if;
 select *into c from public.shared_context_snapshots where id=cid;sid:=(c.context_payload->>'scopeId')::uuid;
 if cid is null then raise exception 'A current common context is required';end if;
 if tg_table_name='siteforge_package_jobs'then if c.context_payload->>'readSetHash' is distinct from new.source_snapshot#>>'{communityBrain,readSetHash}'then raise exception 'Source manifest changed';end if;end if;
 perform public.brain_bind_generation(sid,cid,case when tg_table_name='siteforge_package_jobs'then'site_package'else'social'end,new.id,did);
 return new;end$$;
create trigger brain_package_binding after insert on public.siteforge_package_jobs for each row execute function public.brain_bind_native_context();
create trigger brain_social_binding after update of model_input on public.forgestudio_generations for each row when(old.model_input is null and new.model_input is not null)execute function public.brain_bind_native_context();
create function public.brain_guard_package_release()returns trigger language plpgsql security definer set search_path='' as $$begin
 if (tg_op='INSERT'or new.state='succeeded')and not public.brain_generation_current('site_package',new.job_id)then raise exception 'Website sources changed; generate a current candidate';end if;return new;end$$;
create trigger brain_package_release before insert or update on public.siteforge_package_releases for each row execute function public.brain_guard_package_release();

-- Renew task authority without widening provider ancestry to another job, actor,
-- community, or portfolio conversation. Short request TTLs do not orphan long jobs.
create function public.brain_provider_compatible(p_scope_id uuid,p_id uuid,p_context_id uuid,p_session_id uuid)returns boolean language plpgsql stable security definer set search_path='' as $$
declare s public.community_task_scopes;o public.community_provider_objects;prior public.community_task_scopes;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into o from public.community_provider_objects where id=p_id;
 select *into prior from public.community_task_scopes where id=o.scope_id;
 if s.id is null or o.id is null or prior.actor_id is distinct from s.actor_id or prior.org_id is distinct from s.org_id or prior.kind is distinct from s.kind
 or prior.property_ids is distinct from s.property_ids or prior.purpose is distinct from s.purpose or prior.permission_hash is distinct from s.permission_hash
 or o.state<>'retained'or o.expires_at<=statement_timestamp()or not public.brain_scope_current(s.id,s.property_ids[1])then return false;end if;
 if s.kind='community'then return o.property_id=s.property_ids[1]and o.context_id=p_context_id and public.brain_context_current(p_context_id,s.actor_id);end if;
 return o.portfolio_session_id=p_session_id and exists(select 1 from public.community_portfolio_sessions v where v.id=p_session_id and v.actor_id=s.actor_id and v.permission_hash=s.permission_hash and v.property_ids=s.property_ids and v.expires_at>statement_timestamp());end$$;
create or replace function public.brain_provider_record(p_scope_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.community_task_scopes;r public.community_provider_objects;pid uuid;parents uuid[];cid uuid;sid uuid;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 pid:=case when s.kind='community'then s.property_ids[1]end;cid:=(p_input->>'contextId')::uuid;sid:=(p_input->>'sessionId')::uuid;
 if (s.kind='community'and(cid is null or not exists(select 1 from public.shared_context_snapshots where id=cid and property_id=pid and org_id=s.org_id and captured_by=s.actor_id::text and context_payload->>'purpose'=s.purpose)or not public.brain_context_current(cid,s.actor_id)))then raise insufficient_privilege;end if;
 if s.kind='portfolio'then perform public.brain_portfolio_session(s.id,sid);end if;
 parents:=array(select jsonb_array_elements_text(coalesce(p_input->'parents','[]')))::uuid[];
 if cardinality(parents)>20 or exists(select 1 from unnest(parents)x where not public.brain_provider_compatible(s.id,x,cid,sid))then raise insufficient_privilege using message='Provider ancestry does not belong to this task';end if;
 if p_input->>'provider'<>'openai' or length(p_input->>'project')not between 1 and 200 or length(p_input->>'objectId')not between 1 and 200
 or (p_input->>'expiresAt')::timestamptz not between clock_timestamp()and clock_timestamp()+interval '31 days' then raise exception 'Invalid provider retention contract';end if;
 insert into public.community_provider_objects(scope_id,property_id,portfolio_session_id,provider,project_ref,object_kind,object_id,parents,context_id,policy_revision,expires_at)
 values(s.id,pid,sid,p_input->>'provider',p_input->>'project',p_input->>'kind',p_input->>'objectId',parents,cid,p_input->>'policyRevision',(p_input->>'expiresAt')::timestamptz)
 on conflict(provider,project_ref,object_kind,object_id)do nothing returning *into r;
 if r.id is null then select *into r from public.community_provider_objects where provider=p_input->>'provider'and project_ref=p_input->>'project'and object_kind=p_input->>'kind'and object_id=p_input->>'objectId';
 if not public.brain_provider_compatible(s.id,r.id,cid,sid)or r.parents is distinct from parents then raise insufficient_privilege;end if;end if;
 return to_jsonb(r);end$$;
create or replace function public.brain_provider_read(p_scope_id uuid,p_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.community_provider_objects;begin select *into r from public.community_provider_objects where id=p_id;
 if not public.brain_provider_compatible(p_scope_id,p_id,r.context_id,r.portfolio_session_id)then raise insufficient_privilege;end if;return to_jsonb(r);end$$;
create function public.brain_provider_lookup(p_scope_id uuid,p_project text,p_kind text,p_object_id text,p_context_id uuid default null,p_session_id uuid default null)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.community_provider_objects;begin
 select *into r from public.community_provider_objects where provider='openai'and project_ref=p_project and object_kind=p_kind and object_id=p_object_id;
 if not public.brain_provider_compatible(p_scope_id,r.id,p_context_id,p_session_id)then raise insufficient_privilege;end if;return to_jsonb(r);end$$;
create function public.brain_provider_cleanup(p_id uuid default null,p_confirmed boolean default false)returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_id is not null then update public.community_provider_objects set state=case when p_confirmed then'deleted'else'deletion_unconfirmed'end,last_checked_at=clock_timestamp(),deleted_at=case when p_confirmed then clock_timestamp()end where id=p_id and state in('delete_requested','deletion_unconfirmed','expired_unconfirmed');return jsonb_build_object('recorded',found);end if;
 return(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(
  select *from public.community_provider_objects where state<>'deleted'and(expires_at<=clock_timestamp()or state='delete_requested')and(last_checked_at is null or last_checked_at<clock_timestamp()-interval '1 hour')order by expires_at,id limit 50 for update skip locked)q);end$$;
create function public.brain_request_provider_cleanup(p_context_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$begin
 update public.community_provider_objects set state='delete_requested'where context_id=p_context_id and state='retained';return jsonb_build_object('requested',found);end$$;

-- Creation's native transaction invokes managed writers before returning. Grant
-- its verified creator before those writers execute; no arbitrary profile metadata.
create function public.brain_grant_property_creator()returns trigger language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.profiles p where p.id=new.actor_id and p.org_id=new.org_id and p.role in('admin','manager'))then raise insufficient_privilege;end if;
 insert into public.community_access_grants(actor_id,property_id,capabilities,granted_by)
 values(new.actor_id,new.property_id,array['read','manage','generate','portfolio','download'],new.actor_id)on conflict(actor_id,property_id)do nothing;
 insert into public.community_access_events(actor_id,property_id,target_actor_id,after_state,reason)values(new.actor_id,new.property_id,new.actor_id,jsonb_build_object('capabilities',array['read','manage','generate','portfolio','download']),'Native property creation');
 return new;end$$;
create trigger brain_property_creator after insert on public.property_creation_requests for each row execute function public.brain_grant_property_creator();

-- Packages and deliverable requirements are immutable versions. Withdraw a
-- version explicitly; changing its brief requires a new row.
create function public.brain_package_immutable()returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE'or(to_jsonb(new)-'state')is distinct from(to_jsonb(old)-'state')or(old.state='withdrawn'and new.state<>'withdrawn')then raise exception 'Service packages are immutable versions';end if;return new;end$$;
create trigger brain_package_immutable before update or delete on public.community_service_packages for each row execute function public.brain_package_immutable();
create function public.brain_read_coordination(p_scope_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$declare s public.community_task_scopes;begin
 select *into s from public.community_task_scopes where id=p_scope_id;
 if s.kind is distinct from'community'or not public.brain_scope_current(s.id,s.property_ids[1])then raise insufficient_privilege;end if;
 return jsonb_build_object('initiatives',(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select *from public.community_initiatives where property_id=s.property_ids[1]order by created_at desc limit 100)q),
 'packages',(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select *from public.community_service_packages where property_id=s.property_ids[1]order by created_at desc limit 100)q),
 'deliverables',(select coalesce(jsonb_agg(to_jsonb(q)),'[]')from(select *from public.community_generation_briefs where property_id=s.property_ids[1]order by created_at desc limit 100)q));end$$;
create function public.brain_read_deliverable(p_scope_id uuid,p_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.community_task_scopes;d public.community_generation_briefs;k public.community_service_packages;c public.shared_context_snapshots;begin
 select *into s from public.community_task_scopes where id=p_scope_id;select *into d from public.community_generation_briefs where id=p_id;
 if s.kind is distinct from'community'or d.property_id is distinct from s.property_ids[1]or d.actor_id is distinct from s.actor_id or d.purpose is distinct from s.purpose or not public.brain_scope_current(s.id,d.property_id)or not public.brain_context_current(d.context_id,s.actor_id)then raise insufficient_privilege;end if;
 select *into k from public.community_service_packages where id=d.package_id and state='approved';
 if k.id is null or exists(select 1 from public.community_service_packages where initiative_id=k.initiative_id and version>k.version)then raise exception 'Service package changed';end if;
 select *into c from public.shared_context_snapshots where id=d.context_id;
 return jsonb_build_object('id',d.id,'packageId',k.id,'packageVersion',k.version,'initiativeId',k.initiative_id,'brief',k.brief,'deliverable',d.requirements,'outputContract',d.output_contract,'reviewCriteria',d.review_criteria,'context',c.context_payload||jsonb_build_object('snapshotId',c.id),'mediaSpendAuthorized',false);end$$;

do $$declare f regprocedure;begin for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('brain_bind_generation','brain_bind_native_context','brain_generation_current','brain_guard_native_generation','brain_guard_package_release','brain_provider_compatible','brain_provider_lookup','brain_provider_cleanup','brain_request_provider_cleanup','brain_grant_property_creator','brain_package_immutable','brain_read_coordination','brain_read_deliverable')loop
 execute format('revoke all on function %s from public,anon,authenticated,community_brain_worker',f);execute format('grant execute on function %s to service_role',f);end loop;end$$;
commit;
