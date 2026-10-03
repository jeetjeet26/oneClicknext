# Phase 5 — calendar credentials and recorded disconnect

September 16, 2026. Qualified locally; Phase 5 remains active.

Calendar renewal now has one database-backed owner per connection. Google and Microsoft operations and the Python monitor use the same claim/finalize contract. Rotated refresh tokens are saved with the access token before use. A renewal response from before a disconnect or replacement cannot restore or damage the newer connection. Repeated finalization recovers one result; an uncertain provider exchange requires review instead of blindly repeating an exchange. Known revoked, disconnected and unconfirmed credentials are held even if an old access token has time remaining.

Calendar removal clears local credentials and pending renewal ownership in the same transaction as `calendar.disconnected`. Membership is rechecked, retries recover the same decision, and an action-recording failure rolls back removal. Activity history records actor, property, provider and compact state/version changes without credentials or account email. No event is training eligible. This removes the local connection; it does not revoke the provider's consent grant. System renewal diagnostics are separate audit records; comprehensive shared system-action coverage remains open.

Browser roles no longer have direct credential-table access. Server routes remain the supported access path. The UI shows unconfirmed renewal and reconnect guidance, refuses to describe invalid/missing expiry as a connected account, and distinguishes unavailable automatic Outlook updates from Google watch health. It no longer prints raw webhook blocker codes in the calendar warning.

## Verification

- **108 service/API checks** passed across nine suites, including token rotation, malformed/failed responses, uncertain acknowledgements, provider reads/writes, status and recorded removal.
- **15 Python checks** passed for the monitor's Google/Microsoft exchange, rotation, uncertain result and confirmed persistence handling.
- **184 database assertions** passed: 41 new credential checks plus 35 external calendar review, 57 tour action history, 29 Luma configuration and 22 timezone checks. Tests cover competing claims, exact replay, stale responses, disconnect/reconnect, expiry, tenant scope, role access and rollback when action recording fails.
- **Eight distinct browser journeys** passed: two credential/removal journeys plus three calendar setup and three Luma configuration regressions. The two credential journeys were repeated after improving Outlook guidance. The actual local API/database recovered a lost disconnect response, recorded one action and rejected a late renewal; provider exchanges were simulated. Screenshots were inspected.
- Full web type checking, targeted lint and whitespace verification passed. Database advisors remained at 1,386 existing WARN/ERROR with zero added. Temporary fixtures were removed.

Evidence: `work/calendar-credentials/` in the active Codex workspace. Final runs: `web-verified.log`, `python-final.log`, `db-final.log`, the four database regression logs, `browser-final.log` and `browser-verified.log`, `types-final.log`, `lint-final.log`, and `advisor-delta.json`. Earlier failed fixture/compilation/lint runs are retained; their fixes and successful reruns are not additional unique tests.

Migration `20260916111615_phase_five_calendar_credentials.sql` is applied only to the local schema without migration-history changes. API, UI, worker and schema must ship together after release qualification. No hosted migration, live OAuth/provider request, send, deployment, backlog replay, commit, push or training occurred.

## Remaining scope

Consent scope/account identity, invitation finalization, atomic calendar/email authorization and stale authorization callbacks are still open. This renewal protocol does not by itself qualify OAuth connection/reconnection races or email credential renewal. Real-provider acceptance, calendar restoration/changed duration/manual binding, legacy delivery and remaining public/system/operator actions are also open. The monitor's fleet pagination and full permissions/event-access health probe remain to be qualified. Local browser/regression evidence is not production provider acceptance.

The provider rotation behavior follows [Microsoft refresh-token documentation](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens); granted-permission handling is a separate next step under [Google's OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
