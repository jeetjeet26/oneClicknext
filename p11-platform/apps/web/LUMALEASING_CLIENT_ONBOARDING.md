# LumaLeasing Client Onboarding Runbook

This is the per-property checklist for onboarding a new client to the LumaLeasing chatbot. Follow it end to end. Do not flip the embed on the client's website until every required step is checked.

Companion docs:

- `LUMALEASING_OPS_RUNBOOK.md` — environment, cron, rate limits, rollback.
- `LUMALEASING_LAUNCH_SMOKE.md` — staging smoke procedure and acceptance criteria.

## 1. Pre-Onboarding Confirmation

Confirm with the client before doing any setup:

- [ ] Property name, address, leasing email, leasing phone.
- [ ] Brand: primary color, secondary color, logo URL (PNG/SVG, 256px+ square).
- [ ] Welcome message and offline message copy.
- [ ] Business hours and timezone.
- [ ] Whether tours are enabled and which Google account will own the calendar.
- [ ] Whether Gmail integration is enabled and which Google account owns the inbox.
- [ ] CRM destination (if any) and which fields they expect to see populated.
- [ ] One operator email/account that will manage the dashboard.
- [ ] The exact website domain(s) where the widget will be embedded.

## 2. Platform Provisioning

In the dashboard / Supabase, verify or create:

- [ ] `organizations` row for the client.
- [ ] `properties` row with `org_id`, address, website URL, timezone.
- [ ] `profiles` row for the operator with `org_id` linked.
- [ ] `lumaleasing_config` row created via `GET /api/lumaleasing/admin/config?propertyId=…` (this auto-creates with a fresh API key on first access).

After auto-creation, set via the Configuration tab in `/dashboard/lumaleasing`:

- [ ] `widget_name`, `primary_color`, `secondary_color`, `logo_url`.
- [ ] `welcome_message`, `offline_message`, `lead_capture_prompt`.
- [ ] `business_hours`, `timezone`.
- [ ] `auto_popup_delay_seconds` (0 disables auto-open).
- [ ] `require_email_before_chat`, `collect_name`, `collect_email`, `collect_phone`.
- [ ] `tours_enabled`, `tour_duration_minutes`, `tour_buffer_minutes` (only if tours are part of the package).
- [ ] `is_active = true` only after the rest of this checklist passes.

## 3. RAG Knowledge Base

Embed needs at least baseline content to avoid "I don't have that info" answers.

- [ ] Upload property FAQ via `/dashboard/luma` document upload.
- [ ] Upload pet policy.
- [ ] Upload floor plan / pricing summary.
- [ ] Upload amenities and parking info.
- [ ] Upload application/lease term basics.
- [ ] Optionally sync property units via the units sync flow.
- [ ] Verify rows exist: `select count(*) from documents where property_id = '<id>';` should be ≥ 5.
- [ ] Sanity-test 3 questions in the dashboard chat: floor plans, pet policy, tour booking. Each must produce a grounded answer.

## 4. Provider Integrations

### Calendar (required for live tour booking)

- [ ] Choose the client provider: Google Calendar or Microsoft Outlook Calendar.
- [ ] If the operator has P11 access, they click the matching connect button in `/dashboard/lumaleasing` → Tours tab.
- [ ] If the client should not receive P11 access, generate and send/copy the provider-specific external calendar auth link from the Tours tab.
- [ ] Client completes Google or Microsoft OAuth with the property calendar account.
- [ ] `agent_calendars` row appears with `sync_enabled = true`, `token_status = 'healthy'`.
- [ ] `agent_calendars.provider` and `agent_calendars.account_email` match the authorized account.
- [ ] `GET /api/lumaleasing/calendar/status?propertyId=…` returns `connected: true`, `webhook_capability.ready: true`.
- [ ] Operator confirms the calendar that should receive bookings is the default calendar on that account, or update `calendar_id` if otherwise.

If tours are not part of the package, set `tours_enabled = false` and skip this section.

### Email Inbox (required for inbound thread sync)

- [ ] Choose the client provider: Gmail or Microsoft Outlook Mail.
- [ ] If the operator has P11 access, they click the matching connect button in `/dashboard/lumaleasing` → Leads tab.
- [ ] If the client should not receive P11 access, generate and send/copy the provider-specific external email auth link from the Leads tab.
- [ ] Client completes Google or Microsoft OAuth on the inbox account.
- [ ] `email_configurations` row appears with `sync_enabled = true`, `token_status = 'healthy'`.
- [ ] `email_configurations.provider` and `email_configurations.account_email` match the authorized inbox.
- [ ] `GET /api/lumaleasing/email/status?propertyId=…` returns `connected: true`, `webhook_capability.ready: true`.
- [ ] Operator confirms `auto_reply_enabled` setting matches their preference.

If Gmail is not in scope, leave `email_enabled = false` and skip.

### CRM Sync (optional, where contracted)

- [ ] Configure CRM mapping in `/dashboard/settings/crm`.
- [ ] Run a manual lead push to validate the mapping.
- [ ] Confirm `integration_credentials` row exists for the property.

## 5. Communication & Branding QA

- [ ] Visit `/lumaleasing/demo?apiKey=<config.api_key>` (loads the same `lumaleasing.js` clients embed).
- [ ] Confirm widget header shows correct `widget_name`, logo, primary color.
- [ ] Confirm welcome message appears.
- [ ] Confirm Online/Away dot reflects the configured business hours.
- [ ] Test outside business hours and confirm the offline message renders if relevant.
- [ ] Open the chat, then press Esc — the chat dialog must close.
- [ ] Use a screen reader to verify the dialog announces title and status (`role="dialog"` + `aria-live` on messages).

## 6. Functional QA

Run with the property's API key on staging or a clone before production.

- [ ] Send three knowledge questions and verify grounded answers.
- [ ] Send a tour-intent message ("Can I book a tour next Tuesday at 10am?") and confirm the calendar booking flow opens or chat extracts a booking.
- [ ] Submit the lead capture form and verify a `leads` row, a `lead_activities` row, and CRM sync attempt are recorded.
- [ ] Book a tour through the calendar UI and confirm:
  - [ ] `tour_bookings` row inserted with `source = 'lumaleasing'`.
  - [ ] `calendar_events` row inserted with `sync_status = 'synced'`.
  - [ ] Google Calendar shows the event on the operator's calendar.
  - [ ] Confirmation email arrives at the prospect address with `.ics` attachment.
- [ ] Trigger human takeover from `/dashboard/lumaleasing` Conversations tab and confirm subsequent visitor messages return `isHumanMode: true` instead of an AI reply.
- [ ] Run the staging real-provider smoke from `LUMALEASING_LAUNCH_SMOKE.md` end to end.

## 7. Embed Rollout

Provide the client with the embed snippet from `/dashboard/lumaleasing` → Embed tab. Confirm:

- [ ] Allowed origins for the property domain are present in `LUMALEASING_ALLOWED_ORIGINS` (or production fallback is acceptable for now per ops runbook).
- [ ] Client domain CSP allows: `script-src` for the host, `connect-src` for the API origin, `img-src` for the logo host.
- [ ] Embed snippet is added to the property website pages where the widget should appear.
- [ ] Validate live embed loads `lumaleasing.js`, opens, and chats correctly from the property domain (not localhost).
- [ ] Confirm `Access-Control-Allow-Origin` matches the property domain in network response headers.

## 8. Activation

- [ ] Flip `lumaleasing_config.is_active = true`.
- [ ] Confirm the widget renders for an anonymous browser session.
- [ ] Notify the on-call rotation that a new property is live.
- [ ] Capture the launch artifacts in the property's onboarding ticket:
  - Embed snippet sent to client (with the date).
  - Staging smoke pass screenshot/log.
  - Booking row id, calendar event id, and confirmation email screenshot from the smoke.
  - Operator account that completed Google OAuth (for audit).

## 9. Post-Launch (First 7 Days)

- [ ] Daily review of `/dashboard/lumaleasing` Conversations and Recovery panel.
- [ ] Spot-check 5 chat conversations for hallucinations vs the document corpus.
- [ ] Verify daily tour reminder cron processed entries (`cron_job_runs` table).
- [ ] Verify weekly calendar watch renew cron succeeds.
- [ ] Confirm CRM appears to be receiving leads on the agreed cadence.
- [ ] Hold a 15-minute review with the operator and capture any onboarding gaps to feed back into this runbook.

## Off-Boarding / Pause

If a client pauses or churns:

- [ ] Set `lumaleasing_config.is_active = false` (kills the widget instantly).
- [ ] Optionally regenerate the API key so any cached embed stops authenticating.
- [ ] Disable Google Calendar/Gmail watches: `agent_calendars.sync_enabled = false`, `email_configurations.sync_enabled = false`.
- [ ] Cancel CRM mappings if applicable.
- [ ] Archive `documents` rows scoped to the property.
- [ ] Record the off-boarding date in the property's record.
