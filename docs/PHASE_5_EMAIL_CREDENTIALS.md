# Phase 5 — reliable email credential renewal

September 16, 2026. Qualified locally; the full product plan and Phase 5 remain active.

Email access now uses private, versioned claim/finalize operations. Every service use rechecks the saved connection, including apparently unexpired credentials. Only one attempt can exchange a connection's refresh token. A successful response commits access token, rotated refresh token (or the retained original when omitted), expiry, credential version and sanitized refresh audit together. A lost database acknowledgement retries only the identical finalization; it never repeats the OAuth exchange. A delayed success or revocation cannot overwrite a disconnect or newer authorization.

Unknown network outcomes, malformed responses and abandoned attempts stop further exchange until review/reconnection. Explicit provider failures have a cooldown; only structured invalid_grant proves revocation. Provider requests have a 20-second timeout. Gmail/Outlook API 401 recovery now allows at most one renewal/retry per operation. Watch metadata saves require the same enabled credential revision and an acknowledged row. No credential or raw OAuth error is stored in action history.

All email entry points carry the saved version/identity: property lookup, scheduled sync and inbound webhook. Repository inspection found no separate Python email-refresh worker. The scheduled sync no longer guesses revocation from error-message text or writes unfenced health updates, does not call/count Gmail watches for Outlook, and reports failed/partial sync honestly. Its credential check proves current saved access, not successful provider mailbox health. Remaining fleet pagination and complete sync-result recording are open.

Email status cannot be connected with missing, invalid or expired expiry. Read failures are errors rather than disconnected accounts. The email settings panel shows loading/error/retry states, cancels stale reads and provides readable renewal guidance. Outlook states explain scheduled inbox checks without Google watch warnings. The integrations panel no longer labels an expired healthy-stored credential as healthy access.

Email disconnect now supersedes pending renewal attempts in its existing atomic action transaction. Before/after evidence includes credential version, never token values. Authorization snapshots also include the email version. Refresh diagnostics remain a separate private audit, not fabricated operator activity or complete system-action coverage. Training eligibility remains off.

## Verification

- 97 service/API checks across nine suites: credential renewal, API retry limits, inbox behavior, scheduled sync, status, inbound webhook, calendar renewal and authorization.
- 130 PostgreSQL assertions: 41 email credential, 41 calendar credential and 48 authorization checks. These cover concurrent claims, lost responses, rotation, disconnect/reconnect races, uncertain outcomes, account/property identity, privileges and transactional audit/action rollback.
- Five actual local service/database journeys with simulated provider responses: lost committed response, simultaneous renewal, disconnect during provider response, uncertain exchange and delayed invalid-grant after new consent.
- Five browser journeys: email disconnect with lost response and late renewal; uncertain email guidance; failed email status/retry; two existing calendar recovery regressions. Screenshots inspected.
- Full web type checking passed. Targeted lint and whitespace checks passed. Advisors remained at 1,386 existing WARN/ERROR, with zero added. Test fixtures removed.

Evidence: `work/email-credentials/` in the active Codex workspace, including `web-final.log`, `email_credentials.log`, `calendar_credentials.log`, `integration_authorization.log`, `persistence.log`, `browser-final.log`, `types-final.log`, `lint-final.log`, `advisor-delta.json` and inspected screenshots. Initial status tests exposed an old fixture without expiry; it was corrected and missing-expiry rejection separately verified.

Migration `20260916175635_phase_five_email_credentials.sql` is local only, without migration-history edits. Release requires coordinated schema/API/UI deployment; old email writers must not run against the new protocol. Generated database types/history reconciliation remain Phase 6 work. No hosted mutation, live OAuth/provider call, send, backlog replay, deployment, commit/push, export or training occurred.

## Remaining plan

Deliberate account replacement/rebinding and invitation creation/revocation UI and action recording are next. Existing/renewal grant and Microsoft tenant policy, actual provider permissions/revocation, fleet-wide health, inbox completeness/receipts, synchronization writes after connection changes and full public/system activity remain unqualified. Calendar restoration/manual binding/legacy delivery and all remaining retained product journeys are still required. This increment completes the local email renewal protocol, not the email product, integrations, TourSpark or Phase 5.
