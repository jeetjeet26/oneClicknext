# Phase 5 — recoverable client authorization links

September 16, 2026. Locally qualified; Phase 5 and the holistic console plan remain active.

Operators can create, recover and revoke property-specific Google/Microsoft calendar/email authorization links from Integrations or the relevant leasing settings tab. The panel shows Pending, Used, Expired and Revoked states, loading/error/retry controls and cursor-based access to older links. Raw token previews are no longer returned by the list API. Only the original creating operator can recover a modern link; authorized property operators can revoke unused links. Legacy links remain visible/revocable but do not claim recoverability.

Creation uses a stable request identity and a domain-separated HMAC capability. The database stores only its hash; retry recovers the exact URL without another stored token copy. Recovering a link never extends its seven-day expiry. The optional INTEGRATION_INVITE_SECRET must remain stable and private; the existing integration OAuth state/provider secret chain is the fallback. Rotating the signing key prevents recovery of old URLs, while already-issued hash-backed links remain valid until consumption, expiry or revocation. Missing server configuration produces a visible error; no real configuration was installed for this local qualification.

Creation and its shared activity record commit together. Revocation, cancellation of pending/claimed authorization and its activity record also commit together. Both retry only the identical database operation after an unacknowledged save. A client response arriving after revocation cannot connect. If authorization already consumed the link, a revoke decision records a failed already-used result and preserves the connected account. Removing that account remains a separate explicit action. Membership is checked within the mutation transaction. Recording failures roll back the authority change.

The UI preserves an unconfirmed request for retry, including a lost revocation response after the list already shows Revoked. Reloaded pages can recover the original pending link from history. Clipboard success is reported only after the copy resolves; the selectable URL remains available if clipboard access fails. All caller-provided provider/capability/property/request values are validated; unknown capabilities and arbitrary expiry extension are rejected.

The public link page now reads a minimal token-authorized summary, names the property and requested access, and offers only the selected provider. Used, expired and revoked links show recovery guidance without a continuation button. A database outage is distinct from an invalid link. The page is excluded from indexing and uses a no-referrer policy. Opening this page does not consume the invitation or call a provider.

## Action evidence

`integration.invite.created` and `integration.invite.revoked` record server-confirmed before/after state and actual result in Activity history. Tokens, token hashes and copyable URLs are excluded. Exact replay preserves the original event; late revocation after consumption is marked failed. All events remain training ineligible. Link viewing/copying, denied/failed authorization attempts and comprehensive public/system observations are still separate coverage work; this does not claim complete integration telemetry.

## Verification

- 141 service/API checks across 15 suites passed, covering both this invitation increment and the email renewal increment.
- 253 PostgreSQL assertions passed sequentially: 37 invitation lifecycle, 48 atomic authorization, 41 email credential, 41 calendar credential, 57 tour action-history and 29 leasing configuration checks.
- Nine browser journeys passed: four invitation journeys (lost creation/revocation responses and recovery after reload; consumed link; read recovery and 27-row pagination; main Integrations entry and public provider-specific/revoked page), three email recovery journeys and two calendar regressions. These use real local authenticated HTTP routes and database operations. Provider authorization in the consumed-link fixture uses synthetic evidence passed to the real transaction; no live OAuth exchange is claimed.
- Five actual local renewal service/database journeys passed in the preceding email increment with simulated provider responses.
- Full web type checking and targeted lint passed; tracked whitespace checks passed. Advisors stayed at 1,386 existing WARN/ERROR with zero additions. All temporary properties were removed. Screenshots were inspected; the revoke-panel capture is during its final history refresh.

Evidence is in `work/integration-invites/`: `web-final.log`, the six database suite logs, `browser-final.log`, `types-verified.log`, `lint-final.log`, `lint-fixture.log`, `advisor-delta.json` and inspected screenshots. Earlier SQL test attempts exposed ambiguous test-variable names, which were corrected; no production SQL change was required. Type checking also identified a nullable browser-fixture read, now checked explicitly.

Migration `20260916181353_phase_five_integration_invites.sql` is applied only to local schema, without migration-history edits. The new creation/revocation API requires stable request identities and coordinated API/UI/schema rollout. Browser verification temporarily supplied a fake invitation key; the ordinary preview was restored with delivery paused and no fake key or environment-file changes. No hosted migration, deployment, real provider request, send, backlog replay, commit/push, dataset export or model training occurred.

## Remaining plan

Deliberate account replacement and linked booking/mail rebinding are next. Remaining tenant/scope-health qualification, provider acceptance, calendar restoration/manual binding, legacy delivery, complete invitation/authorization/public/system recording, other retained product journeys and Phase 6 schema/type/history reconciliation remain required. No product or phase is declared fully client-ready by these two increments.
