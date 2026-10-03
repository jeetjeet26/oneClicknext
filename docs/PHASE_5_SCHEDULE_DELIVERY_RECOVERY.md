# Phase 5 — schedule delivery recovery

September 16, 2026. Local qualification completed; Phase 5 and TourSpark remain active.

## Operator behavior

The Tours tab now exposes separate calendar changes, email notices and text notices for schedule changes/cancellations. Recent work shows the saved destination, provider receipt, attempt count, review evidence and truthful queued/in-progress/accepted/review/not-sent/superseded state. The list is limited to the latest 100 updates for the lead. History failures expose retry rather than an empty success state.

An operator can reconcile an uncertain update only after checking provider history. Accepted updates require a recorded provider attempt and message/event ID. A calendar update/cancellation must retain its pinned existing event identity. Confirmed unaccepted work may be queued again while timely, within 23 hours and at most three attempts. Expired work or corrected recipients close as not sent. Reviews never call a provider; outbound sending still follows the existing global pause. Accepted-by-provider is not prospect receipt/read confirmation.

Review submission retains a stable logical request identity after lost replies. Actor/property scope is derived from the session and lead and rechecked in the database. Immutable review evidence and the shared `tour.schedule_delivery.reviewed` event commit atomically with the work/receipt/calendar-binding change. Recording failure rolls everything back. Blocked decisions are recorded without claiming success; a later successful retry retains both. Free-text evidence remains in the scoped product receipt; shared history carries its input fingerprint and references. Events remain excluded from training.

## Worker integrity

- Active leases are excluded before the candidate limit, preventing active work from occupying the whole batch. Expired leases enter review rather than automatic resend.
- Schedule version/status, the property-local future time, unambiguous timezone, recipient and 23-hour delivery window are rechecked before sending. Cancellation notices can be timely after the original tour time. Changed recipients cannot receive an obsolete queued notice.
- Claims count toward a three-attempt ceiling. Message recipient, sender, subject and rendered body are pinned before crossing the provider boundary. The stable email key and calendar request identity are retained.
- Starting the same attempt twice is rejected. Matching successful completion acknowledgements can replay safely. A saved provider receipt cannot be overwritten by a generic failure, and a review invalidates old sender ownership.
- Receipt persistence is retried with the same evidence, without a second provider call. If persistence remains unavailable, the lease eventually exposes review; this is not an exactly-once provider guarantee.
- Accepted historical work does not rewrite the current schedule or calendar binding. Existing current-version work receives its actual saved binding update. Verified not-sent terminal work releases later tour actions and is not mislabeled as confirmed delivery.

## Evidence

- **72 service/API cases in six files** passed, including mocked calendar/message adapters, reminder cadence and the new trusted review route.
- **87 new database assertions** and **84 existing scheduling assertions** passed in rolled-back transactions. Coverage includes both tour sources, active/expired leases, bounded retries, replay, fencing, immutable evidence, corrected recipients, past tours, stale backlog, calendar identity and injected recording failures.
- **Eight real local browser journeys** passed: three new notice/calendar review cases and five existing scheduling cases. These cover a lost review reply, stale unsent closure on mobile, wrong calendar identity rejection and current binding recovery, scheduling/cancellation, capacity, lease guards, concurrent edits and delayed previous-property responses.
- Full web type checking passed. Targeted lint has zero errors and the seven pre-existing leads-page warnings. Database advisors remain at **1,386 existing WARN/ERROR; none added**. Desktop/mobile screenshots were inspected and local fixture records cleaned.

Evidence directory: `work/schedule-recovery/` in the active Codex workspace. Final files include `web-final.log`, `db-third.log`, `db-scheduling.log`, `browser.log`, `types-final.log`, `lint-final.log`, `advisor-delta.json` and screenshots. Earlier failed runs caught a SQL-test evaluation-order issue, a copied API assertion and the need for a dedicated immutable review guard; only final passing runs count.

Migration `20260916074822_phase_five_schedule_delivery_recovery.sql` was created with the Supabase CLI and applied to the local development schema only, without migration history. No hosted migration, deployment, provider send, backlog replay, commit or push occurred.

## Remaining scope

This does not qualify real provider receipt, calendar free/busy, controlled adoption of external calendar changes, legacy combined delivery records, or complete automated/public/user-interaction capture. Calendar binding here is the existing chatbot-booking integration; manual tour calendar-link export is distinct from connected calendar synchronization. Preserve every original product/client/release gate. Continue independent local provider/legacy qualification and remaining product journeys with semantic recording.
