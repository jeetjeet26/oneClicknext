# Phase 5 — calendar availability and saved booking times

September 16, 2026. Qualified locally; TourSpark and Phase 5 remain in progress.

Availability uses property-local dates and exact instants. Google and Microsoft responses must identify the requested calendar/mailbox and include valid busy intervals; provider errors cannot appear as free time. Reads and writes have bounded authentication retries. Slot generation respects configured duration, an explicit zero buffer, working hours, past times and daylight-saving boundaries. The visitor calendar retains the selected property date across visitor timezones, displays the timezone and offers recovery after failed availability reads.

New console and public reservations save their original timezone. Database capacity checks compare actual instants across saved timezones, even after property settings change. Public reservations validate their saved context under the property lock; stale timezone/start context cannot silently change the booking. Calendar links, confirmation attachments and provider writes use the saved instant and booked duration. Existing bookings are not retroactively assigned a timezone. Delivery with unqualified legacy context is held for review.

Google event identities remain valid for compound request keys, and a duplicate event is accepted only after its identity and times match. Update/cancel paths honor the delivery pause, bound authentication retries and validate acknowledgements. The operator tour card and reschedule form show the saved timezone.

## Local evidence

- 127 service/API checks in 15 files passed, including malformed provider responses, DST, exact provider writes, bounded authentication retry, delivery pause and conflicting duplicate events.
- 252 database assertions passed in rolled-back transactions: 22 new timezone/capacity checks and 230 existing scheduling, console booking and reminder checks.
- 16 distinct browser journeys passed across the existing Luma recovery suite and availability/console booking runs. One real local booking retained its timezone and calendar link after changing property settings; public provider availability was simulated. Full-page console, mobile error/retry and visitor timezone screenshots were inspected.
- Full web type checking passed. Targeted lint had no errors; the broader changed-file pass retained 20 existing warnings. Database advisors remained at 1,386 existing WARN/ERROR, with none added.

Evidence is in the active Codex workspace under `work/calendar-availability/`: `web-final.log`, `types-final.log`, `lint-final.log`, `lint-last.log`, `db-final.log`, `db-scheduling.log`, `db-console.log`, `db-reminders.log`, `browser.log`, `browser-complete.log` and `advisor-delta.json`. Test counts overlap earlier increments and are not cumulative unique platform coverage.

Migration `20260916084436_phase_five_booking_timezone.sql` is applied only to the local schema, without updating migration history. No hosted migration, real provider send, deployment, backlog replay, commit or push occurred.

## Remaining scope

OAuth setup still needs truthful missing-timezone handling. Local pending reservations are enforced at booking but are not yet merged into displayed provider availability. Operator adoption/rejection of external changes, manual-tour connected calendar bindings, legacy delivery review, token rotation/persistence qualification and full public/system action capture remain open. Real Google/Microsoft account permissions and recipient acceptance remain unqualified. No action became training eligible.

Provider contracts were checked against the official Google Calendar free/busy and event-insert references and Microsoft Graph getSchedule, scheduleInformation and event-update references. Local tests use provider fixtures; they do not establish live provider acceptance.
