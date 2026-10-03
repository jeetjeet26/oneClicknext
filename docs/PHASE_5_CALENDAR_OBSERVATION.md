# Phase 5 — calendar observations and honest recovery status

September 16, 2026. Qualified locally; TourSpark and Phase 5 remain in progress.

Calendar comparisons now normalize provider timestamps to actual instants and use the booked tour duration. Microsoft reads explicitly request UTC; Google offsets and named zones are interpreted consistently. Unknown, invalid, ambiguous or nonexistent local timestamps do not pass as matching appointments. Provider event reads have a bounded authentication retry.

Each provider observation saves only its event ID, status and start/end values. The database rechecks property/calendar/binding identity, active booking and schedule version under the scheduling lock. A response from before a local schedule change, pending update or newer observation cannot replace current state. This is a latest observation, not comprehensive immutable system action history.

Calendar status read failures display a retry state rather than disconnected/empty health. Legacy repair holds external changes and pending local work for review instead of silently overwriting them. It uses the booked duration and a stable event request identity, checks binding writes, and counts creation/repair only after the durable delivery checkpoint succeeds. Scheduled repair also requires saved start/completion acknowledgements and reports held/failed work honestly.

## Local evidence

- 59 service/API checks in 12 files passed, covering provider timestamps, stale observations, status failures, legacy repair and scheduled-run acknowledgement failures.
- 11 database assertions passed in a rolled-back transaction, including wrong scope, stale versions, pending changes, newer observations and restricted execution.
- One browser journey verified calendar status failure, disabled connection-copy controls, visible retry and recovery; its full-page screenshot was inspected.
- Full type checking and targeted lint passed. Database advisors remain at 1,386 existing WARN/ERROR, with none added.

Evidence is in the active Codex workspace under `work/calendar-observation/`: `web-final.log`, `db.log`, `browser.log`, `types-final.log`, `lint-final.log`, `advisor-delta.json` and the full-page screenshot. Test counts describe this increment and overlap prior suites.

Migration `20260916080951_phase_five_calendar_observation.sql` was applied to the local schema only, without migration-history changes. No hosted migration, provider send, deployment, backlog replay, commit or push occurred.

## Remaining scope

Operator adoption/rejection of external changes, manual-tour connected calendar scope, free/busy and legacy/provider qualification remain open. Calendar configuration still needs explicit handling of missing timezone and uncertain reads; automatic/public/user-interaction action coverage remains incomplete. No observed event became training eligible. Continue these gaps and the remaining products, with all real-client/release gates retained.
