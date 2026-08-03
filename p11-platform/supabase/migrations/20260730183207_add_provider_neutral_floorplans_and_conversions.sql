alter table public.property_units
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists source_identity text,
  add column if not exists external_id text,
  add column if not exists canonical_key text,
  add column if not exists floor_plan_image_url text,
  add column if not exists floor_plan_image_alt text,
  add column if not exists availability_url text,
  add column if not exists apply_url text,
  add column if not exists effective_at timestamptz,
  add column if not exists source_updated_at timestamptz,
  add column if not exists imported_at timestamptz,
  add column if not exists active boolean not null default true,
  add column if not exists confidence numeric(4,3) not null default 1,
  add column if not exists review_status text not null default 'approved';

update public.property_units units
set
  org_id = properties.org_id,
  source = coalesce(units.source, 'legacy'),
  source_identity = coalesce(units.source_identity, units.source, 'legacy'),
  canonical_key = coalesce(
    units.canonical_key,
    concat_ws(
      '-',
      regexp_replace(lower(units.unit_type), '[^a-z0-9]+', '-', 'g'),
      units.bedrooms::text,
      coalesce(units.bathrooms::text, 'na'),
      units.id::text
    )
  ),
  effective_at = coalesce(units.effective_at, units.last_updated_at, units.created_at, timezone('utc', now())),
  source_updated_at = coalesce(units.source_updated_at, units.last_updated_at),
  imported_at = coalesce(units.imported_at, units.created_at, timezone('utc', now()))
from public.properties
where properties.id = units.property_id;

alter table public.property_units
  alter column org_id set not null,
  alter column source set default 'manual',
  alter column source set not null,
  alter column source_identity set default 'manual',
  alter column source_identity set not null,
  alter column canonical_key set not null,
  add constraint property_units_confidence_check
    check (confidence >= 0 and confidence <= 1),
  add constraint property_units_review_status_check
    check (review_status in ('pending', 'approved', 'rejected'));

create unique index if not exists property_units_provider_identity_unique
  on public.property_units (property_id, source_identity, canonical_key);

create index if not exists property_units_active_floorplan_idx
  on public.property_units (property_id, active, bedrooms, rent_min);

create table if not exists public.property_unit_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  source_type text not null check (source_type in ('manual', 'csv')),
  source_identity text not null,
  idempotency_key text not null,
  status text not null default 'preview'
    check (status in ('preview', 'confirmed', 'applied', 'failed')),
  original_filename text,
  row_count integer not null default 0 check (row_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  preview jsonb not null default '{"rows":[]}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (property_id, idempotency_key)
);

alter table public.property_units
  add column if not exists import_id uuid references public.property_unit_imports(id) on delete set null;

create index if not exists property_unit_imports_property_created_idx
  on public.property_unit_imports (property_id, created_at desc);

drop trigger if exists property_unit_imports_updated_at on public.property_unit_imports;
create trigger property_unit_imports_updated_at
  before update on public.property_unit_imports
  for each row execute function public.set_schema_truth_updated_at();

alter table public.leads
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists provider text,
  add column if not exists provider_submission_id text,
  add column if not exists consent boolean not null default false,
  add column if not exists consent_text text,
  add column if not exists consented_at timestamptz,
  add column if not exists attribution jsonb not null default '{}'::jsonb;

update public.leads
set org_id = properties.org_id
from public.properties
where properties.id = leads.property_id
  and leads.org_id is null;

create unique index if not exists leads_provider_submission_unique
  on public.leads (property_id, provider, provider_submission_id)
  where provider_submission_id is not null;

alter table public.tours
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists provider text,
  add column if not exists provider_tour_id text,
  add column if not exists attribution jsonb not null default '{}'::jsonb;

update public.tours
set org_id = properties.org_id
from public.properties
where properties.id = tours.property_id
  and tours.org_id is null;

create unique index if not exists tours_provider_identity_unique
  on public.tours (property_id, provider, provider_tour_id)
  where provider_tour_id is not null;

create or replace function public.apply_property_unit_import(
  p_import_id uuid,
  p_confirmed_by uuid
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import public.property_unit_imports%rowtype;
  v_applied integer := 0;
begin
  select *
  into v_import
  from public.property_unit_imports
  where id = p_import_id
  for update;

  if not found then
    raise exception 'Property unit import not found';
  end if;
  if v_import.status = 'applied' then
    return v_import.row_count;
  end if;
  if v_import.status <> 'preview' or v_import.error_count > 0 then
    raise exception 'Only error-free preview imports can be applied';
  end if;

  insert into public.property_units (
    org_id,
    property_id,
    unit_type,
    bedrooms,
    bathrooms,
    sqft_min,
    sqft_max,
    rent_min,
    rent_max,
    available_count,
    move_in_specials,
    source,
    source_identity,
    external_id,
    canonical_key,
    floor_plan_image_url,
    floor_plan_image_alt,
    availability_url,
    apply_url,
    effective_at,
    source_updated_at,
    imported_at,
    import_id,
    active,
    confidence,
    review_status,
    last_updated_at
  )
  select
    v_import.org_id,
    v_import.property_id,
    row.unit_type,
    row.bedrooms,
    row.bathrooms,
    row.sqft_min,
    row.sqft_max,
    row.rent_min,
    row.rent_max,
    row.available_count,
    row.move_in_specials,
    v_import.source_type,
    v_import.source_identity,
    row.external_id,
    row.canonical_key,
    row.floor_plan_image_url,
    row.floor_plan_image_alt,
    row.availability_url,
    row.apply_url,
    coalesce(row.effective_at, timezone('utc', now())),
    row.source_updated_at,
    timezone('utc', now()),
    v_import.id,
    true,
    row.confidence,
    row.review_status,
    timezone('utc', now())
  from jsonb_to_recordset(v_import.preview->'rows') as row(
    unit_type text,
    bedrooms integer,
    bathrooms numeric,
    sqft_min integer,
    sqft_max integer,
    rent_min numeric,
    rent_max numeric,
    available_count integer,
    move_in_specials text,
    external_id text,
    canonical_key text,
    floor_plan_image_url text,
    floor_plan_image_alt text,
    availability_url text,
    apply_url text,
    effective_at timestamptz,
    source_updated_at timestamptz,
    confidence numeric,
    review_status text
  )
  on conflict (property_id, source_identity, canonical_key)
  do update set
    unit_type = excluded.unit_type,
    bedrooms = excluded.bedrooms,
    bathrooms = excluded.bathrooms,
    sqft_min = excluded.sqft_min,
    sqft_max = excluded.sqft_max,
    rent_min = excluded.rent_min,
    rent_max = excluded.rent_max,
    available_count = excluded.available_count,
    move_in_specials = excluded.move_in_specials,
    external_id = excluded.external_id,
    floor_plan_image_url = excluded.floor_plan_image_url,
    floor_plan_image_alt = excluded.floor_plan_image_alt,
    availability_url = excluded.availability_url,
    apply_url = excluded.apply_url,
    effective_at = excluded.effective_at,
    source_updated_at = excluded.source_updated_at,
    imported_at = excluded.imported_at,
    import_id = excluded.import_id,
    active = true,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    last_updated_at = excluded.last_updated_at;

  get diagnostics v_applied = row_count;

  update public.property_unit_imports
  set
    status = 'applied',
    confirmed_by = p_confirmed_by,
    confirmed_at = timezone('utc', now()),
    applied_at = timezone('utc', now())
  where id = p_import_id;

  return v_applied;
end;
$$;

alter table public.property_unit_imports enable row level security;

drop policy if exists "Users view their org property unit imports" on public.property_unit_imports;
create policy "Users view their org property unit imports"
  on public.property_unit_imports for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.org_id = property_unit_imports.org_id
    )
  );

drop policy if exists "Service role manages property unit imports" on public.property_unit_imports;
create policy "Service role manages property unit imports"
  on public.property_unit_imports for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.property_unit_imports to authenticated;
grant all on public.property_unit_imports to service_role;
grant execute on function public.apply_property_unit_import(uuid, uuid) to service_role;

comment on table public.property_unit_imports is
  'Preview-and-confirm source records for idempotent manual and CSV floor-plan imports.';
comment on function public.apply_property_unit_import(uuid, uuid) is
  'Atomically applies one validated floor-plan preview and records its confirmation.';
