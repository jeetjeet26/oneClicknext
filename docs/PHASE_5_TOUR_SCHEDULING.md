# Phase 5 — TourSpark scheduling and cancellation

Updated September 15, 2026. This local increment follows the outcome and no-show correction work. Phase 5 and TourSpark remain in progress. No external delivery or production qualification is implied.

## Operator behavior

The lead's Tours tab now supports rescheduling and cancellation for both manual tours and chatbot bookings. Every change requires a reason and retains before/after history. Rescheduling uses property-local time, checks shared capacity and keeps a rejected edit available for correction. Cancellation releases capacity and adjusts the lead only when appropriate: another active tour preserves booked status, while leased/lost status remains intact.

The browser preserves the request identity when retrying unchanged input after a lost response. A stale edit receives a conflict instead of overwriting a newer schedule. The LumaLeasing recovery controls use the same operation and retry contract. History survives reload and displays current-version calendar/notice work as queued, completed or requiring review. Saving a schedule does not claim that a calendar or prospect message has been delivered. Prospect notifications are optional and default off.

An active delivery claim blocks schedule changes, outcomes and corrections. An expired or uncertain attempt requires review; these actions do not discard delivery ownership. Work that has not started for a superseded schedule cannot be claimed against the new schedule. A send already in progress cannot be recalled.

Property changes remount the lead workspace and abort obsolete list requests. A delayed response from the previous property cannot replace the selected property's leads or retained tour-edit state.

## Integrity and implementation

- `change_tour_schedule` validates actor/property/lead ownership, a request UUID, expected schedule version, action, reason and property-local time. It uses the property lock shared by reservations and outcomes. Audit history, capacity, schedule/version, lead/CRM state, old-work supersession, new work and activity commit together; a downstream error rolls the transaction back.
- Identical request retries replay a saved result with current tour/lead state. Reusing the same UUID with different input conflicts. Concurrent edits from the same version have one winner.
- Capacity checks include overlapping active manual and chatbot tours. Configured slots must match the property, date and start, fit the duration and have capacity. Conservative property-wide capacity defaults to one where no slot is configured. Duration is 1–240 minutes and cannot wrap past midnight. This is local capacity validation, not remote calendar free/busy qualification or per-agent scheduling.
- Triggers prevent direct schedule, ownership, cancellation or reopening mutations from bypassing the private audit transaction. Existing terminal-outcome protection remains. Slot counters are derived from active rows across both sources, removing the previous reservation double-increment. No mass historical repair was performed.
- `tour_schedule_changes` holds immutable finalized audit snapshots. `tour_schedule_work` holds versioned calendar work, separate email/SMS notices and legacy confirmation/reminder claims. Both tables have RLS and explicit service-only grants; scoped parent cleanup can cascade. The migration adds schedule versions, manual tour duration/slot association and narrow generated-type updates.
- Rescheduling resets reminder markers, supersedes queued work for the old version and holds unattempted initial confirmations for the old schedule. Cancellation enqueues the appropriate calendar change. Leased/lost lead state and CRM processing/retry ownership are preserved.
- Unknown property timezones, nonexistent DST times and ambiguous repeated local times require correction/review. External calendar disappearance, cancellation or time drift is recorded for review instead of silently changing local capacity, lead state or history. Pending local calendar work suppresses premature drift handling.

## Delivery controls

New change delivery uses a bounded worker through the existing reminder cadence. It claims current-version work, persists an attempt before provider calls, and requires a receipt to finish successfully. Calendar work is pinned to the saved provider/calendar/event destination and timezone, and uses the actual tour duration. New email work uses a stable delivery key. Separate email/SMS notice tasks retain provider message IDs.

Claims last five minutes. An expired attempt moves to review rather than being automatically reclaimed. The original owner can still reconcile its matching token; replacement ownership is not silently granted. Unattempted work older than 23 hours is held for review instead of replaying a stale backlog. Obsolete or invalid work is superseded. Failed or ambiguous attempts remain visible.

Initial Luma confirmation claims now use the shared property lock and recheck schedule version/status. Manual confirmations, both reminder sources and legacy calendar repair acquire matching versioned claims. Changed schedules belong to the new durable calendar queue; legacy reconciliation cannot perform an untracked repair. Initial confirmation jobs retain ownership of initial event creation. Reminder routes report partial/review outcomes honestly. Manual email-only one-hour reminders actually send email before finalizing their marker.

These controls do not establish exactly-once provider sending. Legacy confirmation/reminder senders still group channels and lack complete per-channel provider checkpoints. Reminder eligibility retains the older server-local date/window calculation; full property-timezone scheduling remains next work. The initial manual booking endpoint still has an older multi-write flow and has not become a fully qualified atomic booking transaction. Cron start/finish acknowledgements, controlled adoption of external calendar edits, provider recovery and live free/busy remain open.

## Verification

- **168 service/API tests in 21 files passed**, covering scheduling, receipts/claims, outcomes, corrections, no-shows, reminders, workflow processing, initial confirmation, widget reservation, recovery and calendar ingestion/reconciliation.
- **193 database assertions passed** in rolled-back local transactions: 84 scheduling, 49 outcome and 60 correction checks. Coverage includes both sources, overlap/slot capacity, replay/concurrency, immutable history, rollback, direct-write protection, tenant/privilege boundaries, expired claims, token fencing, lead/CRM preservation, DST rejection and stale backlog holds. The outcome suite gained explicit expired-send review coverage.
- **12 actual local browser scenarios passed**: five scheduling, four correction and three outcome scenarios. New coverage includes persistent schedule/cancellation history, mobile capacity recovery, a lost-success-response retry, real delivery lease guards, concurrent widget edits, recovery API replay, authentication and a deliberately delayed previous-property response. All writes used the local API/database; no provider send was made.
- Full web type checking passed. Targeted lint: **0 errors and 7 pre-existing leads-page warnings**. No added trailing whitespace. Installed files were checked against the staged hashes.
- Database advisors: **0 added WARN/ERROR**, unchanged at 1,386 existing warnings/errors. New INFO findings concern two intentionally private tables with no client policies and two unused indexes.
- Desktop/mobile screenshots were inspected. The existing development issue badge remains. Temporary scheduling, correction and outcome browser fixture properties were removed.

Evidence directory: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase-five-scheduling/`. Final evidence is `web.log`, `sql.log`, `sql-outcomes.log`, `sql-corrections.log`, `browser.log`, `types.log`, `lint.log`, `advisor-delta.json`, `fixture-cleanup.log`, `verification.json` and the desktop/mobile screenshots. Earlier failed-run logs are retained separately and are not the final results.

## Database and release state

Migration `p11-platform/supabase/migrations/20260916035133_phase_five_tour_scheduling.sql` was created with the Supabase CLI and applied to the local development schema only, without recording migration history. It depends on the locally applied Phase 4, outcome and correction schema. Reconcile schema/history deliberately before any release; do not blindly replay the historical migration directory. Existing prepared work and the dirty checkout were preserved.

External delivery remains paused. No hosted migration, deployment, real provider send, backlog replay, commit or push occurred. Real-client acceptance remains deferred. Local fixtures and mocked provider results do not qualify calendar providers or real message receipt.

## Next work

1. **Reminder portion completed locally in the subsequent increment:** property-timezone eligibility, per-channel durable attempts/receipts, operator review, bounded timely retries and cron acknowledgements. See [the reminder handoff](PHASE_5_TOUR_REMINDERS.md). Workflow follow-up and initial confirmation/legacy attempt recovery remain open. The verification and limitations above are historical to this scheduling increment.
2. Add bounded per-item no-show failure recovery and an explicit backlog policy while preserving timezone review and the seven-day automatic window.
3. Finish initial booking transaction integrity, controlled external-calendar change adoption, provider/free-busy/calendar qualification and eventual real-client acceptance.
4. Continue the other retained Phase 5 products from the master plan. This increment completes local rescheduling/cancellation work; it does not complete TourSpark or Phase 5.
