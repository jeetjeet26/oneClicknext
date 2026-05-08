alter table public.properties
  drop constraint if exists properties_property_type_check;

alter table public.properties
  add constraint properties_property_type_check
  check (
    property_type is null
    or property_type in (
      'multifamily',
      'senior',
      'student',
      'mixed_use',
      'affordable',
      'luxury',
      'townhome',
      'condo',
      'single_family',
      'master_planned'
    )
  );

alter table public.community_profiles
  drop constraint if exists community_profiles_community_type_check;

alter table public.community_profiles
  add constraint community_profiles_community_type_check
  check (
    community_type is null
    or community_type in (
      'multifamily',
      'senior',
      'student',
      'mixed_use',
      'affordable',
      'luxury',
      'townhome',
      'condo',
      'single_family',
      'master_planned'
    )
  );
