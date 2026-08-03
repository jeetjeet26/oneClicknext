# oneClick SiteForge Runtime

Permanent WordPress mutation runtime for immutable SiteForge releases. It adds an authenticated `siteforge/v2` REST namespace without changing the theme-owned `siteforge/v1` compatibility routes.

## Routes

All routes require a WordPress user with `manage_options` and the request header `X-SiteForge-Contract-Version: 2`.

- `GET /wp-json/siteforge/v2/health`
- `GET /wp-json/siteforge/v2/state?siteId=...`
- `GET /wp-json/siteforge/v2/capabilities`
- `POST /wp-json/siteforge/v2/assets/prepare`
- `POST /wp-json/siteforge/v2/deployments`
- `GET /wp-json/siteforge/v2/deployments/{transactionId}`

WordPress Application Passwords provide Basic authentication by default. Bearer authentication requires the host's existing bearer/JWT authentication integration; authorization still ends at `current_user_can( 'manage_options' )`.

## Runtime invariants

- Asset IDs are immutable bindings to one SHA-256 byte hash. Downloads are size/hash/MIME checked before attachment metadata is committed.
- Asset-preparation and deployment idempotency keys are derived from canonical contract payloads. Replays return the original result; a key cannot identify different bytes or operations.
- Deployments reject stale `expectedRemoteContentHash` values and serialize through a short-lived WordPress option lock.
- Pages, logo, homepage, primary navigation, site configuration, and design tokens are read back before commit.
- Failed mutations run a compensating rollback for pages, options, theme mods, and navigation. The prior manifest remains active even if rollback itself reports a repair-required failure.
- The active remote content manifest is written only after all desired-state writes and verification succeed.
- Runtime transactions never install or modify a theme or plugin. Package provisioning and upgrades remain a separate operator workflow.

## Tests

With PHP 7.4+ installed:

```sh
./scripts/test.sh
```

The script lints every plugin PHP file and runs dependency-free canonical contract fixture tests. WordPress integration behavior should additionally be exercised in a disposable WordPress test site because media, menu, and rollback APIs require WordPress core.

