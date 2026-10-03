> Historical first-pass record, superseded by ../PHASE_4_CHATBOT_GEO.md for current status.

# Phase 4 — chatbot and GEO reliability

September 15, 2026. **Phase 4 is active; this first local reliability pass is complete.** The owner explicitly directed work to advance and said real-client acceptance can wait. SiteForge Phase 3 retains its acceptance ledger; the earlier instruction not to advance automatically is superseded by this explicit decision. Hosted releases and real external sends remain separate target-specific steps.

## Implemented and verified locally

### LumaLeasing conversation recovery

- A temporary transcript error or rate limit retains the saved session. Only a confirmed missing/expired session resets it. Chat automatically retries once only for a typed missing/expired-session response; ordinary validation and storage failures no longer silently create another conversation.
- History now returns the latest 200 visitor/assistant messages in reading order, using creation time and ID as stable ordering keys. It reports whether earlier messages exist. Previously it returned the earliest 200 and stopped exposing subsequent human replies. This remains a bounded recent transcript, not a complete transcript export.
- Polling detects changed message identity/content even when the returned count remains 200, preserves an in-progress draft, continues after transient failures and avoids overlapping polls. A reset, destruction or newer message invalidates an older in-flight history response. A reset also clears prior contact, booking and calendar state.
- Chat, lead capture and tour booking share the 48-hour idle limit. Missing, malformed or far-future timestamps cannot keep a session alive. Booking checks the session before calendar/provider lookups. When both session and conversation are supplied, lead/booking requests reject a conversation from another session, even within the same property.
- The real database trial exposed an existing schema mismatch: local sessions use `session_start`/`created_at`, while the checked-in type snapshot and previous history route expected `started_at`. Session reads now support both existing variants and prefer actual last activity; they do not invent a fresh timestamp. No schema migration or broad generated-type rewrite was made. Exact hosted schema qualification is still required.
- Session and conversation read failures remain errors instead of becoming missing/empty results. Chat/history conversation lookups explicitly retain property scope. History responses use `Cache-Control: no-store` and an explicit response allowlist.
- Human-mode chat only reports a saved handoff after a message row is returned by storage. An unconfirmed save never returns `waitingForHuman`. New session/conversation creation also requires a returned identity. The widget's waiting notice now describes a saved message rather than promising an unmeasured response time.

The existing public contract still uses a property widget key plus an opaque session ID. This work does not introduce verified visitor identity or session rotation. Ordinary AI-message persistence, request-level idempotency, reliable lead-to-CRM/workflow delivery and protection against a takeover changing mid-generation remain further Phase 4 work.

### PropertyAudit/GEO job state

- A worker that does not win the queued-job claim returns without changing the run. Previously its error path could mark another worker's running/completed job failed.
- Stale-job cleanup compares the exact observed heartbeat before changing state, including the older missing-heartbeat case. A heartbeat or completion between read and write invalidates that cleanup decision. The reported recovery count includes only returned failed rows.
- Cleanup uses stable 500-row ID pages; tests cover 1,005 jobs, including rows leaving the running set between pages. It no longer relies on the database API's default result ceiling.
- Completion and progress updates require a still-running row and confirmed persistence. A late failure cannot overwrite a terminal result. A lost progress claim stops further query iterations. Failed-state persistence is reported separately from an execution failure.
- A run with no successful provider answers now returns failure rather than an unconditional success response.

This is state protection, not durable resumability. Stale jobs are still marked failed; they are not automatically resumed or replayed. Per-execution identities, worker leases/fencing, saved work manifests, bounded provider retries, cost/concurrency controls and complete partial-result/report semantics remain open. Existing partial results can still have a completed status with error details; this pass does not qualify those reports as complete measurements. Provider answer writes and score/final-state writes are not yet one atomic completion contract.

## Verification and evidence

- **160 LumaLeasing unit/route cases across 35 files passed**, including public configuration, chat, lead capture, tours, history, calendar/email boundaries and the new session cases. The earlier 60-case focused run is a subset, not additional coverage.
- **19 GEO cases passed**, including heartbeat races, competing completion, lost write acknowledgements, 1,005-job coverage, unclaimed execution, terminal-state protection, zero-answer failures and the existing Gemini retry/concurrency checks.
- **Nine Chromium scenarios passed** against the local widget: restore failure, 200-message updates, transient polling, expiry restart, no retry after ordinary 400/500, failed human handoff, reset with an old response and a new message during an older poll. The latter two wait for the old response to finish. The mobile view was visually inspected at 390px, with no horizontal document overflow.
- **18 real local API/database assertions passed:** 12 widget cases and six GEO cases. These use temporary fixtures and actual storage/query behavior. The GEO sweep client is constrained to fixture IDs so no existing job is processed. No model, calendar, CRM or real-recipient transport was invoked.
- Full web type checking passed. Affected-file lint has zero errors and 13 existing widget warnings; the before snapshot produces the same warnings. Local database advisors remain at 1,386 existing warnings with zero new warnings. No database permissions or schema changed.
- All temporary widget properties, automatically created property profiles, sessions, conversations, messages and GEO jobs were removed. The first fixture cleanup encountered the existing append-only profile guard; the two identified test properties were cleaned up in a scoped local transaction, and later trials used that cleanup path. This did not change the guard or client records.
- Initial browser text assertions incorrectly excluded the existing timestamp inside message bubbles; corrected assertions passed. The first local contract attempt exposed the timestamp schema mismatch described above. Failed logs remain alongside successful evidence.

Evidence lives under `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-four/`: `luma-coverage.log`, `verified-geo.log`, `verified-browser.log`, `local-contract.json`, `geo-local.json`, type/lint logs, advisor comparison, source snapshots and the mobile screenshot. No commit, push, hosted migration, deployment, real inquiry or backlog replay occurred.

## Continuation within Phase 4

Continue independent implementation and local qualification without waiting for a real client:

1. Complete LumaLeasing's durable message/lead/tour request identities, concurrent duplicate handling, human-takeover races, confirmed CRM/workflow handoffs and recoverable provider failures. Preserve calendar revocation/expiration and intended follow-up behavior.
2. Replace process-local-only public limits with shared enforcement and explicit spend limits; qualify grounded answers, knowledge freshness and installation behavior across property boundaries. Read actual scheduling configuration and outcomes before declaring maintenance absent.
3. Give GEO executions persisted work identities and a resumable, leased worker path. Finish bounded retries/concurrency, honest partial measurement/reporting, evidence-linked recommendations, knowledge refresh, competitor scraping and safe destination/redirect handling.
4. Perform actual connected journeys, scheduling/cost observations and client acceptance when a real target and recipients are available. These remain acceptance gates, not a reason to stop local implementation.

Do not mark Phase 4 or SiteForge acceptance complete from this pass. Preserve the original Phase 4 completion scope in `P11_IMPLEMENTATION_PLAN.md` and the current release boundaries.
