# LumaLeasing Launch Smoke Runbook

This runbook is the gate for promoting the LumaLeasing chatbot to a paying client. It covers the deterministic local smoke and the opt-in real-provider smoke that exercises Google Calendar, Gmail, OpenAI, and the public widget endpoints with a live property API key.

Run both modes from `p11-platform/apps/web` unless noted otherwise.

## When To Run This

- Before flipping a property's `lumaleasing_config.is_active` to `true` in production.
- Before issuing or rotating an embed API key for a new client.
- After any deploy that touches `app/api/lumaleasing/**`, `utils/services/lumaleasing-*`, `utils/services/google-calendar.ts`, `utils/services/gmail-service.ts`, `utils/services/lumaleasing-tour-booking.ts`, `public/lumaleasing.js`, or `components/lumaleasing/**`.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Property record | Exists in `properties` and the operator has organization access. |
| `lumaleasing_config` row | `is_active = true`, `tours_enabled = true`, `business_hours` populated, branding fields filled in. |
| RAG corpus | At least a few rows in `documents` for the property (FAQ, floor plans, pet policy). Use the dashboard `/dashboard/luma` document upload flow. |
| Google Calendar | Connected through `/dashboard/lumaleasing` Tours tab. Status reads `connected: true`, `token_status: 'healthy'`, `webhook_capability.ready: true`. |
| Gmail (optional) | Connected through `/dashboard/lumaleasing` Leads tab. Status reads `connected: true`, `token_status: 'healthy'`. |
| Resend | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` configured for the environment. |
| OpenAI | `OPENAI_API_KEY` configured. |

## Mode 1 — Deterministic Local Smoke

Local Supabase is seeded with `local-luma-demo-key`, a future tour slot at `2099-01-15T10:00`, and one document. This proves the public endpoints, validation, rate limits, RLS shape, and seed-driven behavior without consuming third-party API quota.

```bash
cd p11-platform
npm run supabase:reset
npm run local:start &
cd apps/web
npm run test:smoke -- --grep "seeded LumaLeasing tour availability"
```

Expected result: a single passing Playwright test that confirms the seeded tour slot is returned. If this fails, do not proceed; the local stack is broken and any follow-on assertions will be misleading.

## Mode 2 — Opt-In Real-Provider Smoke

This exercises the full LumaLeasing happy path against the staging environment using a real property API key, real Google OAuth tokens, and real OpenAI calls. It must pass before production launch.

### Required Env

```bash
export LUMALEASING_REAL_SMOKE=1
export LUMALEASING_REAL_SMOKE_API_KEY="luma_<staging-key>"
export PLAYWRIGHT_BASE_URL="https://staging.example.com"
export E2E_LOGIN_EMAIL="<staging-operator-email>"
export E2E_LOGIN_PASSWORD="<staging-operator-password>"
```

### Run

```bash
cd p11-platform/apps/web
npm run test:smoke -- --grep "lumaleasing provider-backed status and booking flow"
```

### What The Test Asserts

1. `GET /api/lumaleasing/calendar/status?propertyId=…` returns `connected: true`, `token_status: 'healthy'`, `calendar_sync.degraded` is not `true`.
2. `GET /api/lumaleasing/email/status?propertyId=…` returns `connected: true`, `token_status: 'healthy'`.
3. `GET /api/lumaleasing/tours?startDate=…&endDate=…` returns at least one available slot for the next 14 days.
4. `POST /api/lumaleasing/tours` with that slot returns `success: true`, `booking.status: 'confirmed'`, and Calendly-style add-to-calendar links plus an `.ics` download URL.
5. `GET /api/lumaleasing/config` (the same endpoint `lumaleasing.js` calls first) returns a populated config payload.
6. `POST /api/lumaleasing/chat` returns a non-empty `content`, a `sessionId`, and the conversation persists.
7. `POST /api/lumaleasing/lead` succeeds, returns a `leadId`, and the lead lands in CRM/workflow side effects (verified out-of-band; see post-checks).

### Manual Post-Checks

After the automated assertions pass:

- Confirm the booked tour shows up on the connected Google Calendar.
- Confirm the prospect email receives the confirmation with the `.ics` attachment.
- Confirm a row appears in `tour_bookings`, `lead_activities` (with `type='tour_booked'`), and `calendar_events`.
- Confirm the smoke lead appears in the connected CRM if CRM mapping is configured for the property.
- Visit `/lumaleasing/demo?apiKey=$LUMALEASING_REAL_SMOKE_API_KEY` on staging and confirm the embedded widget loads via `lumaleasing.js`, not the React preview component.
- Hit `Esc` while the chat dialog is open and confirm it closes (accessibility regression check).

## Failure Triage

| Symptom | Likely Cause | First Action |
|---------|--------------|--------------|
| `connected: false` on calendar/email status | Operator never finished OAuth, or token revoked. | Reconnect via `/dashboard/lumaleasing`. |
| `webhook_capability.ready: false` with `blockers` containing `missing_watch_expiration` | Watch never registered or expired. | Run `/api/cron/calendar-watch-renew` once with `CRON_SECRET`, then recheck. |
| Tour booking returns `503 calendar_unhealthy` | Token expired or quota issue. | Reconnect calendar; check Google Cloud quota. |
| Tour booking returns `409 time_unavailable` | Calendar shows the slot busy. | Confirm with operator; pick a fresh slot. |
| Chat returns 401 | API key inactive. | Verify `lumaleasing_config.is_active`. |
| Chat returns 429 | Rate limit hit during repeated runs. | Wait 60 seconds or reduce smoke concurrency. |
| Confirmation email never arrives | Resend not configured or delivery rejected. | Verify `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, recipient domain. |

## Sign-Off Criteria

Both modes must pass within 24 hours of go-live. Capture:

- Run timestamp and operator name.
- The Playwright report (`playwright-report/index.html`).
- The Google Calendar invitation screenshot.
- The booking row id from `tour_bookings`.

Store these in the property's onboarding ticket so the launch can be unambiguously traced.
