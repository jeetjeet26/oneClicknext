-- Missing expiration dates retain saved pricing; only explicit elapsed dates expire it.
-- Preserve the rest of the current canonical function and its security settings.
begin;
do $$
declare definition text; corrected text;
begin
 select pg_get_functiondef('public.brain_canonical_context(uuid,text,uuid[])'::regprocedure) into definition;
 corrected := replace(definition,
   'when u.expires_at is null or u.expires_at<=statement_timestamp()',
   'when u.expires_at is not null and u.expires_at<=statement_timestamp()');
 if corrected = definition then
   raise exception 'Expected inventory expiration expression was not found';
 end if;
 execute corrected;
end $$;
commit;
