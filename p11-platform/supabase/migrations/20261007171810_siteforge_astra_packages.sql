-- Console-owned Astra builds. Private source snapshots and packages never have public storage access.
create table public.siteforge_package_jobs (
  id uuid primary key,
  property_id uuid not null references public.properties(id),
  org_id uuid not null references public.organizations(id),
  actor_id uuid not null references public.profiles(id),
  parent_id uuid references public.siteforge_package_jobs(id),
  target text not null check (target in ('wordpress','standalone')),
  instructions text not null check (length(instructions) between 1 and 8000),
  request_hash text not null,
  source_hash text not null,
  source_snapshot jsonb not null,
  model text not null default 'gpt-6-astra' check (model = 'gpt-6-astra'),
  state text not null default 'queued' check (state in ('queued','preparing','starting','generating','packaging','ready','failed','uncertain')),
  response_id text unique,
  input_file_id text,
  input_path text,
  package_path text,
  package_hash text,
  package_bytes bigint,
  error_message text,
  usage jsonb,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint package_ready_has_artifact check (state <> 'ready' or (package_path is not null and package_hash is not null and package_bytes > 0)),
  constraint package_running_has_response check (state not in ('generating','packaging','ready') or response_id is not null)
);
create index siteforge_package_property_history on public.siteforge_package_jobs(property_id, created_at desc);
create unique index siteforge_package_one_active on public.siteforge_package_jobs(property_id)
  where state in ('queued','preparing','starting','generating','packaging','uncertain');
alter table public.siteforge_package_jobs enable row level security;
revoke all on public.siteforge_package_jobs from anon, authenticated;
grant select, insert, update on public.siteforge_package_jobs to service_role;

create function public.guard_siteforge_package_job() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists(select 1 from public.properties p join public.profiles u on u.org_id=p.org_id
      where p.id=new.property_id and p.org_id=new.org_id and u.id=new.actor_id and u.role in ('admin','manager')) then
      raise exception 'SiteForge operator access required';
    end if;
    if new.state <> 'queued' or (new.parent_id is not null and not exists(
      select 1 from public.siteforge_package_jobs j where j.id=new.parent_id and j.property_id=new.property_id
      and j.org_id=new.org_id and j.state='ready')) then raise exception 'Invalid package revision'; end if;
  else
    if (new.id,new.property_id,new.org_id,new.actor_id,new.parent_id,new.target,new.instructions,new.request_hash,new.source_hash,new.source_snapshot,new.model,new.created_at)
      is distinct from (old.id,old.property_id,old.org_id,old.actor_id,old.parent_id,old.target,old.instructions,old.request_hash,old.source_hash,old.source_snapshot,old.model,old.created_at)
      then raise exception 'Package source and request are immutable'; end if;
    if old.response_id is not null and new.response_id is distinct from old.response_id then raise exception 'Response is immutable'; end if;
    if old.state in ('ready','failed') then raise exception 'Finished package is immutable'; end if;
    if new.state <> old.state and not (
      (old.state='queued' and new.state in ('preparing','failed')) or
      (old.state='preparing' and new.state in ('starting','failed')) or
      (old.state='starting' and new.state in ('generating','uncertain')) or
      (old.state='generating' and new.state in ('packaging','failed')) or
      (old.state='packaging' and new.state in ('ready','failed')) or
      (old.state='uncertain' and new.state in ('generating','failed'))
    ) then raise exception 'Invalid package transition'; end if;
  end if;
  new.updated_at=now();
  return new;
end $$;
create trigger guard_siteforge_package_job before insert or update on public.siteforge_package_jobs
for each row execute function public.guard_siteforge_package_job();

-- Append evidence in the existing action ledger in the same transaction as the state change.
-- Background completions are service actions, never attributed to a user as completed work.
create function public.record_siteforge_package_job() returns trigger
language plpgsql set search_path = '' as $$
declare eid uuid := gen_random_uuid(); is_user boolean := tg_op='INSERT';
begin
  if tg_op='UPDATE' and new.state=old.state then return new; end if;
  insert into public.shared_action_episodes(id,org_id,property_id,actor_id,service_principal,origin)
    values(eid,new.org_id,new.property_id,case when is_user then new.actor_id end,
      case when not is_user then 'siteforge.astra' end,case when is_user then 'console' else 'workflow' end);
  insert into public.shared_action_events(id,episode_id,org_id,property_id,actor_id,service_principal,
    product,action,evidence,phase,request,after_state,result,training_eligible)
    values(gen_random_uuid(),eid,new.org_id,new.property_id,case when is_user then new.actor_id end,
      case when not is_user then 'siteforge.astra' end,'siteforge','site.package.'||new.state,
      'server_confirmed',case when new.state in ('failed','uncertain') then 'failed' else 'succeeded' end,
      jsonb_build_object('packageId',new.id,'parentId',new.parent_id,'target',new.target,'model',new.model),
      jsonb_build_object('state',new.state,'sourceHash',new.source_hash),
      jsonb_build_object('packageHash',new.package_hash,'requiresHumanReview',true),false);
  return new;
end $$;
create trigger record_siteforge_package_job after insert or update on public.siteforge_package_jobs
for each row execute function public.record_siteforge_package_job();
revoke all on function public.guard_siteforge_package_job(), public.record_siteforge_package_job() from public, anon, authenticated;
grant execute on function public.guard_siteforge_package_job(), public.record_siteforge_package_job() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('siteforge-packages','siteforge-packages',false,52428800,array['application/zip'])
on conflict(id) do nothing;
