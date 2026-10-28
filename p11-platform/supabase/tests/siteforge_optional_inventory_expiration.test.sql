-- Integration regression against an approved floorplan; every fixture edit rolls back.
begin;
do $$
declare plan public.property_units; snapshot jsonb;
begin
 select * into strict plan from public.property_units where active and review_status='approved' and (effective_at is null or effective_at<=statement_timestamp()) order by id limit 1;
 update public.property_units set rent_min=1234,rent_max=2345,available_count=3,expires_at=null where id=plan.id;
 select f into snapshot from jsonb_array_elements(public.brain_canonical_context(plan.property_id,'site','{}')->'floorplans') f where f->>'id'=plan.id::text;
 if snapshot is null or (snapshot->>'rent_min')::numeric is distinct from 1234 or (snapshot->>'available_count')::integer is distinct from 3 or snapshot?'pricingExpired' then raise exception 'Missing expiration suppressed inventory';end if;
 update public.property_units set expires_at=statement_timestamp()+interval '1 day' where id=plan.id;
 select f into snapshot from jsonb_array_elements(public.brain_canonical_context(plan.property_id,'site','{}')->'floorplans') f where f->>'id'=plan.id::text;
 if (snapshot->>'rent_min')::numeric is distinct from 1234 or snapshot?'pricingExpired' then raise exception 'Future expiration suppressed inventory';end if;
 update public.property_units set expires_at=statement_timestamp() where id=plan.id;
 select f into snapshot from jsonb_array_elements(public.brain_canonical_context(plan.property_id,'site','{}')->'floorplans') f where f->>'id'=plan.id::text;
 if snapshot->>'rent_min' is not null or snapshot->>'available_count' is not null or snapshot->>'pricingExpired' is distinct from 'true' then raise exception 'Expired inventory retained commercial values';end if;
end $$;
rollback;
