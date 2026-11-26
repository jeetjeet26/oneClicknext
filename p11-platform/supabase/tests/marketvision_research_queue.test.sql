begin;
do $$
declare
 org uuid;
 first_property uuid:=gen_random_uuid();
 second_property uuid:=gen_random_uuid();
 first_id uuid:=gen_random_uuid();
 second_id uuid:=gen_random_uuid();
 claimed jsonb;
 first_lease text;
begin
 select org_id into org from public.properties where org_id is not null limit 1;
 if org is null then raise exception 'Research queue test needs a seeded organization';end if;
 insert into public.properties(id,org_id,name) values
  (first_property,org,'Research queue rollback fixture A'),
  (second_property,org,'Research queue rollback fixture B');
 insert into public.marketvision_research_jobs(id,property_id,context_hash,context,created_at,updated_at) values
  (first_id,first_property,'fixture-a','{}','2000-01-01','2000-01-01'),
  (second_id,second_property,'fixture-b','{}','2001-01-01','2001-01-01');

 claimed:=public.claim_marketvision_research();
 if claimed->>'id'<>first_id::text or claimed->>'state'<>'running' or claimed->>'lease_token' is null then
  raise exception 'First waiting community did not receive a worker lease';
 end if;
 first_lease:=claimed->>'lease_token';
 -- Simulate finishing one entity of the older, larger research request.
 update public.marketvision_research_jobs
 set state='queued',lease_token=null,leased_at=null,updated_at=clock_timestamp(),result='{"profiles":[{"entityKey":"subject"}]}'
 where id=first_id;
 claimed:=public.claim_marketvision_research();
 if claimed->>'id'<>second_id::text then raise exception 'Large job monopolized the next turn instead of serving the waiting community';end if;

 claimed:=public.claim_marketvision_research(first_id);
 if claimed->>'id'<>first_id::text or claimed->>'lease_token'=first_lease then raise exception 'Targeted retry did not renew its own job lease';end if;
 if claimed#>>'{result,profiles,0,entityKey}'<>'subject' then raise exception 'Claim discarded completed research evidence';end if;
 if public.claim_marketvision_research(first_id) is not null then raise exception 'Live worker lease was claimed twice';end if;
 update public.marketvision_research_jobs set leased_at=clock_timestamp()-interval '11 minutes' where id=first_id;
 if public.claim_marketvision_research(first_id) is null then raise exception 'Expired worker lease could not recover';end if;
 if has_function_privilege('authenticated','public.claim_marketvision_research(uuid)','execute')
 or has_function_privilege('anon','public.claim_marketvision_research(uuid)','execute') then
  raise exception 'Research worker claim must remain private';
 end if;
end $$;
rollback;
