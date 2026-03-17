-- Deterministic local fixtures for local Supabase resets.
-- Local login:
--   email: local-admin@p11.test
--   password: local-dev-password

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
  'authenticated',
  'authenticated',
  'local-admin@p11.test',
  extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
  '2026-03-12T00:00:00Z',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Local Admin"}'::jsonb,
  '2026-03-12T00:00:00Z',
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  confirmation_token = excluded.confirmation_token,
  email_change = excluded.email_change,
  email_change_token_new = excluded.email_change_token_new,
  recovery_token = excluded.recovery_token,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = excluded.updated_at;

insert into auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '11111111-1111-1111-1111-111111111112',
  '11111111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  '{"sub":"11111111-1111-1111-1111-111111111111","email":"local-admin@p11.test","email_verified":true}'::jsonb,
  'email',
  '2026-03-12T00:00:00Z',
  '2026-03-12T00:00:00Z',
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  user_id = excluded.user_id,
  provider_id = excluded.provider_id,
  identity_data = excluded.identity_data,
  updated_at = excluded.updated_at;

insert into public.organizations (
  id,
  name,
  subscription_tier,
  settings,
  created_at
)
values (
  '22222222-2222-2222-2222-222222222222',
  'P11 Local Demo Org',
  'growth',
  '{"seeded":true,"environment":"local"}'::jsonb,
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  name = excluded.name,
  subscription_tier = excluded.subscription_tier,
  settings = excluded.settings;

insert into public.profiles (
  id,
  org_id,
  role,
  full_name,
  preferences,
  created_at
)
values (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  'admin',
  'Local Admin',
  '{"seeded":true,"default_property_id":"33333333-3333-3333-3333-333333333333"}'::jsonb,
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  org_id = excluded.org_id,
  role = excluded.role,
  full_name = excluded.full_name,
  preferences = excluded.preferences;

insert into public.properties (
  id,
  org_id,
  name,
  address,
  settings,
  property_type,
  unit_count,
  website_url,
  target_audience,
  special_features,
  amenities,
  created_at
)
values (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  'P11 Local Demo Property',
  '{"line1":"100 Local Loop","city":"Austin","state":"TX","postal_code":"78701"}'::jsonb,
  '{"timezone":"America/Chicago","office_hours":{"mon":{"start":"09:00","end":"18:00"},"tue":{"start":"09:00","end":"18:00"}}}'::jsonb,
  'multifamily',
  248,
  'https://local-demo.p11.test',
  'Renters looking for a modern downtown community',
  array['Walkable location', 'Smart home packages'],
  array['Pool', 'Fitness center', 'Pet spa'],
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  org_id = excluded.org_id,
  name = excluded.name,
  address = excluded.address,
  settings = excluded.settings,
  property_type = excluded.property_type,
  unit_count = excluded.unit_count,
  website_url = excluded.website_url,
  target_audience = excluded.target_audience,
  special_features = excluded.special_features,
  amenities = excluded.amenities;

insert into public.lumaleasing_config (
  id,
  property_id,
  api_key,
  is_active,
  tours_enabled,
  tour_duration_minutes,
  widget_color,
  welcome_message,
  rag_enabled,
  widget_name,
  primary_color,
  secondary_color,
  lead_capture_prompt,
  business_hours,
  timezone,
  created_at,
  updated_at
)
values (
  '44444444-4444-4444-4444-444444444444',
  '33333333-3333-3333-3333-333333333333',
  'local-luma-demo-key',
  true,
  true,
  30,
  '#6366f1',
  'Hi! I am the local Luma demo assistant.',
  true,
  'Luma Local',
  '#6366f1',
  '#8b5cf6',
  'Share your contact details and we will help you schedule a tour.',
  '{"mon":{"start":"09:00","end":"18:00"},"tue":{"start":"09:00","end":"18:00"},"wed":{"start":"09:00","end":"18:00"},"thu":{"start":"09:00","end":"18:00"},"fri":{"start":"09:00","end":"18:00"},"sat":{"start":"10:00","end":"16:00"},"sun":null}'::jsonb,
  'America/Chicago',
  '2026-03-12T00:00:00Z',
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  property_id = excluded.property_id,
  api_key = excluded.api_key,
  is_active = excluded.is_active,
  tours_enabled = excluded.tours_enabled,
  widget_name = excluded.widget_name,
  primary_color = excluded.primary_color,
  secondary_color = excluded.secondary_color,
  updated_at = excluded.updated_at;

insert into public.documents (
  id,
  property_id,
  content,
  metadata,
  created_at
)
values (
  '55555555-5555-5555-5555-555555555555',
  '33333333-3333-3333-3333-333333333333',
  'P11 Local Demo Property offers studio, one-bedroom, and two-bedroom apartments with pet-friendly policies, a rooftop lounge, and self-guided tour support.',
  '{"source":"local-seed","title":"Community Overview"}'::jsonb,
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  property_id = excluded.property_id,
  content = excluded.content,
  metadata = excluded.metadata;

insert into public.fact_marketing_performance (
  date,
  property_id,
  channel_id,
  campaign_name,
  campaign_id,
  impressions,
  clicks,
  spend,
  conversions,
  raw_source,
  created_at
)
values (
  '2026-03-01',
  '33333333-3333-3333-3333-333333333333',
  'google_ads',
  'Local Demo Search Campaign',
  'local-demo-search',
  12500,
  412,
  987.65,
  21,
  'local-seed',
  '2026-03-12T00:00:00Z'
)
on conflict (date, property_id, campaign_id) do update
set
  channel_id = excluded.channel_id,
  campaign_name = excluded.campaign_name,
  impressions = excluded.impressions,
  clicks = excluded.clicks,
  spend = excluded.spend,
  conversions = excluded.conversions,
  raw_source = excluded.raw_source;

insert into public.leads (
  id,
  property_id,
  source,
  first_name,
  last_name,
  email,
  phone,
  status,
  bedrooms,
  notes,
  created_at,
  updated_at
)
values (
  '66666666-6666-6666-6666-666666666666',
  '33333333-3333-3333-3333-333333333333',
  'website',
  'Jordan',
  'Prospect',
  'jordan.prospect@p11.test',
  '+15125550101',
  'tour_booked',
  2,
  'Seeded lead for local smoke testing.',
  '2026-03-12T00:00:00Z',
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  property_id = excluded.property_id,
  status = excluded.status,
  bedrooms = excluded.bedrooms,
  notes = excluded.notes,
  updated_at = excluded.updated_at;

insert into public.conversations (
  id,
  lead_id,
  property_id,
  channel,
  created_at
)
values (
  '77777777-7777-7777-7777-777777777777',
  '66666666-6666-6666-6666-666666666666',
  '33333333-3333-3333-3333-333333333333',
  'chat',
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  lead_id = excluded.lead_id,
  property_id = excluded.property_id,
  channel = excluded.channel;

insert into public.messages (
  id,
  conversation_id,
  role,
  content,
  created_at
)
values
  (
    '88888888-8888-8888-8888-888888888881',
    '77777777-7777-7777-7777-777777777777',
    'user',
    'Do you have any pet-friendly two-bedroom apartments available?',
    '2026-03-12T00:00:00Z'
  ),
  (
    '88888888-8888-8888-8888-888888888882',
    '77777777-7777-7777-7777-777777777777',
    'assistant',
    'Yes, our seeded demo property is pet-friendly and has two-bedroom layouts available.',
    '2026-03-12T00:01:00Z'
  )
on conflict (id) do update
set
  conversation_id = excluded.conversation_id,
  role = excluded.role,
  content = excluded.content;

insert into public.tour_slots (
  id,
  property_id,
  slot_date,
  start_time,
  end_time,
  max_bookings,
  current_bookings,
  is_available,
  created_at
)
values (
  '99999999-9999-9999-9999-999999999999',
  '33333333-3333-3333-3333-333333333333',
  '2099-01-15',
  '10:00',
  '10:30',
  4,
  1,
  true,
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  property_id = excluded.property_id,
  slot_date = excluded.slot_date,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  current_bookings = excluded.current_bookings,
  is_available = excluded.is_available;

insert into public.tour_bookings (
  id,
  property_id,
  lead_id,
  slot_id,
  scheduled_date,
  scheduled_time,
  duration_minutes,
  special_requests,
  source,
  booked_via_conversation_id,
  status,
  created_at,
  updated_at
)
values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '33333333-3333-3333-3333-333333333333',
  '66666666-6666-6666-6666-666666666666',
  '99999999-9999-9999-9999-999999999999',
  '2099-01-15',
  '10:00',
  30,
  'Please highlight pet amenities during the tour.',
  'lumaleasing',
  '77777777-7777-7777-7777-777777777777',
  'confirmed',
  '2026-03-12T00:00:00Z',
  '2026-03-12T00:00:00Z'
)
on conflict (id) do update
set
  property_id = excluded.property_id,
  lead_id = excluded.lead_id,
  slot_id = excluded.slot_id,
  scheduled_date = excluded.scheduled_date,
  scheduled_time = excluded.scheduled_time,
  special_requests = excluded.special_requests,
  booked_via_conversation_id = excluded.booked_via_conversation_id,
  status = excluded.status,
  updated_at = excluded.updated_at;
