# Phase 5 — recorded, recoverable Luma configuration

September 16, 2026. Qualified locally. This completes the configuration initialization/save increment; LumaLeasing and Phase 5 retain other open journeys.

Opening Configuration is now a read. An unavailable read has a retry state and cannot appear as an unconfigured assistant or create a replacement record. Initialization is explicit, retains a stable request identity and records its result. Missing timezone remains unknown.

Saving settings commits the widget, relevant property timezone, enabled-calendar duration/buffer/hours/timezone and immutable action evidence in one transaction. Previously ignored avatar, floor-plan and availability URLs now persist. HTTP validation permits public HTTP(S) image/navigation URLs without embedded credentials. The form shows pending changes, confirmed saves, unconfirmed saves and stale versions. Lost-response retries recover the prior decision without repeating the mutation. A stale draft is preserved until the operator loads current values; it cannot overwrite a later change in widget, property or calendar settings.

The private operation rechecks property ownership and validates fields. Unknown legacy tour timezones block a property-timezone change for review. Action-recording failure rolls back all business changes. `luma.configuration.created` and `luma.configuration.saved` carry trusted actor, input hash, before/after settings, outcome and stable identity. Stale and legacy-review decisions remain failed outcomes. Widget API keys and provider tokens are excluded from action snapshots. These events remain training ineligible. Activity history displays the new actions and concise setting summaries.

Older abbreviated weekday settings display correctly in the editor and public-hours read. An unknown timezone or malformed schedule cannot be reported as verified online hours; midnight and closing-time comparisons are explicit. The public widget currently does not render the `isOnline` response field, so this does not establish a new visitor-facing hours indicator.

## Evidence

- 59 service/API checks in the final four-file run passed, covering settings access/validation/acknowledgements, public hours and shared activity APIs. An earlier broader validation run is separate evidence and is not added as unique coverage.
- 115 database assertions passed in rolled-back transactions: 29 new configuration checks, 29 shared-history checks and 57 tour-history regressions. This covers wrong scope, no creation on read, idempotent initialization/save, property/calendar alignment, stale drafts, token/key exclusion, action failure rollback and legacy-timezone protection.
- Seven distinct local browser journeys passed across configuration, calendar setup and status suites. The final three settings journeys verified actual local rows and activity history, lost-response retries, preserved drafts and reload. Temporary properties were removed; a separate query confirmed zero remaining fixtures. Screenshots were inspected.
- Full web type checking, targeted lint and tracked-file whitespace checks passed. Database advisors remain at 1,386 existing WARN/ERROR, with none added.

Evidence: active workspace `work/luma-configuration/`: `web-final.log`, `db-final.log`, `db-action.log`, `db-tours.log`, `browser.log`, `browser-final.log`, `browser-recording.log`, `types-final.log`, `lint-final.log`, `lint-last.log`, `advisor-delta.json` and screenshots. A local schema snapshot was saved before changes. The CLI rejected a multi-statement transaction before executing it; the local database client applied the transaction successfully.

Migration `20260916092144_phase_five_luma_configuration.sql` was applied only to the local schema. Migration history and hosted state were not changed. No live sends, authorization, backlog replay, deployment, commit, push or model training occurred. The web API and functions must be released together after Phase 6 reconciles schema/history/types.

## Remaining scope

Logo upload/key rotation, integration authorization/revocation, every chat/handoff/lead action, draft recovery across navigation and full Luma configuration accessibility remain separate qualification work. Provider token/scope/invite/account replacement and external calendar decisions remain open. This increment does not accept a real provider connection, finish TourSpark/LumaLeasing, or complete the holistic product plan.
