-- Classification, source and competitor edits are due immediately, independent of the daily cadence.
create or replace function public.due_marketvision_research(p_limit integer default 5) returns setof uuid language sql security invoker set search_path='' as $$
 select p.id from public.properties p
 where p.website_url is not null and length(p.website_url)>8
 and coalesce(p.settings#>>'{marketvision,researchPaused}','false')<>'true'
 and not exists(select 1 from public.marketvision_research_jobs j where j.property_id=p.id and
   (j.state in ('queued','running') or (j.created_at>clock_timestamp()-interval '24 hours'
    and j.created_at>=greatest(p.updated_at,coalesce((select max(c.updated_at) from public.competitors c where c.property_id=p.id),p.updated_at)))))
 order by (select max(j.created_at) from public.marketvision_research_jobs j where j.property_id=p.id) nulls first,p.id
 limit greatest(1,least(coalesce(p_limit,5),20));
$$;
