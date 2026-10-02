# SiteForge Phase 2 — local delivery and recovery

September 14, 2026. This increment implements and qualifies the local inquiry and recovery paths for Gable House and Persimmon. **Phase 2 remains open for target-specific live delivery, deployment and production qualification.** Phase 0's live release remains deferred. No remote site, provider, DNS record, hosted database, real recipient or backlog was changed.

## What changed

Both native WordPress inquiry handlers now reserve a durable reference before the mail handoff. Simultaneous requests share that reference. A saved acceptance survives a server restart; changed details or a changed destination cannot silently reuse it. If the process stops during sending, or the final acknowledgement cannot be saved, the reference stays unconfirmed and another request does not send again.

The mail attempt is bounded to one per reference because plain WordPress mail does not provide provider idempotency. An explicit pre-send storage failure can safely retry the same reference. A false mail result or exception is held for reconciliation; the handler does not infer that the recipient received nothing. The success message means accepted for email delivery, not confirmed inbox receipt. This follows the limitations of [WordPress wp_mail](https://developer.wordpress.org/reference/functions/wp_mail/); the isolated test sink uses [pre_wp_mail](https://developer.wordpress.org/reference/hooks/pre_wp_mail/).

References persist across a browser reload within the same tab, without saving the form's personal fields. A lost browser response preserves the entered details. Retrying checks the same submission, and a successful result offers an explicit **Start another inquiry** action. A new inquiry clears the previous outcome styling and creates a separate reference. Closing the browser session is not guaranteed to preserve that reference; real provider reconciliation remains necessary for ambiguous outcomes.

Server validation checks lengths, input types, contact fields, published residence choices and the honeypot. New inquiries are limited atomically to five per server-observed origin address per 15-minute window. Persimmon includes a separate homesite field, checks that it belongs to the selected plan, preserves that context in the handoff and keeps marketing consent optional. Gable House records that an inquiry requests a response without creating a marketing subscription. Missing or invalid delivery configuration fails visibly.

Receipts store a keyed fingerprint, random reference, state and dates in non-autoloaded WordPress options, not the inquiry body or email address. Expired rate buckets are removed; receipt retention/disposition must be set deliberately before launch. There is no automatic backlog replay or automatic resend of an unconfirmed handoff. A transport with genuine provider idempotency could support additional bounded retries once that integration is qualified.

The existing editing systems remain intact. Gable House retains its native content plugin. Persimmon retains its ACF source. The standalone Persimmon source and inventory dates remain separate and unchanged. There is no new oneClick generator or shared client runtime.

## Packages and source identity

| Candidate | Archive | SHA-256 |
| --- | --- | --- |
| gable-theme | `gable-house-theme-1.0.1.zip` | `9bba35a49b1c414d39fcd6824d81ad320c46c8f222c9ae3e0b7e1fe8c39301f6` |
| gable-plugin | `gable-house-content-1.0.3.zip` | `9f068f2beabc24300349d721747a4dfab256a02dab74944030e5e059e6fc4681` |
| persimmon-theme | `persimmon-wordpress-3.0.2.zip` | `ffc9f4bf80215cdf0e4c537534a5d64e68e9367bef2e3dd4bee4d8e09bbac7e4` |

Gable House's local theme source is now **1.0.1**, with content plugin **1.0.3**. Both Persimmon WordPress source copies and the new archive are **3.0.2**. The previous archives remain available. Every archive entry was compared with its tested source; the package contains no local mail sink, test account, database backup or test configuration.

These are local candidates. The latest recorded hosted review versions remain Gable House theme 1.0.0/plugin 1.0.2 and Persimmon theme 3.0.1 with ACF Pro 6.8.6. No fresh hosted-version verification or deployment occurred.

## Verification performed

| Area | Fresh evidence and limits |
| --- | --- |
| Inquiry validation and delivery failure/recovery | **59 checks passed:** 28 Gable House and 31 Persimmon. Includes malformed fields, disabled/missing configuration, plan/home validation, optional consent, atomic reservation, saved acknowledgement, destination changes, eight concurrent requests, process interruption, database failure, restart recovery and rate limiting. Every mail attempt was intercepted by an isolated sink; no external email was sent. |
| Browser visitor/editor flows | **38 distinct checks passed**, combining the original browser run with the focused final form rerun without double-counting overlap. Includes a real Media Library selection, unsaved text/image preview, anonymous and expired-preview denial, published-page isolation, saved visitor changes, revision restoration, selected-residence inquiry, lost response/retry, tab reference persistence, explicit new inquiry, phone reflow and all 22 required visitor routes. |
| Native content model | **12 Gable House checks passed:** saved text and images, revision restoration, save nonce/capabilities, draft/published/trash visibility, gallery add/order/remove/empty behavior and idempotent setup. Temporary fixtures were restored/removed. |
| Accessibility of changed form states | Both forms tested at 320 CSS pixels, with attached field errors and focus movement. The final form scans reported zero violations and zero incomplete results for their selected WCAG rules. Phone screenshots were inspected. This is limited implementation evidence, not a full accessibility or housing-compliance audit. No property eligibility claims or factual inventory values were changed. |
| Runtime and packaging | WordPress **7.1**, PHP **8.2.33** in isolated local installations. All **39 PHP files** passed syntax checks; both changed browser scripts passed syntax checking; all archive file hashes matched source. |
| Full local restore | Two deliberate data/image failures were detected, then database and complete WordPress files restored. Post rows, metadata, selected configuration and all **3,902 Gable House / 4,023 Persimmon files** matched their snapshots. Visitor home routes worked after restoration. Final packages match the restored candidate source. |

Gable House's test database was copied from its existing local WordPress installation, with separate ports, volumes and disabled external traffic. The Persimmon trial used a fresh local WordPress installation with the current theme and its bundled content. **ACF Pro was not available in that isolated installation**, so this phase does not add fresh ACF editor, ACF migration or hosted-content restoration evidence. Persimmon's prior ACF audit remains separately dated. No replacement field framework was installed.

Recovery archives include the local database, uploads, theme/plugin files and local WordPress configuration. They remain in the protected client work folders with restricted archive permissions. They do not establish that Cloudways/SiteGround backups, production secrets, external integrations, DNS, HTTPS or caches can be restored.

Earlier failed test runs are retained in the work logs. The final results supersede test-setting visibility and browser-selector/assertion failures. The browser's initially blank success panel on starting another inquiry was corrected and retested. Automated trial time is not recorded as human editing time, and no cost figure is invented; Phase 3's 20 measured-edit gate remains open.

## Evidence locations and reproduction

Client source, packages and dated evidence stay with their projects:

- Gable House: `2026-09-11/us/outputs/gable-house/` and `2026-09-11/us/work/gable-house/phase-two/` under Documents/Codex. The working folder contains the isolated compose file, failure controls, content tests, browser/delivery results, scans, package manifest and recovery snapshots.
- Persimmon: `2026-09-11/i-cant-fi/outputs/` and `2026-09-11/i-cant-fi/work/persimmon-phase-two/`; its original source and new archive are also preserved under `2026-09-04/ana/outputs/persimmon/`.
- Cross-client orchestration and exact commands: this task's `work/phase-two/` contains `delivery-tests.py`, `browser-tests.cjs`, `recovery-tests.py`, packaging, installation manifests and final logs. The test containers are isolated at localhost ports 8095/8096 and end in preview/disabled mode. Do not point the failure-injection or restore scripts at a hosted site.

The reusable SiteForge integration and verification references now explain pre-send reservation, uncertain outcomes, meaningful interrupted-request tests and the limits of a local restore. No client data or credentials were added to the shared skill.

## Remaining gates and next work

1. Confirm the authoritative Persimmon production target and content/availability owner, including the actual review interval. WordPress and standalone are independent sources.
2. Identify and authorize a specific test destination, configure its supported provider, and reconcile an actual received reference/provider record. Validate the host's actual origin-address handling, mail hooks, retention, caching and recipient permissions before enabling collection. A local sink is not that evidence.
3. Recheck the exact target WordPress/PHP/ACF versions, ACF license state and current editors. Prepare the approved host backup and release candidate, then verify actual deployment, critical routes, redirects, HTTPS, indexing, inquiry delivery and target restoration within that authorization.
4. Continue independent **Phase 3 local creative and maintenance trials**: three contrasting briefs and 20 scoped edits, with parent comparisons, defects, measured operator effort and unresolved factual/design decisions recorded. Those gates are not satisfied by the automated checks above.

Do not reopen Phase 0 release approval merely to continue local work. Neither this increment nor a phase change authorizes publishing or contacting anyone. The full product/platform/autonomy gates remain preserved in the implementation plan.
