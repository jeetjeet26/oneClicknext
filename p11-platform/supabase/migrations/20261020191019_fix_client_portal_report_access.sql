-- Client report reads use explicit client property grants, not internal staff brain permissions.
-- Restore the scoped projection; keep execution restricted to the server service role.
create or replace function public.read_published_delivery_reports(p_actor_id uuid,p_property_id uuid default null,p_offset integer default 0)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare scope jsonb;org uuid;ids uuid[];begin
 scope:=public.read_client_portal_scope(p_actor_id);if scope->>'state'<>'ready'then return '{"state":"forbidden"}';end if;
 org:=(scope->>'orgId')::uuid;select array_agg((x->>'id')::uuid)into ids from jsonb_array_elements(scope->'properties')x;
 if p_property_id is not null and not coalesce(p_property_id=any(ids),false)then return '{"state":"forbidden"}';end if;
 if p_offset not between 0 and 100000 then return '{"state":"invalid_input"}';end if;
 return jsonb_build_object('state','ready','reports',(select coalesce(jsonb_agg(to_jsonb(x)),'[]')from(
 select r.id,r.summary,r.next_steps,r.evidence,r.published_at,p.name as property_name,b.label,b.source from public.delivery_reports r
 join public.properties p on p.id=r.property_id and p.org_id=r.org_id
 join public.bi_reports b on b.id=r.source_report_id and b.property_id=r.property_id and b.org_id=r.org_id and b.state='saved'
 where r.org_id=org and r.property_id=any(ids)and(p_property_id is null or r.property_id=p_property_id)and r.state='published'
 order by r.published_at desc,r.id limit 21 offset p_offset)x));
end $$;
revoke all on function public.read_published_delivery_reports(uuid,uuid,integer)from public,anon,authenticated;
grant execute on function public.read_published_delivery_reports(uuid,uuid,integer)to service_role;
