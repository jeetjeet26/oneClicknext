-- One read snapshot: no REST row limit or cross-query partial results.
create function public.read_marketvision_analysis(p_property_id uuid,p_actor_id uuid,p_days integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; observed timestamptz:=statement_timestamp(); start_at timestamptz;begin
 if p_days is null or p_days not between 1 and 366 then raise exception 'Choose a reporting window between 1 and 366 days';end if;
 if not exists(select 1 from public.properties p join public.profiles a on a.org_id=p.org_id where p.id=p_property_id and a.id=p_actor_id) then return '{"state":"forbidden"}';end if;
 start_at:=observed-make_interval(days=>p_days);
 with comps as materialized(select c.id,c.name,c.address,c.amenities,c.version from public.competitors c where c.property_id=p_property_id and c.is_active),
 units as materialized(select u.* from public.competitor_units u join comps c on c.id=u.competitor_id),
 history as materialized(
 select h.* from public.competitor_price_history h join units u on u.id=h.competitor_unit_id where h.recorded_at>=start_at and h.recorded_at<=observed
 union all
 select prior.* from units u cross join lateral(select h.* from public.competitor_price_history h where h.competitor_unit_id=u.id and h.recorded_at<start_at order by h.recorded_at desc fetch first 1 rows with ties)prior
 ),
 captures as materialized(select s.id,s.competitor_id,s.source_type,s.source_url,s.captured_at,s.effective_at,s.content_hash,s.status,
 exists(select 1 from public.marketvision_source_requests r where r.id=s.id and r.org_id=(select org_id from public.properties where id=p_property_id) and r.state='received' and r.competitor_id=s.competitor_id)as fetched
 from public.market_source_captures s join comps c on c.id=s.competitor_id where s.property_id=p_property_id and (exists(select 1 from units u where u.capture_id=s.id)or exists(select 1 from history h where h.capture_id=s.id)))
 select jsonb_build_object('state','ready','snapshotAt',observed,'windowStart',start_at,'windowDays',p_days,'propertyId',p_property_id,'propertyName',(select name from public.properties where id=p_property_id),
 'competitors',coalesce((select jsonb_agg(to_jsonb(c)order by c.id)from comps c),'[]'),
 'units',coalesce((select jsonb_agg(to_jsonb(u)order by u.id)from units u),'[]'),
 'history',coalesce((select jsonb_agg(to_jsonb(h)order by h.recorded_at,h.id)from history h),'[]'),
 'captures',coalesce((select jsonb_agg(to_jsonb(s)order by s.id)from captures s),'[]'))into result;
 if octet_length(result::text)>20971520 then return '{"state":"snapshot_too_large"}';end if;
 return result;
end$$;
revoke all on function public.read_marketvision_analysis(uuid,uuid,integer)from public,anon,authenticated;
grant execute on function public.read_marketvision_analysis(uuid,uuid,integer)to service_role;
