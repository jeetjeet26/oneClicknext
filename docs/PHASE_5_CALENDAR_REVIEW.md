# Phase 5 — external calendar decisions and recovery

September 16, 2026. Qualified locally; Phase 5 and the holistic product plan remain active.

Staff can review a calendar move beside the saved console schedule, adopt the provider time, or explicitly cancel a booking after its provider event is missing/cancelled. The console checks the bound event again before applying a decision. It preserves the draft after a stale observation and retains one request identity through an unconfirmed response. A committed decision can be recovered without a provider read during an outage. Ordinary reschedule/cancel operations now hold unresolved external changes for explicit review.

The transaction checks property membership, event/calendar binding, schedule version, exact chosen observation, recent provider evidence and current calendar identity. Adoption uses the booking's pinned timezone and original duration, enforces future/unambiguous times and existing capacity/delivery rules, and commits the schedule, lead state and immutable action record together. Redundant calendar work is skipped without a provider-write receipt. No prospect notice is queued by this decision. Changed durations, unsupported times, legacy unpinned bookings, multiple bindings and uncertain existing delivery remain explicit holds.

`tour.calendar_change.reviewed` records authenticated actor, stable request, chosen observation, compact before/after schedule, exact provider snapshot used and actual applied/blocked outcome. Supplied reasons remain in protected schedule history; shared events retain their hash. Recording failure rolls back all changes. Lost responses do not duplicate a decision. Failed decisions and later successful retries remain distinct. These events are training ineligible. This extends operator decision coverage; it does not establish comprehensive immutable automated observation history.

The recovery list now reads calendar records only for its property-scoped bookings and uses validated cursors to reach all active bookings. It shows loading/failure states and readable calendar status labels. Older active bookings are no longer hidden behind the previous eight-row display or 100-row query ceiling. Provider event reads have bounded timeouts.

## Evidence

- **85 service/API checks** passed across seven suites: calendar decision/replay, fresh provider checks, input trust, authentication/scope, stale/conflicting outcomes, recovery reads/pagination validation, existing provider reads/writes, observations and settings.
- **325 database assertions** passed: 35 calendar review, 11 observation, 84 scheduling, 87 delivery recovery, 57 shared tour history, 22 pinned-timezone and 29 Luma configuration checks. Fixtures rolled back. The new checks include unchanged booking/history/work after an action-recording failure.
- **Five distinct browser journeys** passed: adopted move with lost response and actual shared history; stale observation rejected by the real API with draft retained; explicit cancellation; 102 active bookings across pages; and calendar status failure/retry. Successful provider reads were supplied as fixture evidence to the real local decision transaction; production Google/Outlook acceptance is not claimed. The stale path exercised the actual API. Local fixture data was removed.
- Full web type checking, targeted lint and tracked whitespace checks passed. Local advisors remain at 1,386 existing WARN/ERROR with none added.

Evidence is in active workspace `work/calendar-review/`: `web-final.log`, database suite logs, `browser-pagination.log` plus `browser-pagination-final.log`, `types-final.log`, `lint-final.log` and `advisors.json`. Earlier failed runs are retained: a fixture needed its required widget key; an obsolete observation test needed a reconciled event before an ordinary local reschedule; a temporary test trigger conflicted with concurrent browser fixture writes and passed when rerun serially. The 101-record fixture insert exceeded the local API statement limit and was qualified in batches of ten; this is not a bulk-import performance qualification.

Migration `20260916104950_phase_five_calendar_review.sql` was applied only to the local schema, without migration-history changes. No hosted migration, live send, provider event write, backlog replay, deployment, commit, push or training occurred. Ship the API/functions/UI together only after the existing release gates.

## Remaining scope

Keeping/recreating a console event directly from this review UI, changed-duration adoption, legacy/manual booking binding and real-provider calendar/account/scope/token/invite qualification remain open. Restoring the original provider event and checking again can clear a drift before ordinary scheduling. Comprehensive public/system/interactions and the other product journeys remain required; this is not TourSpark, LumaLeasing or Phase 5 completion.
