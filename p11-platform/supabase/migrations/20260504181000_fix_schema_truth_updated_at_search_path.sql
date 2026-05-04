-- Lock the helper function search_path so Supabase security advisors do not
-- flag it as role-mutable.

create or replace function public.set_schema_truth_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
