# Phase 5 — CRM saved transfers and destination recovery

Local checkpoint, September 16, 2026. CRM and Phase 5 remain in progress.

## Implemented and locally verified

Lead and note transfers have immutable private source values, mapping/credential revision, stable request identity, origin, and links to shared jobs/action attempts. Shared summaries exclude contact values, credentials and note text. Manual requests require a separate approval of the exact saved payload. Current property membership, configuration, provider-capability evidence and source values are checked before a worker can write. Read/schema setup checks alone never activate delivery.

A worker records duplicate search, then a single write intent before calling a provider. Repeated claims, uncertain intent acknowledgments and lost completion replies cannot authorize another write. A confirmed record link or note ID is saved atomically with the lead projection and job/action result. Unconfirmed provider acknowledgments remain held. Existing adapters default to unverified acknowledgments until explicitly qualified.

Operators can reopen the exact saved values, stop a queued/searching transfer, and recover a private destination check after an interrupted reply. Recovery reads the original connection and frozen contact values. It rejects conflicting contacts/destinations and unsafe record IDs, and requires explicit review of the exact saved evidence. No-match evidence never authorizes a resend. Reconciliation confirms an existing destination link; it does not claim the original write succeeded. A lead lookup cannot prove note delivery. Original uncertain receipts remain immutable. Late conflicting worker receipts restore the hold and cannot silently replace a link. Credential replacement remains held while a write is unfinished or uncertain.

Old Python direct lead/note/bulk writes and web direct replay/requeue paths are closed. SiteForge callers use their saved source-event identity; manual lead changes prepare an operator review. The scheduled worker selects eligible saved transfers, never legacy lead-status backlogs. Callers read durable confirmation receipts before reporting success. Skipped/unqualified notes are not reported as delivered. Source products own note persistence so CRM retries cannot append duplicate local notes.

The console provides paginated saved transfers, exact-value review, outcome distinctions, saved recovery evidence and honest concurrent-stop results. Shared semantic history records human request/approval/stop/result/recovery actions. Trusted system origins are retained privately without inventing a human actor. Training eligibility remains false.

## Local schema parity

Regenerating types exposed five older tables missing from the local database despite their repository migrations: execution budgets/events, governed component registry/versions and editor attachments. Existing migrations 20260818063834, 20260818162042, 20260819005833, 20260819005910 and the subsequent signature migration 20260819012515 were applied locally. No generator, budget expenditure or provider operation was run.

Read-only hosted metadata from the confirmed oneClick project established that bedroom preferences are text and artifact hashes/timestamps are non-null. Migration 20260917030254 aligns these local contracts without inventing artifact hashes. It also restricts restored service policies, removes inherited browser attachment-write grants and avoids per-row identity checks. Organization-isolated attachment reads and textual preferences are verified with rollback-only fixtures. Schema types are regenerated from the repaired local database, stamped to the current migration, with explicit nullable RPC arguments matching the saved SQL contracts. Local PostgREST is v14.16. No hosted schema was changed.

## Verification

- 95 web service/API cases across 12 suites.
- 58 Python CRM cases plus 18 HTTP transport cases.
- 75 delivery/recovery SQL assertions; 59 setup, 57 tour history, 57 BrandForge, 70 LeadPulse and nine schema/access assertions: 327 in total. Fixtures roll back.
- Twelve combined browser/persistence journeys across CRM setup and delivery. The six delivery journeys were rechecked after final capability and wording changes. Simultaneous calls produce one claim, one write intent and one completion. Provider responses are simulated; screenshots inspected.
- Full web type checking, schema/type version check and targeted lint pass.
- 89 saved function bodies match the local database. No retained verification fixtures or newly stamped migration-history entries.
- Local advisor WARN/ERROR findings fell from 1,365 to 1,333 after restoring intended access restrictions: 32 removed, none added; ten retained findings changed affected-policy details. Existing findings are not considered resolved by this checkpoint.

Migration 20260917015302 and 20260917030254 are applied only locally. Ship compatible schema, web and worker changes together at the existing release gate. No provider send/validation, hosted write, deployment, backlog replay, commit, push, training or training export occurred. Outbound delivery stays paused.

Saved bulk selection, exact approval, stopping and partial-result recovery are now locally verified in [CRM bulk work](PHASE_5_CRM_BULK.md). The new selection never expands after review.

## Remaining gates

Provider-specific activation/qualification and explicit acknowledgment/read/cleanup capabilities, uncertain-note evidence and conflicting-destination resolution, reviewed legacy links/account transfer, monitor replacement, and comprehensive source/system/interaction coverage remain open. The older exported monitor is not qualified by this work. Real client acceptance stays deferred while independent local development continues. Then complete the other retained products in P11_PRODUCT_READINESS.md and the agency permission/budget/intervention/outcome gates. Existing models remain the default; training requires a measured need and eligible evidence.
