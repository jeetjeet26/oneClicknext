# LumaLeasing Production Ops Runbook

This runbook is the operations contract for running the LumaLeasing chatbot in production. It complements `LUMALEASING_LAUNCH_SMOKE.md` (validation) and `LUMALEASING_CLIENT_ONBOARDING.md` (per-client setup).

## Required Environment Variables

The following must be present in every environment that serves the public widget. Missing or wrong values are silent client-impacting failures.

| Variable | Scope | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | All | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` *or* `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | Browser-safe key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Used by widget routes via `createServiceClient`. |
| `OPENAI_API_KEY` | Server | Required for chat responses + embeddings. Without it `/api/lumaleasing/chat` will return 500. |
| `NEXT_PUBLIC_SITE_URL` (preferred) or `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_BASE_URL` | All | Server uses this to build OAuth redirect URLs. Must be HTTPS in prod. |
| `LUMALEASING_ALLOWED_ORIGINS` | Server | Comma-separated list of customer property domains permitted to call the widget endpoints. **In production, set this. The fallback is permissive and noted as a TODO in `utils/services/api-helpers.ts:134`.** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Server | OAuth client used for both Calendar and Gmail flows. Redirect URIs must include `${NEXT_PUBLIC_SITE_URL}/api/lumaleasing/calendar/callback` and `${NEXT_PUBLIC_SITE_URL}/api/lumaleasing/email/callback`. |
| `GOOGLE_CALENDAR_WEBHOOK_URL` | Server | Public HTTPS URL for Google Calendar push notifications (defaults to `${NEXT_PUBLIC_SITE_URL}/api/lumaleasing/calendar/webhook`). |
| `GMAIL_WATCH_TOPIC` | Server | Pub/Sub topic for Gmail push subscription. |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Server | Tour confirmation email + LumaLeasing operator notifications. Without it emails silently no-op. |
| `CRON_SECRET` | Server | Bearer used to authenticate scheduled cron callers. |
| `INTERNAL_API_KEY` | Server | Used for internal service-to-service auth (data engine, etc.). |

## Allowed Origins

Production deployments must set `LUMALEASING_ALLOWED_ORIGINS` to the comma-separated list of property websites permitted to embed the widget (no trailing slash).

```bash
LUMALEASING_ALLOWED_ORIGINS=https://www.sunsetridge.com,https://www.theparkway.com,https://lumaleasing-staging.example.com
```

The CORS helper falls back to `*` in production when this is unset (see `utils/services/api-helpers.ts:113`). That fallback is acceptable while you are still onboarding the first client, but it is a public-API security smell after that. Track removal of the fallback as a follow-up; until then this env var is the single source of truth for which origins can call the widget.

## Rate Limiting

The widget endpoints use an in-memory limiter (`utils/services/rate-limiter.ts`). It is per-process, so on multi-instance deployments the effective limit is (`limit` × instances). For the launch this is acceptable, but track these mitigations:

- Keep the public widget endpoints behind a CDN/edge with origin caching disabled but global rate limiting enabled (Vercel Firewall, Cloudflare WAF, or Edge middleware). Configure: 60 chat requests/minute/IP, 30 lead/tour POSTs/minute/IP.
- Move `chatLimiter`, `tourLimiter`, `leadLimiter`, `webhookLimiter`, `adminLimiter` to a shared store (Redis/Upstash) before scaling to multiple regions.

## Cron Schedules

`vercel.json` does not declare cron schedules — they must be configured externally. Recommended cadence (call each path with `Authorization: Bearer ${CRON_SECRET}`):

| Path | Cadence | Purpose |
|------|---------|---------|
| `/api/cron/calendar-watch-renew` | every 6 hours | Renews Google Calendar push subscriptions before TTL expiry. |
| `/api/cron/calendar-reconcile` | every hour | Backfills missing `calendar_events` rows and detects external drift. |
| `/api/cron/calendar-ingest` | every 15 minutes | Pulls remote calendar changes for two-way sync. |
| `/api/cron/gmail-sync` | every 5 minutes | Pulls Gmail thread updates and renews watch subscriptions. |
| `/api/cron/tour-reminders` (alias `/api/tours/reminders`) | every 15 minutes | Sends 24h and 1h tour reminders. |
| `/api/cron/calendar-watch-renew` failure alarm | depends | Page on-call if any run errors twice in a row. |

Configure these via the platform of choice (Vercel Cron in dashboard, GitHub Actions schedule, Render Cron, etc.). Do not rely on local-only cron.

## Health Checks

- `GET /api/health` returns `200` when Supabase is reachable, `degraded` if OpenAI key is missing, `500` if Supabase is down. Use this for uptime monitoring.
- Per-property health: `GET /api/lumaleasing/calendar/status?propertyId=…` and `GET /api/lumaleasing/email/status?propertyId=…` return blockers in `webhook_capability.blockers` when watches are stale.

## Logging Hygiene

Chat extraction now logs only structured presence flags (no extracted email/phone/notes). If you add new logs, follow this pattern:

- Log `propertyId`, `leadId`, `bookingId`, `sessionId`, `conversationId`, and structured booleans.
- Do not log `email`, `phone`, `first_name`, `last_name`, `content`, or extracted notes.
- For correlation, prefer the `requestId` injected by `createRequestContext` instead of free-form messages.

## Rollback Toggles

Use these in order of decreasing scope:

1. **Per-property kill switch:** set `lumaleasing_config.is_active = false`. The public config endpoint returns `403 widget_inactive`, and the embed renders nothing.
2. **Disable tour booking only:** set `lumaleasing_config.tours_enabled = false`. Chat continues, calendar/tour APIs return `404 tours_not_available`.
3. **Disconnect calendar:** set `agent_calendars.sync_enabled = false`. Bookings fall through to the "Calendar not connected" fallback path with the property's call-to-action.
4. **Rotate the embed key:** `POST /api/lumaleasing/admin/regenerate-key`. Old key returns `401 invalid_or_inactive_api_key`; client must update the embed snippet.
5. **Revert deploy:** standard hosting platform rollback. Run the launch smoke afterward to confirm the previous build still satisfies the criteria in `LUMALEASING_LAUNCH_SMOKE.md`.

## Monitoring Targets

Track these metrics per property at minimum. Anomalies should page on-call:

- `lumaleasing_chat` 5xx rate.
- `lumaleasing_chat` p95 latency (OpenAI dependency).
- 429 rate on `lumaleasing_chat`, `lumaleasing_lead`, `lumaleasing_tours`.
- Tour booking success rate vs `time_unavailable` / `calendar_unhealthy`.
- Calendar reconcile cron error count.
- Gmail sync cron error count.
- Resend send failures.
- OpenAI invocation cost trend.

## Incident Playbook (Quick Reference)

| Symptom | First Action |
|---------|--------------|
| Embed shows "Chat is temporarily unavailable" | Verify config endpoint reachable from client origin; check `LUMALEASING_ALLOWED_ORIGINS`. |
| Tour bookings return 503 calendar_unhealthy | Operator reconnects calendar in `/dashboard/lumaleasing` Tours tab. |
| Confirmation emails missing | Check Resend dashboard, verify `RESEND_API_KEY` and from-domain SPF/DKIM. |
| Chat returns generic answers | RAG knowledge base empty; ingest property docs via `/dashboard/luma`. |
| Calendar events missing for confirmed bookings | Run `/api/lumaleasing/calendar/reconcile` for the property; check `agent_calendars.token_status`. |
| Gmail threads stuck in `awaiting_internal_reply_overdue` | Use the LumaLeasingConfig "Repair Lifecycle" button or `/api/lumaleasing/email/threads/repair`. |
