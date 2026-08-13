alter table public.property_units
  add column if not exists floor_plan_image_asset_id uuid
    references public.content_assets(id) on delete set null;

with trusted_photos as (
  select
    asset.id,
    coalesce(asset.approved_by, asset.uploaded_by, source.created_by) as actor_id,
    coalesce(
      asset.approved_at,
      asset.created_at,
      timezone('utc', now())
    ) as trusted_at,
    jsonb_strip_nulls(jsonb_build_object(
      'trustedAt', coalesce(
        asset.approved_at,
        asset.created_at,
        timezone('utc', now())
      ),
      'approvedBy', coalesce(
        asset.approved_by,
        asset.uploaded_by,
        source.created_by
      ),
      'intake', case
        when asset.source_identity like 'siteforge-upload:%'
          then 'direct_upload'
        else 'provider_import'
      end,
      'importSource', case
        when asset.source_identity like 'google_drive:%' then 'google_drive'
        when asset.source_identity like 'dropbox:%' then 'dropbox'
        else 'siteforge'
      end,
      'sourceIdentity', asset.source_identity,
      'contentHash', asset.content_hash,
      'sourceId', asset.source_metadata->>'sourceId',
      'providerFileId', asset.source_metadata->>'providerFileId'
    )) as trust_event
  from public.content_assets asset
  left join public.siteforge_asset_sources source
    on (asset.source_metadata->>'sourceId') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and source.id = (asset.source_metadata->>'sourceId')::uuid
  where asset.asset_type = 'image'
    and asset.asset_role in (
      'hero',
      'amenity',
      'gallery',
      'interior',
      'exterior',
      'lifestyle',
      'neighborhood',
      'floorplan'
    )
    and asset.source_identity is not null
    and asset.content_hash is not null
    and coalesce(asset.approved_by, asset.uploaded_by, source.created_by) is not null
    and (
      (
        asset.source_identity like 'siteforge-upload:%'
        and asset.storage_bucket = 'property-assets'
        and asset.storage_path like '%/siteforge/%'
      )
      or (
        asset.source_identity like 'google_drive:%'
        and asset.source_metadata->>'provider' = 'google_drive'
        and asset.source_metadata ? 'sourceId'
      )
      or (
        asset.source_identity like 'dropbox:%'
        and asset.source_metadata->>'provider' = 'dropbox'
        and asset.source_metadata ? 'sourceId'
      )
    )
)
update public.content_assets asset
set
  rights_status = 'owned',
  approval_status = 'approved',
  curation_status = case
    when asset.curation_status in ('selected', 'in_use')
      then asset.curation_status
    else 'approved'
  end,
  expires_at = null,
  approved_by = trusted_photos.actor_id,
  approved_at = trusted_photos.trusted_at,
  rejection_reason = null,
  rights_metadata =
    coalesce(asset.rights_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'siteforgeTrustPolicy',
      jsonb_build_object(
        'name', 'siteforge-solo-operator-photo-trust',
        'version', '1'
      ),
      'siteforgeTrustEvents',
      (
        case
          when jsonb_typeof(
            asset.rights_metadata->'siteforgeTrustEvents'
          ) = 'array'
            then asset.rights_metadata->'siteforgeTrustEvents'
          else '[]'::jsonb
        end
      ) || jsonb_build_array(trusted_photos.trust_event)
    )
from trusted_photos
where asset.id = trusted_photos.id;

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
  if exists (
    select 1
    from jsonb_array_elements(v_import.preview->'rows') as row
    where nullif(row->>'floor_plan_image_asset_id', '') is not null
      and not exists (
        select 1
        from public.content_assets asset
        where asset.id = (row->>'floor_plan_image_asset_id')::uuid
          and asset.property_id = v_import.property_id
          and asset.asset_type = 'image'
          and asset.asset_role = 'floorplan'
      )
  ) then
    raise exception 'Floor-plan image assets must belong to the import property';
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
    floor_plan_image_asset_id,
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
    row.floor_plan_image_asset_id,
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
    floor_plan_image_asset_id uuid,
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
    floor_plan_image_asset_id = excluded.floor_plan_image_asset_id,
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
