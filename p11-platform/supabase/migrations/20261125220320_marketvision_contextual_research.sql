-- Public research is available by default. Source claims remain distinct from approved community facts.
create function public.community_transaction(p_property_type text,p_settings jsonb) returns text language sql immutable security invoker set search_path='' as $$
 select case when p_settings#>>'{onboarding,transaction}' in ('rental','for_sale','care_services','commercial_lease','informational','destination_booking') then p_settings#>>'{onboarding,transaction}'
 when p_property_type in ('single_family','townhome','condo','master_planned') then 'for_sale' else 'rental' end;
$$;
revoke all on function public.community_transaction(text,jsonb) from public,anon,authenticated;
grant execute on function public.community_transaction(text,jsonb) to service_role;

-- Include safe onboarding classification in every canonical generation manifest and its existing hash.
-- Never expose the rest of properties.settings (which may contain integration configuration).
do $$declare definition text;before_text text:='select id,org_id,name,address,website_url,property_type,updated_at from public.properties where id=p_property_id';after_text text:='select id,org_id,name,address,website_url,property_type,updated_at,public.community_transaction(property_type,settings) as operating_model,settings#>>''{onboarding,offeringKind}'' as offering_kind,settings#>>''{onboarding,primaryIntent}'' as primary_intent from public.properties where id=p_property_id';begin
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure) into definition;
 if position(before_text in definition)=0 then raise exception 'Canonical community classification contract changed; review before migration';end if;
 execute replace(definition,before_text,after_text);
end$$;

-- The shared inventory editor follows the same explicit business model as generation and research.
create or replace function public.read_property_unit_review(p_property_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.brain_can(p_actor_id,p_property_id,'read') then return '{"state":"forbidden"}'::jsonb;end if;
 return public._brain_read_property_unit_review(p_property_id,p_actor_id,p_input) || jsonb_build_object('transaction',(select public.community_transaction(property_type,settings) from public.properties where id=p_property_id));
end$$;
revoke all on function public.read_property_unit_review(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.read_property_unit_review(uuid,uuid,jsonb) to service_role;

create table public.marketvision_research_jobs (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete set null,
 context_hash text not null,
 context jsonb not null check(jsonb_typeof(context)='object'),
 state text not null default 'queued' check(state in ('queued','running','completed','partial','failed','stopped')),
 result jsonb not null default '{}',
 lease_token uuid,
 leased_at timestamptz,
 error_message text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,property_id)
);
create unique index marketvision_research_one_active on public.marketvision_research_jobs(property_id) where state in ('queued','running');
create index marketvision_research_property_history on public.marketvision_research_jobs(property_id,created_at desc);
create index marketvision_research_queue on public.marketvision_research_jobs(created_at) where state in ('queued','running');
alter table public.marketvision_research_jobs enable row level security;
revoke all on public.marketvision_research_jobs from public,anon,authenticated;
grant all on public.marketvision_research_jobs to service_role;
create policy marketvision_research_jobs_service on public.marketvision_research_jobs for all to service_role using(true) with check(true);

create table public.marketvision_research_documents (
 id uuid primary key,
 job_id uuid not null,
 property_id uuid not null,
 competitor_id uuid references public.competitors(id) on delete cascade,
 entity_key text not null,
 source_url text not null check(length(source_url)<=4000),
 source_kind text not null check(source_kind in ('official','listing','planning','reviews','ads','reference')),
 status text not null check(status in ('captured','failed')),
 title text not null,
 content_text text not null default '' check(length(content_text)<=100000),
 content_hash text not null,
 metadata jsonb not null default '{}',
 fetched_at timestamptz not null,
 foreign key(job_id,property_id) references public.marketvision_research_jobs(id,property_id) on delete cascade,
 check((competitor_id is null and entity_key='subject') or (competitor_id is not null and entity_key=competitor_id::text))
);
create index marketvision_research_documents_job on public.marketvision_research_documents(job_id,entity_key);
create index marketvision_research_documents_history on public.marketvision_research_documents(property_id,entity_key,source_url,fetched_at desc);
alter table public.marketvision_research_documents enable row level security;
revoke all on public.marketvision_research_documents from public,anon,authenticated;
grant all on public.marketvision_research_documents to service_role;
create policy marketvision_research_documents_service on public.marketvision_research_documents for all to service_role using(true) with check(true);

create function public.guard_marketvision_research_source() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.competitor_id is not null and not exists(select 1 from public.competitors where id=new.competitor_id and property_id=new.property_id) then raise exception 'Competitor source scope mismatch';end if;
 return new;
end$$;
create trigger marketvision_research_source_scope before insert or update on public.marketvision_research_documents for each row execute function public.guard_marketvision_research_source();
revoke all on function public.guard_marketvision_research_source() from public,anon,authenticated;
grant execute on function public.guard_marketvision_research_source() to service_role;

create function public.claim_marketvision_research(p_id uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare job public.marketvision_research_jobs;
begin
 select * into job from public.marketvision_research_jobs
 where (p_id is null or id=p_id) and (state='queued' or (state='running' and leased_at<clock_timestamp()-interval '10 minutes'))
 order by created_at for update skip locked limit 1;
 if not found then return null;end if;
 update public.marketvision_research_jobs set state='running',lease_token=gen_random_uuid(),leased_at=clock_timestamp(),updated_at=clock_timestamp() where id=job.id returning * into job;
 return to_jsonb(job);
end$$;
revoke all on function public.claim_marketvision_research(uuid) from public,anon,authenticated;
grant execute on function public.claim_marketvision_research(uuid) to service_role;

-- Every property with a usable website participates, including properties created after this migration.
create function public.due_marketvision_research(p_limit integer default 5) returns setof uuid language sql security invoker set search_path='' as $$
 select p.id from public.properties p
 where p.website_url is not null and length(p.website_url)>8
 and coalesce(p.settings#>>'{marketvision,researchPaused}','false')<>'true'
 and not exists(select 1 from public.marketvision_research_jobs j where j.property_id=p.id and
   (j.state in ('queued','running') or j.created_at>clock_timestamp()-interval '24 hours'))
 order by (select max(j.created_at) from public.marketvision_research_jobs j where j.property_id=p.id) nulls first,p.id
 limit greatest(1,least(coalesce(p_limit,5),20));
$$;
revoke all on function public.due_marketvision_research(integer) from public,anon,authenticated;
grant execute on function public.due_marketvision_research(integer) to service_role;

comment on table public.marketvision_research_documents is 'Retained public website, listing, review, ad and planning evidence; competitor evidence never becomes a subject feature automatically.';
comment on table public.marketvision_research_jobs is 'Resumable context-specific research; result contains separate sale-price and monthly-rent offerings, source citations, coverage and analytical interpretations.';
