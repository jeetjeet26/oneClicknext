# Phase 5 — TourSpark outcomes (local increment)

Updated September 15, 2026. Phase 5 is in progress. This completes the completion/no-show outcome increment; it does not complete TourSpark or the whole phase.

## Implemented behavior

- The TourSpark lead drawer has a Record outcome form for active tours, with completed/no-show selection, optional notes, saving state and a retryable failure. Saved notes remain visible in tour history after reload. Missing tour data is an error with retry, rather than an empty history. The drawer is keyed by lead/property and is hidden when its lead belongs to a different selected property.
- Both manually scheduled `tours` and chatbot `tour_bookings` use one service-only database operation. Tour status, lead status, CRM handoff, lead activity, weighted engagement event, score and configured follow-up enrollment commit together or roll back together.
- A unique receipt identifies the source and tour. Repeating the same outcome returns its original receipt and notes without duplicate activity, scoring or workflow enrollment. A different terminal outcome is rejected. Older terminal rows are acknowledged without replaying historical follow-ups; unknown historical completion times remain unknown.
- The no-show job includes confirmed and scheduled tours from both sources. It uses the linked calendar timezone, explicit property timezone, or a single unambiguous enabled calendar timezone. Missing/invalid timezone is reported for review. Automatic eligibility is tour end plus one hour, within the previous seven days, with up to 100 outcomes per run (database limit bounded to 250). It checks eligibility again under the mutation lock.
- A no-show does not downgrade a leased/lost lead, a lead already toured, or a lead with another active/completed tour. Inappropriate follow-ups are suppressed. The CRM processing lease is preserved.
- Only configured, active follow-up workflows are enrolled, and an existing active/paused instance is reused. The old no-show job's independent direct SMS/email send and implicit default-workflow seeding were removed. Queueing is reported separately from delivery; saved provider receipts determine the new sent count. Missing workflow setup is explicit.
- A live chatbot confirmation lease defers finalization. Pending or expired initial confirmations are held for review when the tour is finalized. Existing terminal statuses cannot be silently rescheduled or overwritten by old mutation paths.
- The no-show cron requires a durable start and confirmed completion record. Partial failures, missing timezone/setup and deferred delivery work no longer report unconditional success.

## Fresh verification

- **86 web service/API cases across 11 files passed**, including adjacent reminders, widget reservation, confirmation delivery, workflows and cron tracking.
- **48 actual local database assertions passed**, in a rolled-back transaction: both tour sources, replay identity, property/lead scope, workflow reuse, atomic rollback/retry, event weights, lead-state preservation, CRM lease preservation, daylight-saving offsets, end-time grace, batch bounds, missing timezone/setup, confirmation leases, private receipt storage and service-only execution.
- **3 browser scenarios passed**, using actual local authentication and temporary database fixtures: completion/notes surviving reload; mobile failed-save/retry; and simultaneous API completion requests yielding one engagement event/workflow. Authentication and unauthorized-property checks are included. The mobile failure response is deliberately simulated; the successful retry and saved outcome are real local API/database operations.
- Full web type checking passed. Targeted lint passed with **0 errors / 7 pre-existing warnings** in the large leads page. No new whitespace issues.
- Local database advisors: **0 new WARN/ERROR**, compared with the Phase 4 baseline (1,386 existing warnings). New informational results are the service-only receipt table's intentional RLS-with-no-policy state and its two not-yet-used indexes.
- Desktop completion and mobile retry screenshots were inspected. All temporary browser properties were removed; database assertions rolled back.

Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-five-tours/` (`web.log`, `sql.log`, `browser.log`, `types.log`, `lint.log`, `advisor-delta.json`, `verification.json`, and staged before/after files). Browser screenshots are also copied there.

## Database and delivery state

Prepared migration: `p11-platform/supabase/migrations/20260916024400_phase_five_tour_outcomes.sql`, created with the Supabase CLI. It is applied to the local development schema only, without recording migration history. It builds on the existing local Phase 4 schema. Reconcile migration history deliberately before any release; do not replay all existing migration files blindly.

The receipt table uses RLS and explicit service-only grants. The functions use SECURITY INVOKER and a fixed empty search path. HTTP handlers validate the user's property access before mutation/history access. Current Supabase function/privilege documentation and the changelog were checked; explicit grants account for the announced change to automatic Data API exposure.

External delivery remains paused. No provider messages, backlog replay, hosted migration, deployment, commit or push occurred. These results do not establish actual provider delivery, calendar synchronization or live-client acceptance.

## Next work and retained gates

1. **Completed locally September 15:** explicit correction of mistaken no-shows, with original-history audit, score reversal, queued no-show follow-up cancellation and safe retry. See `PHASE_5_TOUR_CORRECTIONS.md` for verification and remaining delivery gates. Ordinary conflicting terminal writes remain rejected.
2. Make rescheduling/cancellation atomic across capacity, lead state, calendar changes and obsolete confirmations/reminders. Carry a schedule version through queued work so a previous time cannot be delivered after a change.
3. Finish reminder and follow-up delivery recovery across both tour sources. Existing workflow sending still needs provider idempotency/receipt checkpoint qualification, ambiguous-send handling and bounded recovery. This increment guarantees outcome/enrollment replay safety, not exactly-once provider delivery.
4. Add per-item no-show failure backoff/review and backlog policy. The seven-day automatic window avoids silently replaying older history; older tours need deliberate reconciliation. Unknown timezones need property/calendar setup. The current batch is bounded but has no per-item retry scheduler.
5. Complete TourSpark booking/calendar/provider qualification and real authorized acceptance, then continue the other retained Phase 5 products. LeadPulse scoring improvements beyond these outcome events remain separate work.

No retained Phase 5 product has been marked fully complete.
