# Phase 4 — chatbot and GEO reliability

Updated September 15, 2026 (Pacific). **Local Phase 4 implementation and qualification are complete. Real-client/provider acceptance and hosted release remain pending, as explicitly deferred by the owner.** This is the continuation of the entire phase, not just the earlier transcript-recovery increment. Phase 3 acceptance remains unchanged.

## Delivered locally

| Area | Result |
| --- | --- |
| Widget recovery and isolation | Stable request identities survive lost responses; simultaneous retries produce one saved result. Replays recheck active widget keys and session expiry. Sessions, conversations, history, leads and tours retain property scope. Existing latest-200-message recovery, draft preservation and expiry handling remain. |
| Human takeover and leads | Assistant-message insertion checks human mode under the conversation lock. Lead matching and the pending CRM handoff are saved transactionally; configured active workflows are enrolled once on creation. Contact capture no longer issues an unobserved duplicate request. |
| Tours and delivery | Reservation, capacity accounting, activity and confirmation job commit together. The visitor sees a saved reservation with confirmations pending. A leased worker checkpoints calendar and email receipts, uses stable provider identities, and preserves the original booking and calendar destination. |
| Common failures | Delivery retries are bounded; accepted stages are retained. Changed bookings/calendar destinations and ambiguous Microsoft or interrupted CRM writes stop for reconciliation instead of blindly repeating external effects. CRM state writes are fenced to the worker lease. Delivery remains paused by default. |
| Public limits and usage | Mutation admission uses shared property and actor limits, plus a 24 KB streamed request bound. Public reads, including calendar availability, have shared limits. Every chatbot completion reserves a conservative daily allowance before its provider call; context/history, output and request time are bounded. These units are not a measured provider bill. |
| Grounding and freshness | Chatbot context is built from property records and scoped source excerpts instead of having a model rewrite the verified fact set. Old, missing or future freshness timestamps degrade factual answering. Website refresh atomically swaps chunks and source metadata, invalidates context, and keeps failed/stuck regeneration eligible for retry. |
| GEO recovery | Explicitly enrolled jobs save immutable work manifests, item identities, attempts, leases and completed results. Interrupted work resumes without redoing completed items. Answer, citations and item completion commit together. Existing legacy jobs are not silently enrolled or replayed. |
| GEO limits and honest results | Up to four active measurement leases globally, one per surface; each item has three saved attempts. Provider calls are asynchronous and bounded, SDK retries are disabled, and model outputs are capped. Failed extraction is an incomplete measurement, not measured absence. Partial runs retain evidence and coverage but do not masquerade as completed measurements. Reports identify incomplete selected runs. |
| Recommendations | A separate, leased batch queue waits for terminal measurements and a completed crawl, then retries up to three times. Only observed finding IDs, tracked prompts and observed page URLs support recommendations. Frozen query text and paged evidence reads preserve the measured context. New recommendations and prior-generation retirement commit atomically. |
| Maintenance | Knowledge and competitor refreshes use persisted leases, fair ordering and failure backoff. Scheduler outcomes require saved receipts; partial scraping does not advance successful freshness. Competitor calls use the authenticated property-specific endpoint. |
| Console | LumaLeasing and PropertyAudit show property-scoped operations status, pending/review work, coverage, maintenance and reserved usage. Status outages remain visible errors. Property switches discard previous data; placeholder properties are not displayed as clients. Fabricated chatbot growth percentages were removed; both pages were checked on a 390px screen. |
| Website fetching | Node and Python validate public DNS answers and pin the destination socket, revalidate redirects and cap time, size and hops. The browser scraper routes requests through the same guarded transport, blocks service workers and external streaming channels, and has no unrestricted proxy fallback. |

## Concrete bounds and scheduling

- Widget writes: 120 new requests/property/minute and 20/actor/minute. Public reads: 600/property/minute and 120/actor/minute. Property caps still hold if visitor headers change. Completed request replays do not spend another model reservation.
- Chatbot allowance: `LUMALEASING_DAILY_TOKEN_ALLOWANCE`, default 1,000,000 conservative token units/property/UTC day. Reservations remain consumed after an uncertain provider result. Main response, extraction and summary outputs are bounded separately. Live cost and response quality still require observation.
- GEO enrollment: at most 24 runs/property/24 hours and 300 executions/run, with 1–5 repeats/query. Measurement lease: 180 seconds; logical attempt deadline: 120 seconds; SDK provider calls: 45 seconds. Gemini's existing bounded rate-limit handling remains inside the outer attempt deadline. A separate global analysis lease bounds recommendation generation. These are work/concurrency limits, not a dollar estimate.
- Tour delivery: at most three saved attempts, ten-minute retry delay, and a 23-hour automatic retry window. Missing or ambiguous receipts remain visible for reconciliation. Provider acceptance is distinct from inbox delivery or client acceptance.
- Both checked-in Vercel configurations schedule knowledge checks every six hours, CRM/workflows every ten minutes, and competitor checks hourly. Knowledge normally becomes due after seven days; failed context rebuilds also remain eligible. Competitor configuration determines hourly/daily/weekly eligibility. Each maintenance invocation claims at most five items, ordered by last attempt. **These are verified configuration and local outcome contracts; actual production scheduler firing has not been observed in this phase.**
- The data-engine worker is controlled by `PROPERTYAUDIT_WORKER_ENABLED`; `SITEAUDIT_ANALYST_ENABLED=false` also pauses its recommendation work. The provider clients now yield to cancellation instead of blocking through ten-minute requests.

## Verification

| Evidence | Result |
| --- | --- |
| Web unit/route/service/report suite | 353 passed across 64 files |
| Python workers, providers, crawler, URLs and recommendations | 70 passed |
| Chromium journeys | 14 distinct scenarios passed: ten widget and four operations-panel journeys; the final four were rerun after page-loading/mobile refinements |
| Actual local API concurrency | 10 assertions passed; repeated chat saved one message, simultaneous contact capture produced one lead with a pending CRM handoff, and revoked keys could not replay saved responses |
| Actual local PostgreSQL contracts | 59 assertions in a rollback-only transaction passed, including leases, duplicate reservations, atomic replacement, explicit partial coverage, recommendation recovery and denied browser/anonymous privileges |
| Full web type check | Passed |
| Affected-file lint | Zero errors; 19 warnings remain in existing dashboard/widget/test code |
| Database advisors | 1,386 warnings, unchanged from the prior baseline; zero new warnings and zero errors |
| Fixture cleanup | API fixture property, leads, sessions, messages and append-only profile rows removed; SQL fixtures rolled back |

Advisor information notices include seven service-only tables with RLS and no browser policies. This is intentional deny-by-default: browser/public privileges and function execution were revoked, and actual role checks passed. The two unused-index notices concern new indexes without production traffic. See [Supabase's RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) and [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). The pre-existing database warnings have not been represented as fixed.

Evidence is retained in `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-four-completion/`: `web-final-verified.log`, `python-release.log`, `browser-release.log`, `browser-final-verified.log`, `types-complete.log`, lint logs, `local-api.json`, `database-contract.sql`, `database-release.log`, `advisor-comparison.json`, source snapshots and the install manifest. Test cases use provider fixtures; no LLM, CRM, calendar or real-recipient send was used for acceptance. Early failed trials are retained, including an SQL variable collision and test fixtures that still mocked the old transport. Both were corrected and reverified.

## Release and deferred acceptance

The migration was generated through the Supabase CLI and iteratively applied only to local PostgreSQL:

`p11-platform/supabase/migrations/20260916011315_phase_four_durable_operations.sql`

An authorized hosted release must apply the migration before enabling the matching web/data-engine code and worker. Preserve `OUTBOUND_DELIVERY_PAUSED=true` during target qualification. The new RPC types live in a scoped extension, leaving the earlier shared generated snapshot intact. Inspect deployed environment variables, service-role permissions, worker liveness and actual scheduling at that time. Earlier queued/running GEO work remains a separate review decision.

Outstanding real-target gates:

1. Install the widget on the authorized website and confirm client-approved property facts, knowledge sources, freshness cadence, answer quality and takeover behavior.
2. Connect/revoke/reconnect the intended calendar and CRM; confirm the exact recipient and workflow settings, then reconcile calendar, CRM and email receipts. Exercise the provider-specific unknown-outcome cases before enabling automatic delivery.
3. Observe scheduled knowledge/pricing work and recovery on the hosted runtime; measure latency, actual provider usage/cost, deliverability and correction effort.
4. Obtain client acceptance and approve the hosted release. This has not happened merely because local checks passed.

No commit, push, hosted migration, deployment, real message or legacy backlog replay was performed. Phase 5 can proceed independently when requested; Phase 4's operational acceptance gate remains open until the connected journeys above are verified.

The [first-pass record](history/phase-4-first-pass-2026-09-15.md) preserves the earlier narrower scope and its dated evidence. Do not add its overlapping test totals to the current qualification counts.
