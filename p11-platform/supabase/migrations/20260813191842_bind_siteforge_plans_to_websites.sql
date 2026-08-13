alter table public.siteforge_plans
  add column if not exists website_id uuid;

-- Prefer the immutable generation linkage when a legacy plan reached
-- generation. Both planId and planVersionId are checked because older payloads
-- were not fully consistent.
with exact_matches as (
  select
    plans.id as plan_id,
    (array_agg(websites.id order by websites.id))[1] as website_id
  from public.siteforge_plans plans
  join public.property_websites websites
    on websites.org_id = plans.org_id
   and websites.property_id = plans.property_id
  where websites.generation_input ->> 'planId' = plans.id::text
     or exists (
       select 1
       from public.siteforge_plan_versions versions
       where versions.plan_id = plans.id
         and versions.id::text =
           websites.generation_input ->> 'planVersionId'
     )
  group by plans.id
  having count(distinct websites.id) = 1
)
update public.siteforge_plans plans
set website_id = exact_matches.website_id
from exact_matches
where plans.id = exact_matches.plan_id
  and plans.website_id is null;

-- Legacy plans without one exact generation linkage remain unbound. A
-- property may have many website shells, so guessing by timestamp would attach
-- governed history to the wrong website. New writes always require website_id.
do $$
begin
  if exists (
    select 1
    from public.siteforge_plans plans
    left join public.property_websites websites
      on websites.id = plans.website_id
     and websites.org_id = plans.org_id
     and websites.property_id = plans.property_id
    where plans.website_id is not null
      and websites.id is null
  ) then
    raise exception
      'Cannot bind siteforge_plans to tenant-owned property_websites';
  end if;
end
$$;

create index if not exists siteforge_plans_website_updated_idx
  on public.siteforge_plans (website_id, updated_at desc);

create unique index if not exists siteforge_plans_website_identity_idx
  on public.siteforge_plans (website_id)
  where website_id is not null;

alter table public.siteforge_plans
  drop constraint if exists siteforge_plans_website_tenant_fkey;

alter table public.siteforge_plans
  add constraint siteforge_plans_website_tenant_fkey
  foreign key (website_id, org_id, property_id)
  references public.property_websites (id, org_id, property_id)
  on delete restrict;

comment on column public.siteforge_plans.website_id is
  'Website version that exclusively owns this governed SiteForge plan. Null is retained only for ambiguous pre-migration legacy history.';
