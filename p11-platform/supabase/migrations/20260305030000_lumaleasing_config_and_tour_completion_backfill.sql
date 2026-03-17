-- Align LumaLeasing config and tour completion schema with runtime usage.

alter table lumaleasing_config
  add column if not exists widget_name text default 'Luma',
  add column if not exists primary_color text default '#6366f1',
  add column if not exists secondary_color text default '#8b5cf6',
  add column if not exists logo_url text,
  add column if not exists offline_message text default 'We are currently offline, but we will follow up soon.',
  add column if not exists auto_popup_delay_seconds int default 0,
  add column if not exists require_email_before_chat boolean default false,
  add column if not exists collect_name boolean default true,
  add column if not exists collect_email boolean default true,
  add column if not exists collect_phone boolean default false,
  add column if not exists lead_capture_prompt text default 'Before we continue, could you share your contact details?',
  add column if not exists tour_buffer_minutes int default 15,
  add column if not exists business_hours jsonb default '{
    "mon": {"start": "09:00", "end": "18:00"},
    "tue": {"start": "09:00", "end": "18:00"},
    "wed": {"start": "09:00", "end": "18:00"},
    "thu": {"start": "09:00", "end": "18:00"},
    "fri": {"start": "09:00", "end": "18:00"},
    "sat": null,
    "sun": null
  }'::jsonb,
  add column if not exists timezone text default 'America/Chicago';

alter table tour_bookings
  add column if not exists completed_at timestamptz,
  add column if not exists completion_notes text;

comment on column lumaleasing_config.widget_name is 'Display name of the assistant used in widget prompts and chat.';
comment on column lumaleasing_config.primary_color is 'Primary UI color for the public LumaLeasing widget.';
comment on column lumaleasing_config.secondary_color is 'Secondary/accent UI color for the public LumaLeasing widget.';
comment on column lumaleasing_config.logo_url is 'Optional logo shown in the widget and related surfaces.';
comment on column lumaleasing_config.offline_message is 'Message shown when chat is unavailable or outside business hours.';
comment on column lumaleasing_config.auto_popup_delay_seconds is 'Delay before auto-opening the widget.';
comment on column lumaleasing_config.require_email_before_chat is 'Whether email is required before the visitor can continue chatting.';
comment on column lumaleasing_config.collect_name is 'Whether the widget asks for the visitor name during lead capture.';
comment on column lumaleasing_config.collect_email is 'Whether the widget asks for the visitor email during lead capture.';
comment on column lumaleasing_config.collect_phone is 'Whether the widget asks for the visitor phone during lead capture.';
comment on column lumaleasing_config.lead_capture_prompt is 'Custom prompt shown when collecting lead information.';
comment on column lumaleasing_config.tour_buffer_minutes is 'Buffer between available tours used by widget and calendar flows.';
comment on column lumaleasing_config.business_hours is 'Structured business-hours config for availability checks.';
comment on column lumaleasing_config.timezone is 'Timezone used for widget availability and booking display.';
comment on column tour_bookings.completed_at is 'Timestamp when a booked tour was marked completed.';
comment on column tour_bookings.completion_notes is 'Leasing team notes captured when marking a tour completed.';
