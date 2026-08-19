# SiteForge Real Launch Validation

Use this runbook to close the provider-backed SiteForge P1 gate against the
disposable Aurora property. The automated lifecycle test is destructive and
must never target a client property.

## Acceptance gate

A run passes only when one execution proves all of the following against the
same website and immutable artifact lineage:

1. A semantic edit publishes a new immutable artifact.
2. The exact artifact renders and certifies in canonical WordPress preview.
3. An independent reviewer approves the exact artifact hash.
4. Cloudways staging reaches `staging_ready` with an exact remote-manifest
   readback.
5. A backup is created and recorded before promotion.
6. Staging is promoted and production reaches `live` with the same artifact
   hash.
7. Production health checks pass.
8. An immutable rollback revision is created.
9. The recorded Cloudways backup is restored and verified against the rollback
   artifact hash.
10. All lifecycle-owned test resources are cleaned up.

Do not check the roadmap item until every condition passes in one run.

## Preconditions

- Use a dedicated, disposable Cloudways WordPress production/staging pair.
- Never use Acacia or a client-owned production site.
- Use distinct operator and reviewer accounts.
- Start from a clean, current checkout.
- Ensure the local web app and Supabase stack use the same environment.
- Publish and assign the exact runtime-v3 package before the run.

## First-party artifact preparation

From a clean checkout, prepare and verify the first-party inputs before any
provider mutation:

```bash
npm run siteforge:artifacts:generate
SITEFORGE_THEME_SIGNING_KEY='<operator-supplied-key>' \
  npm run siteforge:artifacts:build
SITEFORGE_THEME_SIGNING_KEY='<same-key>' \
  npm run siteforge:artifacts:drift-check
```

Use the same explicit Git SHA and signing key for build and drift check. The
build creates the signed base-theme archive and a runtime-v3 archive with an
immutable package manifest. It does not publish either package, enable a
rollout, or prove anything about a WordPress target.

ACF JSON is generated first-party source and is covered by the drift check.
ACF Pro itself is a licensed external input: place the approved
`runtime-assets/advanced-custom-fields-pro.zip` beside its checked digest and
run `npm run siteforge:deployment-assets:verify`. Never claim that this
repository reproduced the ACF Pro binary.

The complete fail-closed environment contract is
`utils/siteforge/testing/aurora-lifecycle-e2e.ts`
(`AURORA_LIFECYCLE_REQUIRED_ENV`). In particular, configure:

- Aurora property, website, target, rollout, owner, and account identities
- runtime, runtime-manifest, and base-theme SHA-256 identities
- a lease expiry no more than 24 hours in the future
- preview WordPress and Cloudways credentials
- runtime-v3 public keys and overlay/promotion signing secrets
- `AURORA_LIFECYCLE_CLEANUP_CONFIRM=DELETE_OWNED_AURORA_RESOURCES`
- all SiteForge runtime/editor/lifecycle flags required by the preflight

The current boolean opt-ins are exact, case-sensitive values:

```text
AURORA_LIFECYCLE_E2E=1
SITEFORGE_AURORA_LIFECYCLE_CONTROL_ENABLED=true
SITEFORGE_RUNTIME_V3_ENABLED=true
SITEFORGE_SEMANTIC_EDITOR_ENABLED=true
SITEFORGE_RUNTIME_EXTENSIONS_ENABLED=true
```

These Aurora requirements are stricter than normal product defaults. Runtime
v3 and runtime extensions default off; the semantic editor defaults on unless
explicitly disabled. A built runtime-v3 ZIP does not enable runtime v3.

Keep credentials in the operator environment. Do not add them to the repo.

The default local smoke is intentionally non-provider-backed. It verifies the
approved plan, immutable generation artifact, persisted local preview
architecture, and the fail-closed deterministic-quality, canonical-preview
approval, staging, launch-preparation, and rollback-revision boundaries. Only
the opt-in Aurora test may satisfy the provider acceptance gate above.

## Run

From `p11-platform/apps/web`, run only the owned Aurora lifecycle test:

```bash
npx playwright test e2e/local-smoke.spec.ts \
  --grep "Aurora same-website runtime-v3 lifecycle"
```

The test has a two-hour default timeout. It acquires an ownership lease before
mutation and performs cleanup in `finally`, including when the primary flow
fails.

The staging workflow requires a persisted Cloudways clone checkpoint. The
deploy route (`POST /api/siteforge/deploy/{websiteId}`) is the single clone
initiator: it creates the staging target, starts the Cloudways clone exactly
once, and persists the `provisioningCheckpoint` that the workflow waits on
and verifies parent lineage against before installing or deploying anything.

## Failure handling

- `requiresProviderReconciliation`: inspect Cloudways for the exact claimed
  app before retrying. Never clear an initiation claim and blindly recreate.
- stale deployment: run the production-health reconciliation path. It
  terminalizes the shared job and its deployment, target, and website
  projections so the authenticated retry route can safely restart the job.
- hash or package mismatch: stop. Rebuild/publish the exact package and repair
  the rollout assignment; never bypass the identity check.
- cleanup failure: retain the lease identity and remove only resources owned by
  that lifecycle run.

## Evidence to retain

Record the workflow run ID, shared job IDs, artifact IDs/content hashes,
staging and production URLs, Cloudways backup/promotion/restore operation IDs,
certification evidence IDs, health-check result, restore verification result,
and cleanup result. Do not record credentials.

After a passing run, update
`.cursor/plans/AUTONOMY_FOUNDATION_ROADMAP.md` with the date and evidence
summary and mark the real-target SiteForge P1 item complete.
