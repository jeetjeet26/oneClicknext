# Phase 5 — TourSpark no-show corrections

Updated September 15, 2026. This local increment follows the outcome work in `PHASE_5_TOUR_OUTCOMES.md`. Phase 5 and TourSpark remain in progress.

## Operator behavior

A past no-show has a **Correct no-show** action in the lead's Tours tab. The operator confirms attendance and supplies a reason. Saving marks the tour completed, reverses only that tour's no-show score penalty, retains the original event and outcome in audit history, stops obsolete queued/paused no-show follow-ups and enrolls the configured completion follow-up. Other workflow kinds and unrelated no-show penalties remain intact. The reason, date and correction marker survive reload.

Manual tours and chatbot bookings use the same correction operation. Widget completions now receive the same completion behavior score as manual tours; the prior score model omitted widget bookings. No bulk rescore was run.

The browser retains a request identity across retries of an unchanged reason. A response lost after a successful save can be retried without another correction, engagement event or workflow. Concurrent different correction requests yield one success and one conflict. Replayed responses include the lead's current status, preserving subsequent leased/lost updates.

Known previous no-show delivery is disclosed in history; an accepted message cannot be recalled. Legacy history or attempted delivery without a confirmed receipt is marked uncertain. A live delivery claim defers correction, including on a stopped workflow. An expired/incomplete claim requires delivery review before any correction is saved. These states never silently clear a send claim.

## Integrity and implementation

- `POST /api/tours/correct` derives the actor from authentication and verifies property access. It accepts a tour, UUID request identity and a trimmed reason of 1–2000 characters. Ambiguous identifiers across tour sources are rejected.
- Service-only `correct_tour_no_show` repeats tenant/lead checks and uses the existing property lock shared with reservations/outcomes. Audit snapshots, queue stops, score reversal and the existing atomic completion operation commit together. A failure rolls everything back.
- `tour_outcome_corrections` stores the actor, reason, original schedule/outcome and engagement events, stopped workflows and result. Its private RLS/grants exclude normal clients. Finalized audit rows cannot be edited or directly deleted; parent cleanup can cascade.
- The terminal-outcome trigger permits no-show correction only when a matching private audit row exists in the current transaction. It does not accept a caller-controlled setting as authorization. Direct terminal rescheduling remains blocked.
- Operator pause/stop, new-booking and lead-status actions preserve delivery ownership. Worker advancement/claim release is fenced to its claim timestamp; advancement also requires the workflow still be active. A pause or stop during a send survives completion. A late send's visibility update cannot overwrite a changed lead status.
- Function and privilege documentation/changelog were checked. The new mutation uses SECURITY INVOKER, an empty search path and explicit service-only execution grants. The existing scoring function's ACL is preserved.

## Verification

- **115 service/API tests across 14 files passed**, covering corrections and adjacent outcomes, no-shows, reminders, workflow processing, confirmation delivery, widget reservation, lead controls and cron tracking.
- **60 new correction database assertions and all 48 prior outcome assertions passed** in rolled-back local transactions. Coverage includes both sources, scoped score reversal, immutable audit, current-state replay, rollback on invalid follow-up, sent/uncertain/busy delivery, tenant isolation, CRM lease and leased status preservation, scoring parity and service-only privileges.
- **7 actual local browser scenarios passed**: four correction scenarios plus the three prior outcome scenarios. These cover desktop history persistence, mobile lost-success-response retry, actual API lease guards/prior receipt disclosure, authorization and concurrent writes. Only the lost response is simulated; the correction and retry use the real local API/database.
- Full web type checking passed. Targeted lint: **0 errors, 9 pre-existing warnings** (seven in the leads page, two in ActivityTimeline). No added trailing whitespace.
- Database advisors: **0 new WARN/ERROR**, unchanged at 1,386 existing warnings. The sole new INFO is the intentionally private audit table's RLS-with-no-policy state.
- Desktop and mobile screenshots inspected; the pre-existing development issue badge remains. All temporary browser fixture properties were removed. No real provider was called.

Evidence is in `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-five-corrections/`: `web.log`, `sql.log`, `sql-outcomes.log`, `browser.log`, `types.log`, `lint.log`, `advisor-delta.json`, `fixture-cleanup.log`, `verification.json`, screenshots and staged before/after files.

## Database and release state

Migration `p11-platform/supabase/migrations/20260916031436_phase_five_tour_corrections.sql` was created with the Supabase CLI and applied to the local development schema only, in a transaction, without a migration-history record. It depends on the locally applied Phase 4/outcome schema. Reconcile migration history before release; do not blindly replay the historical migration directory.

External delivery remains paused. No hosted migration, deployment, provider send, backlog replay, commit or push occurred. Real-client acceptance remains deferred. Correction replay safety does not prove provider message delivery or exactly-once sending. Existing workflow transport retries and provider receipt checkpointing still need qualification; old attempts without any persisted evidence cannot be reconstructed by this audit.

## Next work

1. **Completed locally in the subsequent increment:** atomic rescheduling/cancellation, shared capacity and schedule-versioned delivery controls across both tour sources. See [the scheduling handoff](PHASE_5_TOUR_SCHEDULING.md) for new evidence and remaining provider/reminder limits. The verification numbers above remain historical to this correction increment.
2. Complete reminder/follow-up recovery with provider idempotency, durable attempt/receipt checkpoints, ambiguous-send review and bounded retries. Do not resume sends to test this without authorization.
3. Add bounded per-item no-show failure recovery and a deliberate backlog policy; preserve timezone review and the seven-day automatic window.
4. Finish TourSpark provider/calendar qualification and eventual real-client acceptance, then proceed through the remaining retained Phase 5 products. The master plan retains their full scope.
