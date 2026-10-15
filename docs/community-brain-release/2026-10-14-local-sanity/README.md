# Community Brain local sanity pass

October 14, 2026. The current uncommitted implementation was checked in isolated local services. No hosted staging environment was provisioned; no production schema, deployment, provider invocation, publication or spending change was made. Initial cloud inventory reads confirmed that no staging branch existed. The substantive qualification uses synthetic communities and the retained schema-only Supabase baseline.

## Findings and fixes

1. **Duplicate asset approval was reported as a server failure.** Uploading the exact bytes of an existing community asset correctly hit `content_assets_property_content_hash_idx`, but the API returned a generic 503. It now returns an actionable 409. It does not overwrite the existing asset, change its role or rights, or infer that identical bytes establish the same provenance. Other database details remain hidden. Both duplicate rejection and successful approval of a new image were verified in the browser.
2. **The test launcher could inherit unrelated credentials.** It previously copied the shell environment and masked only four environment files. It now inherits only required operating-system settings, reserves names from all project environment-file layers, supplies synthetic local credentials, and rejects non-local or credential-bearing application origins. Tests cover inherited secrets, proxy settings, Node preload settings and development-specific environment files. This changes the qualification launcher, not the developer's environment files.
3. **Repeated browser runs shared build state.** A repeat run served a stale 404 for an existing API route. Each run now receives a fresh build directory, and readiness requires the protected route's expected unauthenticated response. Temporary build state is cleaned up and existing TypeScript configuration is preserved.

## Verified evidence

| Boundary | Result |
| --- | --- |
| Schema baseline and migrations | Fresh isolated replay of all 18 migrations and all three real-role SQL suites passed |
| Browser → application → database/storage | 18 checks passed with real APIs and no mocked responses |
| Auth, worker/storage access and recovery | 33 HTTP/recovery checks passed |
| Background worker | Seven jobs completed with no unconfirmed jobs or queue errors in the recorded run; two browser-uploaded images were processed by the actual container |
| Focused web regression | 15 tests passed, including duplicate-conflict handling, opaque authorization failures and exact downloads |
| Local configuration isolation | Two tests passed |
| Static validation | TypeScript, changed-module ESLint, schema/type stamp, foundation trust boundaries, runtime configuration checks, syntax checks and whitespace checks passed |

The browser checks include exact approved floorplan downloads, matching checksums and ZIP manifests, denial of an asset outside the explicit portfolio selection, foreign-community denial, administrator-only activation controls, eligible historical replay, signed private image upload, actual worker extraction, generated-floorplan rejection in the review UI, duplicate handling, successful image approval and recursive memory projection. The approved image becomes community-owned reference/style evidence; it does not establish verified facts.

The HTTP recovery checks separately confirm immediate rights expiry, revocation with an unchanged worker credential, refusal to renew a revoked credential, metadata restoration, independent original-byte restoration and the continued enforcement of private access and expired rights after restoration.

## Scope and remaining limits

- The local browser journey uses representative synthetic PNG assets. It does not certify every document, font, video, floorplan, source connector or generator journey.
- Provider/model credentials are absent from the local application and parser. Real semantic retrieval quality, generated output fidelity and live provider behavior remain unqualified.
- Recovery verifies the tested original and database state. Complete rendition and customer-estate backup/recovery remains open.
- No marketing channel was published, connected to a new live destination or granted media-spending authority.
- This pass does not complete the full implementation plan. The remaining channel adapters, attribution/cost reconciliation, provider retention/deletion, measured learning and operational acceptance remain in the [implementation status](../../COMMUNITY_BRAIN_IMPLEMENTATION_STATUS_2026_10_13.md).

The [sanity manifest](sanity.manifest) records current file hashes, the previous candidate manifest hash and sanitized check receipts. The original release manifest remains unchanged as historical evidence. Thirteen originally dirty files remain byte-identical to their pre-implementation versions; the previously extended portfolio module remains unchanged by this pass. The temporary test services were stopped. The final synthetic candidate and restore databases remain available locally for inspection.

## Reproduce locally

Use a new disposable database name for each run; the harness refuses to reset an existing database. The retained schema exports contain no customer rows. With the existing local Supabase services and qualified worker image available:

```sh
python3 p11-platform/supabase/qualification/replay_community_brain.py \
  --public-schema /private/tmp/community_brain_live_public_20261013.sql \
  --system-schema /private/tmp/community_brain_local_system_20261013.sql \
  --database community_brain_replay_local_review
python3 p11-platform/supabase/qualification/http_community_brain.py \
  --database community_brain_replay_local_review --web --restore
python3 -m unittest discover \
  -s p11-platform/supabase/qualification -p test_local_environment.py
```

The qualification run needs local Docker access and temporary localhost listeners. It preserves the developer database, server and existing uncommitted work.
