# Phase 5 — confirmed calendar and email consent

September 16, 2026. Qualified locally; Phase 5 remains active.

Both calendar authorization callbacks now validate the token response and required capability permissions before saving a connection. Missing, malformed and partial grants cannot replace an existing connection. A combined calendar/email request stops before either save if a selected capability is missing. Saved scope lists come from the confirmed grant instead of a fabricated list of requested permissions. The legacy Google callback uses the same validation.

Google requires an explicit scope response. Microsoft documents omitted scope as the original authorization request; new signed state retains that exact server-selected scope list, and the callback records `microsoft_request_contract` as the evidence source when that rule is used. Older state without that evidence requires a fresh request. Explicit empty or partial Microsoft scopes never fall back to the requested list. Comparisons recognize Graph-qualified scope names while rejecting lookalike resource prefixes. No unsigned token claims are used for authorization.

Credential shape, Bearer token type and finite positive lifetime are checked before provider account reads or writes. Both callbacks avoid logging raw token-exchange response bodies. The console displays readable permission/connection errors and opens the affected property's integration controls. External authorizers remain on their public result page after a verified-state grant failure. Arbitrary error-query content is not displayed as instructions or diagnostic detail.

## Verification

- **90 service/API checks** passed across seven suites: malformed credentials; absent, partial, combined and similarly named grants; signed scope evidence and tampering; real callback wiring; existing start, property access, timezone and persistence-acknowledgement behavior.
- **Six actual local database journeys** passed through both callbacks with simulated provider replies. Failed consent preserved the prior stored credentials/version; valid Google consent saved exactly its confirmed permissions; partial combined consent created no email connection; omitted Microsoft scope preserved the signed request and its evidence source. Temporary records were removed.
- **Five browser journeys** passed: console permission failure/recovery, external permission guidance on mobile, and three existing timezone setup journeys. Screenshots were inspected. The browser tests do not conduct live consent; real callback/database paths are exercised separately above.
- Full web type checking and tracked whitespace checks passed. Targeted lint had zero errors and one existing unused `propertyId` warning in the conversations component. This increment changes no schema; the preceding credential increment's advisor result remains separately dated evidence.

Evidence is in `work/calendar-consent/` in the active Codex workspace: `web.log`, `persistence.log`, `browser.log`, `types-final.log`, `lint.log` and inspected screenshots. Local database verification runs only with `P11_LOCAL_CONSENT_TEST=1` and a localhost database; it intercepts provider requests. No live OAuth, provider call, send, deployment, hosted migration, commit, push or training occurred.

## Remaining scope

This is permission-response qualification, not complete integration acceptance. Account replacement and provider identity/tenant binding, invite expiry/revocation/consumption at final commit, atomic calendar/email saves, authorization replay and callbacks racing a disconnect remain open. Existing saved grants are not retroactively requalified. Renewal-time scope changes, operational capability health, email credential renewal, full shared connection/system action recording and actual provider acceptance remain open. No new semantic connection event or training eligibility is claimed by this validation increment.

Calendar restoration/changed duration/manual binding, legacy delivery and the other retained products remain required under the holistic plan.

Provider contracts: [Google granted-scope verification](https://developers.google.com/identity/protocols/oauth2/web-server#check-granted-scopes), [Microsoft code-flow token responses](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#successful-response), [Calendar permissions](https://developers.google.com/workspace/calendar/api/auth), and [Gmail permissions](https://developers.google.com/workspace/gmail/api/auth/scopes).
