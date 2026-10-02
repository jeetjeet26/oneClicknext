# Phase 5 — ForgeStudio account connections and authorization

September 17–18, 2026. Local qualification only. Phase 5 and platform/client/autonomy readiness remain open.

## Result

Disconnect preserves the destination row and every published post, clears locally usable credentials, and atomically cancels queued publications without a saved provider-write intent. Already-started or uncertain remote work remains explicit. Fresh, reviewed consent can renew the same destination identity; cancelled publications never resume implicitly. Existing destination identity cannot be overwritten or deleted while its property exists.

App setup uses an exact version and stable decision identity. Lost responses recover the saved result without duplicate actions; a stale form cannot overwrite another operator's credentials. Disabling retains a tombstone that blocks fallback to environment credentials. Read or decryption failure never silently falls back to a different app. The saved secret is never returned. Missing server encryption setup is visible and disables credential saves.

A durable authorization freezes actor/property/organization, provider, redirect, requested scopes, app credential fingerprint, encrypted credentials, account/configuration versions and the PKCE verifier where needed. The first claimed callback permits one code exchange. Repeated, interrupted, wrong-provider or stale callbacks cannot acquire another exchange. Provider denial is handled only after signature, session, nonce and saved-provider validation. Late results remain private evidence but cannot restore a disconnected account or apply after app changes.

Provider results contain candidate accounts, not an automatic connection. The operator explicitly selects accounts for this property and records a reason. All selected grants are validated before any account activates. Returned permission scopes and expiry are retained; missing evidence is not replaced by requested scopes or hardcoded lifetime. Instagram returns all observed candidates instead of choosing the first one. Meta pagination follows cursors on a fixed provider origin, not a provider-supplied next URL. Partial or uncertain results require fresh consent. Requests have time and response-size bounds; no provider retry is performed.

Publication preparation now requires actual stored grant evidence, required scopes, encrypted credentials and at least ten minutes of remaining access. Unqualified legacy active flags remain holds. A connection security version fences changes even when token bytes are later restored. Account lists and destination pickers follow all pages, and a failed page cannot masquerade as a complete list. Authorization history is ordered newest first with a property-scoped stable cursor. Switching property aborts old reads and remounts decisions/forms.

## Recorded actions and evidence

- `studio.app_configuration.save` / `studio.app_configuration.disable`: versioned settings mutation and secret-free before/after evidence in the same transaction.
- `studio.connection.disconnected`: exact destination/version, reason in private command evidence, local cancellation counts and no claim of remote revocation.
- `studio.authorization.started`: actual operator and exact saved request; credentials remain private.
- `studio.authorization.cancelled`: versioned cancellation after operator review or a verified provider denial.
- `studio.authorization.applied`: selected accounts, review reason in private command evidence, preserved existing destination IDs and explicit `publicationStarted: false`.

The encrypted provider response and one-exchange claim are private durable evidence. They are not yet comprehensive shared system-action coverage. Missing, failed and uncertain provider responses are not positive outcomes or learning rewards. No training or provider export is enabled.

## Local verification

- 371 service/API checks across 49 suites; authenticated scope, strict API contracts, real encryption, provider wire mocks, permission/expiry omission, safe pagination, one-exchange behavior, lost claim/finalization replies, private DTOs and credential lookup errors.
- 355 rollback database assertions across nine ForgeStudio suites (314 existing assertions including strengthened publication checks, plus 41 new connection assertions). Destination history, queued cancellation, grant selection, late callbacks, current versions, atomic history rollback and browser-role isolation are covered.
- 32 distinct ForgeStudio browser journeys, including five new connection journeys. App save, disconnect and account review were checked after deliberately losing successful responses; tests also cover stale settings, pagination, failed reads and property switches.
- Full TypeScript and schema/type stamp checks pass. Changed-file lint has no errors; two pre-existing warnings remain in DraftList (unused Filter import) and ReviewStudio (image element).
- Local database advisors remain at the existing 1,333 warning/error identifiers, with no additions. Saved migration bodies match the running local functions; fixture/orphan checks are empty. The local migration was not stamped into migration history.

Browser verification initially exposed the preview's missing encryption key. A temporary process-only key enabled isolated app-credential save tests; it is removed when restoring the ordinary paused preview. A subsequent browser assertion was narrowed to the actual success notice while the form independently reloaded. The wider publication browser fixture also needed the newly required stored grant evidence; the guard correctly refused its old unqualified active flag. All 32 distinct journeys passed after that fixture update. Test data and credentials were isolated and cleaned up; no real provider, model, publish, send, revoke, training, export, hosted write or deployment occurred.

## Provider contracts and remaining gates

Wire mocks use primary provider references: [TikTok token management](https://developers.tiktok.com/doc/oauth-user-access-token-management), [LinkedIn authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow), [X user access tokens](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token), and Meta's maintained SDK definitions for [account/permission reads](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/user.py). Meta documentation endpoints were unavailable during verification; SDK contracts do not replace live provider acceptance.

Automatic token renewal/rotation is the next separate saved workflow; current renewal is fresh operator consent with explicit account review. Meta access uses the provider's supplied user-token lifetime conservatively; long-lived conversion and exact page-token health remain to qualify. Actual provider revocation, tenant/app approval/paid-tier requirements, remote health and permission changes, durable system events, remaining meaningful interactions, and representative real-provider acceptance remain open. Ordinary preview app-credential saves require a configured deployment encryption key. External authorization and delivery remain paused locally. None of those gates should be hidden by this local checkpoint.

Continue the remaining Phase 5 product register without waiting for another user instruction.
