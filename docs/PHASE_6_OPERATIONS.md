# Phase 6 schedules, alerts and recovery

The configured schedule is an invocation plan, not evidence that a job is active or completing useful work. Local runtime/delivery holds remain. Monitoring preferences do not activate workers. No scheduler, reminder, external alert, publication, provider call or backlog replay was enabled during this phase.

## Current Vercel invocation inventory

| Route | Configured invocation |
|---|---|
| `/api/workflows/process` | Every 10 minutes |
| `/api/cron/sync-reviews` | Hourly |
| `/api/cron/process-publications` | Every 15 minutes |
| `/api/cron/process-forgestudio-media` | Every 5 minutes |
| `/api/cron/sync-forgestudio-metrics` | Hourly at :15 |
| `/api/tours/reminders` | Every 15 minutes |
| `/api/cron/sync-ads` | Every 6 hours |
| `/api/tours/noshow` | Hourly |
| `/api/reports/send` | Every 30 minutes |
| `/api/cron/knowledge-refresh` | Every 6 hours |
| `/api/cron/scrape-competitors` | Hourly |
| `/api/cron/crm-sync` | Every 10 minutes |
| `/api/cron/siteforge-production-health` | Every 15 minutes |
| `/api/cron/siteforge-outbox` | Every minute |
| `/api/cron/siteforge-analytics` | Hourly at :05 |
| `/api/cron/integration-authorizations` | Every 5 minutes |
| `/api/cron/process-review-analysis` | Every 5 minutes |

Actual business cycles can be longer: knowledge refresh supports 24–168 hour intervals, competitor preferences include weekly/manual behavior, and retained reports include monthly delivery. Monthly UTC scheduling and year rollover are tested; the observation checker uses calendar boundaries rather than pretending every month is 30 days. A six-hour poll does not prove a monthly report cycle.

Calendar ingest/reconcile/watch renewal, Gmail/thread lifecycle, MarketVision brand/source/extraction workers and the old publish-scheduled endpoint are not all registered in this Vercel list. Their code/configuration must not be described as deployed schedules. The old nested Render calendar-health job was invalid Blueprint structure and was removed; any replacement needs a separately reviewed service using current credential claims. Do not activate legacy token writers as a shortcut. The GitHub daily pipeline configuration is a separate invocation surface, with its existing activation condition preserved.

`operations.py inventory` hashes route/config/test references. `qualify` accepts dated run evidence and refuses to call held, failed, incomplete, stale or missing intervals a completed cycle. Configuration changes invalidate the observation window. A saved completion receipt is required; business outcomes are not inferred from a timer or HTTP 200. This tool does not schedule, execute or notify anyone.

The internal `/api/cron/runs` ledger can include multiple organizations. It now requires an authenticated admin explicitly listed in server-side `P11_OPERATIONS_ADMIN_IDS`; a tenant admin/manager role alone is insufficient. No list was configured in hosted systems. Client product histories continue through their own scoped endpoints. Review-source scheduling now refuses to fetch without its start record and returns an explicit unconfirmed result if completion cannot be saved. Focused tests cover both failures without a second provider invocation.

## Observed production issues

A fresh read-only check at 2026-09-24T20:15:57.66334+00:00 narrowed the previously unclassified failures. The preceding 35-day window contained:

| Job | Observed failure | Local candidate / hosted acceptance |
|---|---|---|
| Knowledge refresh | 140 failures explicitly requiring `INTERNAL_API_KEY` | The candidate already uses retained website capture decisions without that legacy internal call. Qualify the coordinated schema/application release; adding an obsolete key is not the candidate fix. |
| Competitor scraping | 35 responses containing `Not Found` | The candidate calls authenticated `POST /scraper/refresh-pricing`, which is registered by the local Python service. The hosted response alone does not establish whether the old caller path, service version or routing is responsible; verify the actual deployed caller/service pair before release. |
| SiteForge health | 3,360 failures explicitly reporting an unverified `p11.com` email sender domain | Configure and verify the intended sender in the correct email-provider account during hosted acceptance. New local handling records explicit rejections as blocked, preserves monitoring progress and does not resend automatically. No domain or sender was changed. |
| Review sync | 133 older unknown-connection failures and 13 later request timeouts; 694 stored successes | The unknown failures were last recorded August 26 in this window. The timeout cases still need deployed-service diagnosis; no sync or backlog was replayed. Stored success alone does not prove downstream delivery. |

The refreshed production snapshot still contains 2,858 catalog objects and 155 migrations and matches the earlier Phase 6 snapshot: zero intervening structural/history differences. This is a production-to-production comparison; the documented production-to-local differences remain. No `pg_cron` job table was present in the original captured project.

### September 24 alert follow-through

Explicit setup, sender-domain, recipient-resolution and non-acceptance errors now retain a safe reason code and a plain-language explanation. Raw provider text, addresses and URLs are not copied into new failure records or rendered by the explanation component. Existing historical records are preserved. A blocked incident stays held during repeated observations; ambiguous/network/server/idempotency outcomes remain unconfirmed. Changing configuration alone does not authorize or replay existing held alerts.

Manager lookup failures no longer silently omit a recipient. One strict provider batch requires a distinct nonempty message receipt for every selected recipient; a set larger than the provider's 100-message batch limit is held before sending. Email acceptance still does not establish recipient receipt. The provider distinctions follow the [documented error responses](https://resend.com/docs/api-reference/errors) and [strict batch contract](https://resend.com/docs/api-reference/emails/send-batch-emails).

The health scheduler now requires the exact completion write to succeed through `confirmCronJobRun`, instead of accepting any completed row found by a later read. Held email outcomes leave the monitoring summary partial and allow other website checks to continue. Database read/claim failures still stop delivery before an unrecorded send.

Qualification passed: 51 focused unit tests, three opt-in local database cases with mocked delivery, two stored-incident browser journeys (including desktop and 390px phone), full TypeScript and changed-file lint. The stored incident survived repeated checks without another send; historical unconfirmed display remains compatible. Browser fixtures were removed. No outbound call, credential change, scheduler activation, production write or deployment occurred. The separate ReviewFlow response SQL suite was not involved. The original full Phase 6 regression/build evidence predates this bounded follow-through; its affected paths have the focused evidence above.

Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase6-alerts/` (`production-snapshot.json`, `production-drift.json`, `unit.log`, `local-database-verified.log`, `browser.log`, `typecheck-final.log`, `lint.log`). Earlier runner-path/startup failures are retained separately. Existing-model/training, client retention and live monthly-cycle gates remain open.

Candidate alert/recovery controls have local unit/SQL/browser evidence, including SiteForge incidents, MarketVision alerts, BI reports and schedule receipts. The diagnosed production failures still require deployment-specific correction and acceptance after the coordinated release; a synthetic pass cannot close them. Verify an actual operator-visible alert and its resolution for each required failure path during the permitted observation window. No external notification was sent here.

## Independent restore trials

The database trial restored a production-schema upgrade with synthetic legacy data into a new database and matched 388 table fingerprints/42 rows across public/private/auth/storage. Unknown marketing account/currency values stayed unknown and exact metrics survived. The 5,355,565-byte local backup took about 0.4 seconds to create and 2.907 seconds to restore. These are fixture measurements, not a service commitment or provider recovery objective.

The separate WordPress trial backed up DB, configuration and wp-content; intentionally broke page/meta/settings/media/theme behavior to HTTP 503; and restored HTTP 200 with all 448 content files matching. Desktop and 390px mobile browser checks verified styling, image loading and navigation without horizontal overflow. The first fixture-URL failure and its correction are retained. No client Cloudways site, DNS, TLS, mail or public release was involved.

Before a real restore, confirm the exact scope/backup hash, keep workers and serving quarantined, restore into an isolated target, compare retained content and schema, apply deletion tombstones, test access boundaries and provider bindings, then obtain the release-specific decision. Do not infer that a database-only restore also recovers private object bytes or a website filesystem.

Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase6/schedule-inventory-final.json`, `database-restore-progress.json`, `website/qualified-http.json`, `search-path-trial.log` and the browser/unit logs. The longest candidate live cycle remains **unobserved**, so the Phase 6 gate is open.
