# Phase 0 — local completion and controlled release

Updated September 14, 2026 (Pacific). Repository: oneClick / P11 Console.

**The authorized local implementation is complete. Phase 0's live completion gate remains open.** The earlier explicit deployment hold still applies: no push, deployment, hosted migration, account change, credential reconnection, provider import, message delivery or backlog replay occurred. The read-only hosted audit is current to September 14. This document supersedes the September 5–6 Phase 0 handoff; earlier increment results are historical evidence.

## Completed locally

| Area | Result |
| --- | --- |
| SQL, profiles and assets | Arbitrary elevated SQL is disabled, sensitive profile fields are protected, privileged helpers are restricted, and document/asset writes require the correct property and organization. Legitimate operator and trusted-server access remain tested. |
| Backend and scheduled authentication | Missing configured credentials reject execution. Internal knowledge refresh uses its required server credential, checks confirmed document creation and database freshness, and records failed/partial outcomes accurately. |
| Delivery safety | Email, SMS, Gmail, Microsoft mail, incident alerts and scheduled reports share a hold that defaults to paused. Workflow processing also retains its separate hold. Missing sender configuration or provider acknowledgement cannot produce success. |
| Scheduled reports | A report is paused before sending so competing executions cannot claim it. Provider idempotency keys are stable for the report period and recipient. A crash, unconfirmed delivery or unconfirmed persistence leaves it held for review. Confirmed sends explicitly calculate the next UTC run. Only the qualified property performance summary is enabled; unsupported comparison, campaign-detail, lead and summary variants fail visibly rather than silently omitting requested content. |
| Engagement events | The unique index supports the actual API conflict target while permitting independent unkeyed events. Repeated keyed delivery does not create duplicates. |
| Legacy SiteForge endpoints | Three replacement containment handlers are prepared and tested. Each returns 503 without touching secrets, the database, queued jobs or websites. They have **not** replaced the three hosted v1 functions. |
| Reporting reads and reconciliation | BI performance/comparisons, campaigns/trends, MarketVision and scheduled marketing reports use a complete property-scoped database snapshot. Reads above 50,000 records fail with a shorter-range instruction. BI includes a desktop/phone data-review dialog and complete JSON download. Missing account/currency identity, earlier unverified imports, overlapping identities and invalid metrics are flagged without changing historical data. |
| Import recovery | New versioned jobs save the account plan and verified provider reports, acquire an expiring lease, and commit records and progress together in 250-row batches. Restart resumes the stored offset. A stale worker cannot write after takeover, and different jobs cannot overlap the same property. Native/manual and scheduled Google/Meta paths use this same worker. Scheduled dispatch reports queued jobs separately from imported rows and refuses a truncated account inventory. Old unversioned jobs cannot enter automatic recovery. |

The reporting work closes the already-started shared reliability scope and advances MultiChannel BI's later product phase. It does not mark the entire BI, reporting, integrations or SiteForge product complete. SiteForge remains the personal Codex skill operating in client projects; the console prepares portable briefs and retains earlier project records.

## Local state and verification

The access, engagement, account-identity and recovery schema effects are installed in **localhost** Supabase. A complete local database backup was saved before Phase 0 installation. Existing facts were checked during installation; verification fixtures were rolled back or removed. Migration-history records were not changed. This is not a hosted backup/restore qualification or proof that all historical migrations rebuild cleanly.

- **232 web tests across 28 files passed** using Node 24.21.0; full TypeScript and targeted lint passed.
- The complete local production build passed on Node 24.21.0, including SiteForge input validation, compilation, type checking and all 267 static-generation entries. The existing middleware-to-proxy deprecation warning remains; no deployment occurred.
- **151 Python tests passed** for provider reports, tracked imports, backend authentication, ReviewFlow and MarketVision security. Existing deprecation warnings remain.
- **32 database access assertions passed**, plus the installed reporting/recovery SQL regression covering complete snapshots, overlap prevention, lease takeover, stale-worker rejection, exact counts and old-backlog exclusion.
- A real Python worker against localhost was interrupted after the first committed batch. It resumed **550 records / 68.75 conversions**, fetched the fixture provider report once, and counted the first 250 rows once. Independent simultaneous database clients produced exactly one lease owner. All fixture rows were removed; no live provider was contacted.
- **29 distinct browser scenarios passed**: data review (4), import tracking (7), account identity/CSV (5), pipelines (8), and Codex SiteForge briefs (5). Four review cases were repeated after the React correction. Desktop and phone screenshots were inspected. Browser tests used the existing localhost dev server, with mocked providers and selected real local API/database reads; the dev server itself remained on its existing Node 26 process.
- Three legacy containment handlers passed local request checks for GET, POST and OPTIONS with no external effect.
- Schema/type synchronization, declared schema, RLS, critical-route trust boundaries, runtime configuration and whitespace checks passed.
- Local database advisors reported **zero new findings** versus the earlier September 14 baseline. The 1,386 pre-existing warning/error entries remain a separate remediation inventory; this is not a clean-database claim.

Reproducible database and containment checks are in `p11-platform/scripts/test-phase-zero-access.py`, `test-marketing-import-recovery.py`, and `test-legacy-siteforge-containment.mjs`. The recovery SQL test expects the installed local schema and demo organization. The web types incorporate generated localhost definitions for the changed tables/RPCs while preserving unrelated declared contracts; they are not a regenerated hosted snapshot.

## Fresh hosted audit — release inputs only

Target verified: **oneClick**, Supabase project `lmjmutuggvzuadwreqxx` (the separate oneClickNext project was not used).

| Finding on September 14 | Release treatment |
| --- | --- |
| Elevated arbitrary-SQL execution and permissive asset policies remain hosted | Release the reviewed access repair with the matching application changes; verify real anonymous/authenticated boundaries. |
| Nine profiles, including six administrators | Owner review of each account and administrator role before changing accounts or signup settings. Apparent test names are evidence for review, not permission to remove them. |
| Three active legacy SiteForge v1 functions lack appropriate caller/property checks | No in-repository callers of these exact legacy endpoints were found. External callers are unverified. Approve containment first; permanent retirement follows caller confirmation. |
| 15 legacy SiteForge jobs queued, dating December 2025–July 2026 | Keep held; individually classify before cancelling, migrating or running anything. |
| Five active, overdue follow-up workflows | Keep held pending recipient, consent, purpose and current-step review. |
| 2,814 failed email actions and 4,723 failed SMS actions at the audit snapshot | SMS errors match authentication-related failures. Email failures require provider/sender review. These are historical action records, not a list to replay. Counts can grow while old hosted code continues running. |
| Six dead-lettered events: three engagement and three workflow-start events | The three engagement records match the conflict-index issue. Workflow-start records need individual review; the hosted lease columns already exist. No replay is implied by repairing schema. |
| No scheduled report records | No existing report schedule was enabled or changed. |
| 43 historical marketing rows with unknown account identity | 30 Google CSV rows and 13 earlier Meta MCP rows remain unchanged. All 13 Meta rows use one date and require comparison with provider daily exports; this is a reconciliation flag, not proof of an incorrect total. |

A private owner-review inventory accompanies this handoff. No historical account ownership, campaign attribution, currency or intended recipient was invented.

## Concrete release sequence — approval required

1. **Keep delivery and replay held.** The new code defaults to paused, but the existing hosted code does not yet contain this guard. Preserve any existing hosted holds, then release with `OUTBOUND_DELIVERY_PAUSED=true` and `WORKFLOW_DELIVERY_PAUSED=true` before changing provider credentials. Leave `MARKETING_IMPORT_WORKER_ENABLED=false` while reconciling old jobs. This flag controls automatic recovery; a separately authorized explicit import still uses the leased worker.
2. **Confirm the exact target and schema effects.** Capture a recoverable hosted backup and compare the current function/policy/table inventory with the prepared changes. Hosted/local migration histories have different timestamps and consolidated repairs. Do not run an indiscriminate database push or repair migration history merely to match filenames.
3. **Coordinate the web, backend and four reviewed migration effects:** `20260905190852_phase_zero_access_hardening.sql`, `20260906014842_phase_zero_engagement_conflict_repair.sql`, `20260914195328_marketing_fact_account_identity.sql`, then `20260914214955_phase_zero_reporting_recovery.sql`. The old analytics route and the replacement RPC must not be mixed. Inspect duplicate/index prerequisites and lock impact before applying only the approved changes.
4. **Contain the three legacy hosted functions** using the prepared 503 handlers, after approval for that specific change. Preserve their current source/version inventory and queued jobs. Do not invoke them to test whether they work; their old handlers can mutate websites or consume queued work.
5. **Run disposable hosted identity checks.** Anonymous and cross-organization operations must fail; the approved operator must retain profile preferences, its own property analytics, document/asset access and ordinary console flows. Check the new API and database contract together.
6. **Resolve the private account/backlog review.** Confirm administrators and signup policy. Classify each of the five active workflows, six dead letters and 15 legacy jobs. Prefer leaving uncertain work held. Record each approved cancellation or restart separately; never bulk replay failed actions.
7. **Configure and verify actual destinations.** Match backend/caller API keys and internal/cron credentials, verify an approved Resend sender and intended Telnyx sender/account, and confirm incident-alert destinations. Do not use the guard's global unpause to test while unreviewed scheduled senders remain active. Isolate approved test work, then confirm actual receipt and provider IDs for email, SMS and an incident alert, plus a knowledge refresh that produces retrievable documents. Provider acceptance alone is not proof of receipt.
8. **Enable only approved new work.** After schema/backend/provider qualification, explicitly enable recovery for new versioned imports and perform an authorized account/date-range import with provider-export reconciliation. Decide separately which reviewed delivery workflows may resume. Record monitoring and rollback evidence; preserve security restrictions when repairing an application release.

Required configuration names are documented in `.env.example`; no hosted secrets or configuration values were changed. The global delivery hold covers the central email/SMS/incident/report senders, not social publishing, website deployment, external vendor automations, or generic outbox/CRM handlers. Those stay under their existing release controls.

**Phase 0 is complete only after live access checks pass, the operator retains required access, approved messages and alerts reach their destinations, and historical work cannot replay unexpectedly.** Once those gates pass, return to the amended SiteForge Phase 1 completion contract. The original product, platform and autonomy gates remain intact.
