# Phase 5 — TourSpark reminder recovery

Updated September 15, 2026. This increment follows local rescheduling/cancellation. Phase 5 and TourSpark remain in progress. Automated workflow follow-up recovery is next; it is not completed by this reminder work.

## Operator behavior

The lead's Tours tab now has a **Reminder delivery** section. It shows email and text separately, distinguishes queued/sending/accepted/review/not-sent states and retains provider IDs plus the latest review evidence after reload. Provider acceptance is explicitly distinguished from receipt by the prospect. The list is bounded to the most recent 100 reminder records; full review audits remain stored.

For a reminder needing review, the operator checks the provider history and records either an accepted message with its provider ID or evidence that the provider did not accept it. A known-unaccepted channel can return to the queue while its reminder window is open, up to three attempts. The already accepted channel is preserved. Closing a delivery window, reaching the attempt limit or changing the recipient prevents requeue. Review saves never send messages and still honor the global delivery pause.

The browser retains the review request UUID for unchanged input. Retrying after a lost successful response does not duplicate the audit or queue. Concurrent different reviews have one winner. Reviews cannot override a live send, invent acceptance without a recorded attempt, cross a lead/property boundary or let an old worker overwrite a later operator decision.

Unknown timezones and DST gaps/folds are reported in pending reminder diagnostics. No server timezone is substituted. Missing contact details create an unattempted hold; adding contact details makes that reminder eligible again only while timely. Earlier grouped reminder attempts remain visibly marked as legacy records rather than being converted into invented channel receipts.

## Timing and delivery integrity

- Both manual tours and chatbot bookings use the same database eligibility calculation, including both scheduled and confirmed statuses. It resolves the explicit property/calendar timezone through the existing outcome schedule contract. Offsets on both sides of a local date detect skipped or repeated times without assuming every DST shift is one hour.
- Eligibility remains bounded to 22–25 hours for the 24-hour reminder and 30–90 minutes for the one-hour reminder. Date candidates span the necessary UTC boundary for all current property offsets. The read-only counts and sending candidates use the same calculation, and query errors are not displayed as zero pending reminders.
- Messages name the exact property-local date, time and timezone abbreviation. They do not rely on “tomorrow” being accurate throughout the window. The database rechecks time, timezone, current schedule version/status and recipient immediately before each provider attempt.
- `tour_reminder_channels` stores each channel's pinned recipient, exact content, sender, attempt count and provider receipt beneath the existing versioned `tour_schedule_work`. The new private review table records actor, evidence, request identity and result. Both tables have RLS, explicit service-only grants and appropriate foreign-key indexes; finalized review audits are immutable.
- A successful claim precedes a durable attempt checkpoint. Missing configuration, changed content/recipient, stale schedules and closed windows stop before the provider call. A lost checkpoint acknowledgement also stops rather than guessing whether it saved.
- A successful provider response requires a message ID, saved independently for that channel. Missing IDs, failures or transport exceptions stay in review and are not automatically sent again. A lost receipt-write acknowledgement never overwrites a possibly saved receipt with failure.
- Email uses a stable key per reminder channel. Content and sender remain pinned across a reviewed retry. The existing 23-hour work limit stays inside Resend's documented 24-hour idempotency retention, and the shorter reminder eligibility window also applies. SMS uncertainty always requires explicit review; no unsupported exactly-once guarantee is inferred.
- Five-minute claims retain ownership. Expired attempts become review, without automatic resend. A late original owner can checkpoint its matching receipt until an operator decision rotates ownership. A bounded recovery pass can finish an interrupted reminder from its already saved receipts without sending. A claim abandoned before any provider checkpoint can safely return to queued work; a late queue is closed without sending.
- The whole reminder marker is saved only once every intended channel has an acceptance receipt. Partial reminders never become whole-reminder success. Schedule changes/outcomes/corrections continue to respect active or uncertain parent delivery claims. Older grouped senders cannot claim new per-channel reminders.
- The worker handles at most 100 candidates per pass; recovery is similarly bounded. The cron route requires a saved start record before processing and a saved completion acknowledgement before returning success. Accepted channels plus review/failure produce partial results. Missing timezone, contact and uncertain-delivery holds are reported honestly.

The reference checks used [Supabase database function documentation](https://supabase.com/docs/guides/database/functions), current change notes and [Resend's idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys). No new dependency or provider integration was installed.

## Adjacent drawer fix

Browser regression testing exposed an existing race in the lead drawer: sequential background reads without cancellation could start another tour refresh after the operator began editing, unmounting the outcome form during a save. Drawer reads now run independently, cancel obsolete requests and depend on lead identity rather than every change to the lead object. Saved outcomes cannot be overwritten by a prior tour read. A browser scenario deliberately delays the workflow response while recording a real local outcome.

## Verification

- **202 service/API tests in 23 files passed**: 192 checks in the primary run and 10 additional lead/calendar API regressions. New reminder coverage includes pause, property-local message formatting, per-channel acceptance, claim/start/receipt uncertainty, missing configuration, old accepted-channel preservation, partial status, recovery failures, authentication and review conflicts.
- **285 database assertions passed**, each suite rolled back: 92 reminder, 84 scheduling, 49 outcome and 60 correction checks. New checks cover both tour sources, positive/negative timezone offsets, DST folds/gaps, service-only grants, per-channel checkpoints, duplicate claims, token fencing, immutable review, retries, recipient/content changes, missing-contact recovery, attempt limits and interrupted completion.
- **16 local browser journeys passed**: three new reminder journeys, five scheduling, four correction, three prior outcome journeys and one new delayed-drawer-read regression. These use actual local authentication/API/database state, including concurrent reviews and a lost successful mobile response. Provider outcomes are local fixtures; no real provider was called.
- Full web type checking passed. Targeted lint: **0 errors, 7 pre-existing leads-page warnings**. No added trailing whitespace. Installed files match their staged hashes.
- Local database advisors: **0 added WARN/ERROR**, unchanged at 1,386 existing warnings/errors. The only added INFO findings are RLS with no client policies on the two intentionally private tables.
- Desktop and mobile screenshots inspected. The existing development issue badge remains. Temporary reminder, scheduling, correction and outcome test properties were removed. Outbound delivery remains paused.

Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-five-reminders/`: `web.log`, `web-adjacent.log`, the four `sql*.log` files, `browser.log`, `types.log`, `lint.log`, `lint-final.log`, `advisor-delta.json`, `fixture-cleanup.log`, `delivery-pause.log`, `verification.json` and desktop/mobile screenshots. Early failed checks were diagnosed before the final passing runs.

## Schema and release state

Migration `p11-platform/supabase/migrations/20260916043731_phase_five_reminder_recovery.sql` was created with the Supabase CLI and applied in a transaction only to the local development schema. Migration history was not recorded. It depends on the locally applied outcome, correction and scheduling functions. Reconcile schema/history before release; do not replay the historical directory indiscriminately. The dirty checkout and all earlier increments were preserved.

No hosted migration, deployment, real provider send, backlog replay, commit or push occurred. Real-client acceptance remains deferred. This work proves local receipt bookkeeping and controlled recovery, not prospect delivery, live provider reconciliation, calendar free/busy or complete TourSpark qualification.

## Next work

1. Apply durable attempt/receipt recovery to workflow follow-ups. The current workflow processor still has immediate transport retries, unchecked action inserts, lease replacement on expiry and incomplete provider acknowledgement recovery. Keep delivery paused; do not reinterpret old failed actions as safe to resend. Preserve operator pause/stop and the previous correction protections.
2. Add bounded per-item no-show failure recovery and a deliberate backlog policy, preserving timezone review and the seven-day automatic window.
3. Finish initial booking transaction integrity, initial confirmation/per-channel recovery, older grouped-attempt reconciliation, controlled adoption of external calendar changes, provider/calendar qualification and eventual real-client acceptance.
4. Continue every other retained Phase 5 product in the master plan. This reminder increment does not complete Phase 5 or authorize any send/release.
