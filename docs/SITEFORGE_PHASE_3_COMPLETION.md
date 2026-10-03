# SiteForge Phase 3 — local work completed, acceptance pending

September 15, 2026. The remaining identified local implementation and qualification work for Phase 3 is complete. **Phase 3 overall is not accepted yet:** real client ownership, accepted revisions, approved recipient receipt and normal operating evidence are still missing. This does not advance the plan to Phase 4 or authorize a release.

**Owner follow-up, September 15:** the user explicitly authorized moving to Phase 4 and waiting for a real client. Continue independent [Phase 4 implementation](PHASE_4_CHATBOT_GEO.md); the remaining acceptance items below stay open. The earlier instruction against automatic advancement does not override this later explicit direction.

## Completed in this continuation

### Content merging

The personal SiteForge skill now has a read-only three-way content-merge planner. It compares the previous source, incoming source and current destination using stable record identities. Destination-only edits are retained; the same change on both sides is recognized as already applied; conflicting edits block the batch. Arrays are atomic fields. New/deleted records and deleted fields require explicit client-specific mapping or a decision. It is not a general CMS writer or a new page schema.

An isolated Gable House WordPress copy qualified an actual conditional write transaction: two incoming fields merged while the destination introduction stayed intact. A pre-commit interruption rolled back every write; a lost acknowledgement was reconciled without replaying applied fields; a stale write was refused; a conflicting heading was reported; field recovery retained the destination edit. The merged page rendered at desktop and phone widths. The full fixture was then restored, and all original content, metadata, settings, taxonomy and file identities matched again. Original client source was unchanged.

### Monitoring and recovery

- Health results and incident transitions now commit together in a service-only database transaction. Competing completions are serialized per website; a superseded observation cannot undo a newer completed observation. A failed transaction leaves no partial set of incidents. Repeating a committed acknowledgement returns its saved result.
- Execution failures retain one active incident; a completed observation can close it. Repeated restoration failures also retain a stable incident and existing ownership. Unconfirmed request or restoration writes are reported for review.
- Scheduled scans use stable website-ID pages and a saved cursor, with four concurrent website checks, eight-row pages, a 210-second work budget and a six-minute lease. Later websites no longer stop at the old 100-record ceiling. An expired worker cannot checkpoint over its replacement; an interrupted page is revisited. A route limit of 300 seconds is declared. DNS lookups are bounded at 15 seconds. Host execution limits still require target verification.
- Scan membership is bounded by the highest eligible ID when a sweep begins. Sites added behind the current cursor may wait for the next sweep. Page completion, deferred coverage, held alerts and unavailable checks remain distinguishable. The existing per-site sample of the homepage plus at most 10 linked/declared pages remains a disclosed sampling limit.
- Alerts carry only the affected website's counts. A global recovered-job total is not exposed to another organization's recipients. Delivery pause, durable claims and the distinction between provider acceptance and recipient receipt remain intact. Historical alerts are not replayed.
- A single-site check no longer invokes the global recovery queue. A scheduled scan holds its lease while processing existing recovery work and observations. Its final cron summary must be confirmed before returning success.
- A monitoring-triggered restore request now stays with the operator. It cannot use an old launch approval to change production indexing or execute a provider restore. Existing explicit operator/launch recovery paths remain available. Repeated restore requests preserve acknowledgement, and the response reports whether protection actually occurred.

### Maintenance and reporting

The existing personal delivery record now captures actual maintenance ownership, factual approval, alert/report destinations, observed normal cycles, accepted revisions and measured operating effort/cost. The linked maintenance reference requires dated observations and actionable reports. Missing costs and unobserved operating history remain unavailable, not zero. No client database, generator or recurring automation was introduced.

## Verification

- **102 regression cases across 11 files passed**: the final 99-case run plus three incident-history route cases. This includes 24 actual local database cases covering transaction rollback, overlapping observations, incident ownership, missed acknowledgements, grouped restore failures, 105 temporary websites, cursor resume, expired leases, interruptions and browser-role denial.
- **12 console browser cases passed**, including the real local incident-history endpoint, saved operational ownership and held alert outcomes, failure/retry states, phone layout and the existing brief export flow. No generated site or launch was submitted.
- **67 personal-skill Python cases and 11 inventory cases passed**; skill metadata validation passed. The merge planner adds 15 cases.
- **Nine actual WordPress merge/recovery assertions and two rendered views passed.** Final expanded source/destination comparison passed after restoration. The initial browser assertion was corrected to account for the existing decorative heading symbol; the destination had been restored after that failed attempt.
- Full web type checking, affected-file lint, schema-version alignment and whitespace checks passed. New database object types were checked against local generation; the nullable empty-sweep cursor is explicitly represented.
- Local database advisors reported **1,386 existing warnings before and after, with no new warnings**. New functions and the internal sweep table are unavailable to anonymous/authenticated browser roles. Temporary test websites and their related rows were removed; the sweep cursor was restored to its prior empty state.

The browser/site responses, provider outcomes and alert transports used fixtures where indicated. Database-backed tests used the actual loopback database. Immediate reruns and simulated interruptions establish transition behavior, not real scheduled operating history. Automated durations are not end-to-end delivery time or operator cost.

## Local schema and release boundary

Prepared migration: `p11-platform/supabase/migrations/20260915213042_siteforge_monitoring_atomic_completion.sql`. Its effects are applied **only to the local development database**, without adding a migration-history entry. It adds the atomic completion RPC, an observation-order index and an internal cursor with service-only lease/checkpoint/release RPCs. Existing unrelated schema work and history are preserved. The installed CLI could not execute a multi-statement prepared query, so the local script was applied in a single PostgreSQL transaction.

Before an authorized hosted release, reconcile migration history, apply this migration before the new application callers, verify service/browser privileges and then verify the actual scheduled route. The new code refuses unconfirmed persistence rather than falling back to old partial writes. If reverting the app, retain saved health/incident history; unused new schema objects can remain until an explicit cleanup decision. Nothing was committed, pushed, deployed or sent to a real recipient.

## Phase 3 acceptance ledger

| Requirement | Local evidence | What still closes the requirement |
| --- | --- | --- |
| Three contrasting rental/for-sale briefs and creative quality | Earlier three existing examples and 12 responsive baselines; links below | Actual owner design acceptance; existing examples are not three new accepted commissions |
| At least 20 representative revisions | Earlier 20 agent-authored scenarios / 40 rendered views, with restored parents | Actual requested conversational edits and owner acceptance; original human effort/cost remains unavailable |
| Imports, assets and redirects | Prior full WordPress/standalone transfers, 104 browser/HTTP/recovery checks, plus this conditional merge trial | A chosen client's real mapping, hosted redirects and client-specific structures; arbitrary content creation/deletion and ACF migration are not universally qualified |
| Monitoring, deduplication, freshness and recovery | Atomic local observations, durable alert claims, cursor/lease checks, ownership preservation, operator-controlled restoration | Designated actual target, named maintenance/factual owner, approved delivery destination, actual receipt and normal schedule-cycle observation |
| Reports and maintenance effort | Dated evidence and the client-local delivery/maintenance record | Real operating reports with measured effort, attributable cost and accepted outcomes |

The user was asked which actual client target, maintenance owner and alert recipient should be used. That information has not yet been supplied. Gable House and Persimmon remain representative review examples, not mandatory launches. Their original content is unchanged; Persimmon's September 8 inventory observations still require the previously recorded September 15 reconfirmation. Rebuilding has not refreshed them.

Carry Phase 2's current facts, real inquiry receipt, exact hosted runtime/ACF, approved deployment, DNS/TLS/indexing and hosted restoration gates forward. A fresh public retrieval attempt did not provide usable hosted evidence, so no hosted target has been newly certified or relabeled.

## Evidence and continuation

Earlier records: [revision trials](SITEFORGE_PHASE_3_LOCAL.md), [monitoring increment](SITEFORGE_PHASE_3_MONITORING.md), [full-transfer and redirects](SITEFORGE_PHASE_3_MIGRATION.md).

This continuation's orchestration, before snapshots, regression logs, generated local type snapshot, advisor comparison and cleanup result are under `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-three-completion/`. The WordPress merge record is in the client's `work/gable-house/phase-three-migration/evidence/content-merge/` directory. Source backups and data snapshots stay private in the client project.

The next action is the connected acceptance pass after the actual target and people are named. Do not reopen the completed local increments, invent missing acceptance evidence, revive the discarded generator, send a historical backlog, or automatically advance to Phase 4.
