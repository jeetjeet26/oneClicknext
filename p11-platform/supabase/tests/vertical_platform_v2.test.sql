begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

select has_column(
  'public',
  'properties',
  'subject_kind',
  'properties has a subject kind'
);
select has_column(
  'public',
  'properties',
  'current_vertical_profile_version_id',
  'properties has a current vertical profile pointer'
);
select has_table(
  'public',
  'property_subject_relationships',
  'subject relationships table exists'
);
select has_table(
  'public',
  'property_vertical_profile_versions',
  'vertical profile versions table exists'
);
select has_table('public', 'property_offerings', 'property offerings table exists');
select has_table(
  'public',
  'property_offering_versions',
  'offering versions table exists'
);
select has_table(
  'public',
  'property_availability_snapshots',
  'availability snapshots table exists'
);
select has_table(
  'public',
  'property_policy_versions',
  'property policy versions table exists'
);
select has_table(
  'public',
  'siteforge_conversion_submissions',
  'conversion submissions table exists'
);
select has_table(
  'public',
  'siteforge_conversion_intent_versions',
  'conversion intent versions table exists'
);
select has_table(
  'public',
  'siteforge_conversion_outcomes',
  'conversion outcomes table exists'
);
select has_table(
  'public',
  'siteforge_vertical_activation_versions',
  'vertical activation versions table exists'
);
select has_table(
  'public',
  'siteforge_launch_policies',
  'launch policies table exists'
);
select has_table(
  'public',
  'siteforge_launch_confirmations',
  'launch confirmations table exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_subject_relationships'::regclass),
  'subject relationships enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_vertical_profile_versions'::regclass),
  'vertical profile versions enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_offerings'::regclass),
  'property offerings enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_offering_versions'::regclass),
  'offering versions enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_availability_snapshots'::regclass),
  'availability snapshots enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_policy_versions'::regclass),
  'property policy versions enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.siteforge_conversion_submissions'::regclass),
  'conversion submissions enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.siteforge_conversion_intent_versions'::regclass),
  'conversion intent versions enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.siteforge_conversion_outcomes'::regclass),
  'conversion outcomes enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.siteforge_vertical_activation_versions'::regclass),
  'vertical activation versions enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.siteforge_launch_policies'::regclass),
  'launch policies enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.siteforge_launch_confirmations'::regclass),
  'launch confirmations enforce RLS'
);

select has_column(
  'public',
  'property_onboarding_snapshots',
  'vertical_profile_version_id',
  'onboarding snapshots pin vertical profiles'
);
select has_column(
  'public',
  'siteforge_brief_versions',
  'vertical_profile_version_id',
  'brief versions pin vertical profiles'
);
select has_column(
  'public',
  'siteforge_plan_versions',
  'vertical_profile_version_id',
  'plan versions pin vertical profiles'
);
select has_column(
  'public',
  'siteforge_blueprint_versions',
  'vertical_profile_version_id',
  'blueprint versions pin vertical profiles'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.property_vertical_profile_versions'::regclass
      and tgname = 'property_vertical_profiles_immutable'
      and not tgisinternal
  ),
  'vertical profile versions are append-only'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.siteforge_launch_confirmations'::regclass
      and tgname = 'siteforge_launch_confirmations_immutable'
      and not tgisinternal
  ),
  'launch confirmations are append-only'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.siteforge_conversion_intent_versions'::regclass
      and tgname = 'siteforge_conversion_intent_versions_immutable'
      and not tgisinternal
  ),
  'conversion intent versions are append-only'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.siteforge_conversion_outcomes'::regclass
      and tgname = 'siteforge_conversion_outcomes_immutable'
      and not tgisinternal
  ),
  'conversion outcomes are append-only'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.siteforge_vertical_activation_versions'::regclass
      and tgname = 'siteforge_vertical_activation_versions_immutable'
      and not tgisinternal
  ),
  'vertical activation versions are append-only'
);

select * from finish();
rollback;
