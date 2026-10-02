# Phase 5 — reviewed account replacement

September 16, 2026. Implemented and qualified locally. Phase 5 remains active across all retained products.

## What is now available

The LumaLeasing Integrations tab and its email/calendar settings provide **Replace connected account**. An operator reviews the current account, linked history and unfinished work, chooses Google or Microsoft, enters the intended new account, and acknowledges the history policy. The decision is recorded before authorization starts; a lost decision response can recover the same request on retry. The current account remains in place until matching authorization is saved successfully.

Replacement is one account type at a time. Scheduled/confirmed tours, queued/running/uncertain calendar deliveries (including legacy delivery jobs), and unresolved email conversations hold replacement. The saved review is checked before code exchange and again at final save. New work, renewed credentials, changed membership, expired authority or a different authorized account prevents the switch. Only the authenticated operator can use this authority; external invitation links cannot inherit it or expand access.

The new account receives a new connection identity. The old connection is retired, its stored tokens are cleared, and syncing is disabled. Calendar events and mail threads remain attached to their original account; the database rejects relabeling that retired history or reactivating its credentials. Future email configuration is rebound atomically. Calendar scheduling preferences are preserved, while provider event IDs, mailbox cursors and old signatures are not transferred. Same-account reconnection continues to use the current connection.

Email replies check that their thread/message belong to the current mailbox before duplicate reconciliation or sending. A reply to retired history directs the operator to start a new message from the current account. A delayed calendar watch response cannot save against a replaced, disabled or changed connection, and unauthorized watch recovery is bounded to one retry.

## Action evidence and learning

`integration.replacement.requested` records the authenticated decision and applied/held result. `integration.account.replaced` records a completed switch or a held outcome encountered during the saved authorization. Source/replacement references, provider, capability, history policy and before/after evidence are retained; account addresses, provider credentials and raw provider errors are excluded from shared replacement history. The private decision ledger retains the intended account for final identity verification.

Connection retirement, insertion, future-work binding, completed authorization and action evidence commit or roll back together. Lost final responses replay without another account or action. Records remain **training ineligible**. This adds reliable examples and outcomes for future evaluation; no training or dataset export was started.

## Verification

- 173 service/API checks across 20 affected suites, including five calendar-watch checks.
- 353 local PostgreSQL assertions across eight suites, including 65 account-replacement checks.
- Eight distinct browser journeys: three replacement journeys plus five email/calendar management regressions. The three replacement journeys passed again after final changes.
- Full application type checks and changed-file lint checks passed; whitespace checks passed.
- Local database advisors remain at 1,386 existing WARN/ERROR findings, with no additions.
- All 15 function bodies in the final migration match the local database. Verification fixture properties were removed.

Browser qualification used actual local authenticated routes, database transactions and rendered pages. Successful replacement used synthetic provider evidence passed to the real local authorization transaction; **live Google/Microsoft consent and provider acceptance are not claimed**. The ordinary preview remains available at http://127.0.0.1:9430 with delivery paused and no temporary credential configuration.

## Local schema and release boundary

Migration: `p11-platform/supabase/migrations/20260916184945_phase_five_account_replacement.sql`. It adds the private replacement decision ledger, retirement state/constraints, current-account uniqueness, reviewed authorization checks, history protection and private reply-binding validation. It is applied only to the local schema; migration history and hosted schema are unchanged. The API, current-account filters and schema require coordinated rollout. Narrow service types are used until the planned full generated-type reconciliation.

No hosted migration, deployment, provider send, backlog replay, commit/push, paid training or data export occurred.

## Remaining work

This is replacement **after unfinished work is resolved**. It does not transfer active bookings or mailbox conversations between providers, revoke credentials at the provider, or prove live provider health. Active-booking migration/rebinding, restoration/manual calendar binding and legacy delivery reconciliation remain explicit work. A new message under a replacement mailbox is a new conversation; old provider identifiers must never be reused as if they were transferable.

Next: complete remaining authorization outcome capture (including cancellation/denial and other failed flows), then the remaining provider/scope/tenant and restoration/binding work, TourSpark journeys, every other retained product, and comprehensive user/system action coverage. Real-client acceptance stays deferred while independent local work proceeds. Phase 6 schema/history/type reconciliation and Phase 7 bounded autonomy remain gated on product evidence; existing models are the default.
