# Phase 5 — recoverable calendar timezone setup

September 16, 2026. Qualified locally; Phase 5 remains active.

Both calendar authorization callbacks preserve a missing provider timezone as unknown instead of substituting Chicago. Provider timezone lookups are bounded; their failure can retain a valid authorization while requiring setup. Calendar connection writes require a returned row, and failed reads of an existing connection cannot trigger a blind insert. Authorization redirects distinguish setup required and return the operator to the saved property.

The status API reports the effective property timezone and a separate setup requirement. Both the Integrations and Configuration screens provide missing-timezone setup, explicit connection-read failure and retry. The existing authenticated, property-scoped operation records one immutable action for a saved timezone; lost-response retries retain their identity. An external invite completion page identifies the remaining operator setup step.

## Evidence

- 88 service/API checks in nine files passed, including both callback paths, Google/Microsoft malformed or missing settings, read/write acknowledgement failures, property scope and status truthfulness.
- Eight distinct local browser journeys passed across calendar setup, status recovery and existing console booking. The new setup journeys used real local properties/calendar rows and verified one persisted action after a lost response; all fixtures were removed. Screenshots of the mobile retry, integrations and external completion views were inspected.
- Full web type checking passed. Changed-file lint has no errors and one existing unused-property warning.

Evidence: active workspace `work/calendar-setup/`, including `web-final.log`, `browser.log`, `browser-final.log`, `types-final.log`, `lint.log` and screenshots. No schema migration was needed. No live authorization, provider send, hosted migration, deployment, backlog replay, commit or push occurred.

## Remaining scope

This qualifies missing timezone setup, not full provider connection readiness. Scope validation, token rotation and persistence, invite consumption, account replacement, legacy timezone/data qualification and external calendar conflict decisions remain open. The authorization itself is not yet recorded as a complete immutable semantic action. Existing records remain training ineligible.

Browser work also exposed weak Luma configuration load/save handling. That adjacent journey is the next local increment: truthful reads, recoverable saves and atomic calendar/property settings with action history.

Provider settings contracts checked: [Google settings get](https://developers.google.com/workspace/calendar/api/v3/reference/settings/get) and [Microsoft mailbox settings](https://learn.microsoft.com/en-us/graph/api/user-get-mailboxsettings?view=graph-rest-1.0). Provider responses in these tests were fixtures.
