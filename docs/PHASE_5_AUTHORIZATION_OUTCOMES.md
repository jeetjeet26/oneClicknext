# Phase 5 — authorization outcomes

September 16, 2026. Locally qualified; Phase 5 remains active across all retained products.

## What changed

Saving a connection request now records its start. Signed cancellations, provider rejection, missing permissions, unconfirmed account identity, failed saves, changed membership/connection/invitation state and abandoned requests have durable outcomes. Existing calendar and mailbox connections stay intact when an authorization fails.

A request can exchange its authorization code once. Only the worker that received the private claim token can close an active exchange with a provider failure. Concurrent or repeated callbacks converge on the saved outcome. A delayed denial cannot overwrite success; when both final save acknowledgements are lost, the callback recovers the committed result without another provider exchange. If the activity record cannot be saved, the request transition rolls back and the user sees an unconfirmed result.

Activity history names the outcome and gives recovery guidance. It distinguishes the operator, invited account, sponsoring operator and background cleanup. Public cancellation returns to a readable recovery page. Opening the public result page without a recognized outcome no longer claims authorization completed. These query-based return messages remain presentation; they are not independent proof of an account's current status.

## Action evidence and learning

`integration.authorization.started`, `integration.authorization.cancelled` and `integration.authorization.failed` extend the existing completion and account-replacement actions. A deterministic start event and terminal event share the saved request's episode. Organization, property, initiating actor and exact authorization context are pinned. Membership loss can therefore be recorded against the original request without granting any new authority.

Shared evidence retains bounded reasons, provider/capabilities, request/invitation/replacement references and outcome source. It excludes credentials, authorization codes, signed state, invitation token hashes, account addresses and raw provider error details. The activity API exposes only the failure reason needed by the interface. Invalid or unsigned callbacks cannot invent an attributed user action.

All records remain training ineligible. Cancellation, policy holds, permission rejection and network uncertainty are distinct outcomes; they must not be collapsed into automatic negative rewards. Existing models and offline evaluation remain the default. No training data was exported and no model was trained.

## Bounded expiry and migration

The private expiry operation closes at most 100 expired requests per run. A single sweep lock and nonblocking property locks prevent overlapping cleanup from interrupting active work. Skipped/remaining work is explicit, and later runs can continue. Request changes and their action records share one transaction.

`/api/cron/integration-authorizations` requires the exact configured Bearer secret. It requires a saved run record before work, and a confirmed completion record before reporting a clean run. Local schedule configuration runs every five minutes; **it is not deployed or active in hosted scheduling**. It does not contact providers or send anything.

Migration: `p11-platform/supabase/migrations/20260916201655_phase_five_authorization_outcomes.sql`. New functions are private to service-role execution and use an explicit empty search path. Historical origin is backfilled only from an existing confirmed event. Old in-flight requests without provable origin are held at migration cutover and require a fresh request; no historical action or tenant identity is fabricated. Legacy evidence completeness remains a release reconciliation task.

The migration is applied only to the local database. Migration history and hosted schema are unchanged. API/worker/schema changes require coordinated release, followed by the planned generated-type and migration-history reconciliation.

## Verification

- 252 service/API checks across 19 suites.
- 13 actual local callback/service/database journeys across two suites, including nine new outcome journeys. Provider responses were simulated; unexpected external traffic was rejected.
- 430 PostgreSQL assertions across nine rollback-only suites, including 77 new lifecycle checks.
- Eight separate-session concurrency checks: busy sweeps, busy properties, later recovery and simultaneous conflicting callbacks.
- Eight distinct browser journeys: five authorization journeys, including real pagination across 55 saved requests, and three account-replacement regressions. The four original authorization journeys passed again after final presentation changes; pagination passed on the restored ordinary preview.
- Full application type checking, changed-file lint and whitespace validation passed.
- Local advisors remain at 1,386 existing WARN/ERROR findings, with no additions.
- All nine migration function bodies match the local database; fixture properties and failure-injection triggers were removed.

The browser checks caught a local preview return URL pointing at a different port. The preview now uses its actual local address. The ordinary preview is restored at http://127.0.0.1:9430 with delivery paused and temporary signing/provider settings removed. The dedicated agent-browser CLI was unavailable; the installed Playwright runtime supplied page, error-overlay, interaction and screenshot verification.

Live Google/Microsoft consent, token exchanges, revocation and provider acceptance are not claimed. No hosted migration, deployment, provider send, backlog replay, commit/push, training or data export occurred.

## Remaining Phase 5 work

Next: qualify existing/renewed grants and account/tenant scope health, then calendar restoration/manual binding and changed-duration adoption, active-work transfer/rebinding and legacy delivery reconciliation. Continue the remaining TourSpark and every other retained product journey with meaningful action/result coverage. Public viewing/copying, pre-request validation failures and broader automated/interaction capture remain open.

Real-client acceptance remains deferred while independent local work proceeds. This increment does not complete Integrations, TourSpark, Phase 5 or agency-wide autonomy. Phase 6 platform/schema qualification and Phase 7 bounded autonomy retain their evidence gates.
