# Phase 5 — ForgeStudio saved access renewal

September 17–18, 2026. Local qualification only; Phase 5 and client/autonomy readiness remain open.

Managers can request renewal for the exact saved account/version with a reason. The private renewal intent freezes actor, organization, property, provider app identity and encrypted credentials before a provider exchange. A unique connection/version receipt permits one exchange. A lost claim response, concurrent request, unknown result or reload never repeats that exchange. Only identical result persistence may be retried. Unconfirmed credentials cannot start a publication; fresh reviewed authorization is the recovery path.

Successful provider evidence rotates access and refresh credentials, retains actual expiry/scopes, increments the connection version and records the resulting action in one transaction. Disconnect, new consent, app changes and lost operator access fence a late response. It remains private evidence without replacing later connection state. Unknown/malformed expiry, reduced permissions, changed account identity and incomplete reads remain held. Renewal never starts or resumes publications. An already-started publication must settle before renewal begins.

Meta conversion/extension uses the existing user grant, then reads actual permissions and the exact saved page/account. LinkedIn, TikTok and X use their refresh contracts. A returned refresh token replaces the earlier one; omission retains the earlier token and its known expiry. No refresh-token lifetime, permission or indefinite page-token lifetime is invented. LinkedIn encoded scope is decoded. Fixed provider origins, bounded reads and no exchange retries are retained.

The console shows current renewal state and paginated safe history, failed reads/reload and explicit fresh-consent recovery. Refresh credentials never enter the browser response. Missing encryption setup and the outbound pause disable new provider work. Existing saved results remain readable during a pause. Property changes discard stale local state.

## Recorded evidence

- `studio.credentials.renewal_requested`: the actual manager, exact account/version and stable request; mutation and action commit together.
- `studio.credentials.renewal_completed`: provider-result origin and requesting operator are explicit; completed/held outcome and credential mutation commit together. It has workflow origin and does not assert a human independently performed the provider operation.
- Encrypted token receipts and immutable exact results remain private. If the original operator leaves the organization, private evidence still survives but the current shared history contract cannot attribute a new system event without that member. Comprehensive system-principal coverage remains open.

## Verification

398 service/API checks across 52 ForgeStudio suites; 399 rollback SQL assertions across ten suites; all 35 ForgeStudio browser journeys pass. New checks cover rotation, scope/expiry omission, account mismatch, lost claim/finalization replies, one exchange per version, late disconnect/new-consent/app changes, action rollback, privacy, pause, property-scoped cursor rejection and reload recovery. The new mobile history screenshot was inspected.

Full TypeScript and schema/type stamp checks pass. Changed-file lint has no errors; the two existing DraftList/ReviewStudio warnings remain. Advisors have the same 1,333 warning/error identifiers with no additions or removals. 175 saved function definitions match local database bodies. Test fixtures, orphan records and new migration-history entries are zero. Local migration: `20260918044850_phase_five_forgestudio_renewal.sql`.

The first SQL runs found a reserved variable name and a JSON operator-precedence error; both were corrected and the full suite passed. A browser fixture initially used the old seed's nonstandard UUID; the corrected test uses a separate valid property and verifies actual cross-property cursor rejection. Existing app setup tests used a temporary process-only encryption key. The ordinary preview was restored afterward with outbound/workflow delivery paused. No env file changed, provider/model call, real renewal, send, publish, revocation, hosted write, training, deployment, commit or push occurred.

## Primary contracts and remaining gates

References: [RFC 6749 refresh tokens](https://www.rfc-editor.org/rfc/rfc6749#section-6), [LinkedIn programmatic refresh](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens), [TikTok token management](https://developers.tiktok.com/docs/en/oauth-user-access-token-management), [X user access tokens](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token), and the official archived [Meta OAuth client](https://github.com/facebookarchive/php-graph-sdk/blob/5.x/src/Facebook/Authentication/OAuth2Client.php). Meta documentation endpoints were unavailable; SDK evidence qualifies local wire mocks, not current live provider acceptance. LinkedIn refresh access depends on approved partner eligibility.

Automatic renewal scanning is not enabled. Real tenant/app eligibility, live rotation/expiry/permissions, remote revocation and consent health, comprehensive system and interaction records, deployment encryption configuration, and remaining product acceptance stay open. Continue ReviewFlow and the full retained-product register without another user prompt. Existing models remain the default; no training/export is enabled.
