-- Explicit, immutable publication approval for ReviewFlow testimonials.
-- Response workflow approval is intentionally not publication consent.

create table if not exists public.review_testimonial_approvals (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  content_fingerprint text not null
    check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  reviewer_name_snapshot text not null
    check (length(trim(reviewer_name_snapshot)) between 1 and 200),
  review_text_snapshot text not null
    check (length(trim(review_text_snapshot)) between 1 and 5000),
  rating_snapshot integer not null
    check (rating_snapshot between 1 and 5),
  platform_snapshot text not null
    check (length(trim(platform_snapshot)) between 1 and 100),
  review_date_snapshot timestamptz,
  attribution_approved boolean not null default false,
  rights_basis text not null
    check (
      rights_basis in (
        'platform_terms',
        'direct_consent',
        'property_license',
        'other'
      )
    ),
  rights_evidence jsonb not null default '{}'::jsonb,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_at timestamptz not null default timezone('utc', now()),
  revoked_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint review_testimonial_approvals_state_check check (
    (
      status = 'active'
      and attribution_approved
      and revoked_by is null
      and revoked_at is null
      and revocation_reason is null
    )
    or
    (
      status = 'revoked'
      and revoked_by is not null
      and revoked_at is not null
      and length(trim(revocation_reason)) between 1 and 1000
    )
  )
);

create unique index if not exists review_testimonial_approvals_one_active_idx
  on public.review_testimonial_approvals (review_id)
  where status = 'active';

create index if not exists review_testimonial_approvals_property_status_idx
  on public.review_testimonial_approvals (property_id, status, approved_at desc);

alter table public.review_testimonial_approvals enable row level security;

drop policy if exists "Users view their org testimonial approvals"
  on public.review_testimonial_approvals;
create policy "Users view their org testimonial approvals"
  on public.review_testimonial_approvals
  for select
  using (
    exists (
      select 1
      from public.profiles
      join public.properties
        on properties.id = review_testimonial_approvals.property_id
      where profiles.id = auth.uid()
        and profiles.org_id = properties.org_id
    )
  );

drop policy if exists "Service role manages testimonial approvals"
  on public.review_testimonial_approvals;
create policy "Service role manages testimonial approvals"
  on public.review_testimonial_approvals
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
