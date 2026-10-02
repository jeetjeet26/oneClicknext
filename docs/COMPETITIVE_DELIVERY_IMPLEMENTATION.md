# Competitive delivery improvements — October 1, 2026

Implemented and qualified locally, extending the eight-phase foundation and September client portal. Ordinary password sign-in, assigned client properties and existing product execution controls are preserved. The Agency planner remains deferred. Final checks extend into October 2 UTC.

## Acceptance ledger

| Workstream | Delivered behavior | Status |
| --- | --- | --- |
| Leasing outcomes | Correctable outcomes with source references, one count per inquiry record/stage, reviewed CSV imports and separate advertising conversions | Local implementation verified |
| Client reporting | Period comparisons, goals, coverage, monthly snapshots, exact-version approval and published-only reports | Local implementation verified |
| Website improvement | Execute audits and website changes in their products; coordinate proposals, owners and follow-up in Basecamp | Console task forms retired October 2; product execution and evidence preserved |
| Internal delivery | Basecamp is the project-management workspace; the console concentrates on reporting and outcomes | Manual console task management retired October 2 |
| Quality and economics | Preserve existing assessments and automatic product evidence | Manual work-linked assessment form retired October 2 |
| Release qualification | Fresh production comparison, full reviewed upgrade rehearsal, synthetic restore, access checks and frozen manifests | Local qualification complete; hosted release and client/provider acceptance remain |

## Staff workflow

Open **Operations → Client reporting** (`/dashboard/delivery`) and select a property. Client reports is the default tab.

1. **Client reports**: prepare a monthly draft, review the saved figures, write the explanation and next steps, approve that exact version, then publish. Summarize relevant work managed in Basecamp in the narrative. Withdraw a published report before refreshing or revising it. Refresh saves a new underlying BI snapshot and requires approval again.
2. **Leasing outcomes**: record or correct an application or lease for an existing inquiry, with a date and source reference. A reviewed CSV imports multiple outcomes atomically. Repeated submissions do not duplicate an outcome; corrections and withdrawals retain history.

Project assignments, deadlines, playbooks and discussions belong in Basecamp. The console no longer exposes **Work & priorities** or the work-linked **Quality & effort** form. Product-specific execution, reviews and automatic action evidence remain in their existing products. No Basecamp integration or automatic synchronization was added.

The authenticated HTTP endpoint returns `410` for new `work_save`, `work_transition` and `quality_review` commands, including submissions from older open tabs. Receipt reads and `cancel_request` remain available so an interrupted earlier request can still be resolved. Existing work, assessments, shared activity and report snapshots are retained; no database migration or deletion is involved. The prior service-only database functions remain for historical compatibility. Pagination follows the selected report or outcome list.

Meaningful decisions create shared action history and immutable command receipts. A lost browser response can be recovered by request ID. Closing an unresolved request fences a late original submission. Browser storage retains only the request ID, scoped to the staff actor and property.

## Client reporting

Clients remain read-only and scoped again on the server to current property assignments. They see period comparisons, goals, marketing coverage/freshness and recorded inquiry-to-lease stages. Reports contain a saved snapshot, staff explanation, next steps and captured completed-work summaries, with downloadable summaries.

**Saving an internal BI report no longer makes it visible to clients.** Only an explicitly published delivery report enters their library. Drafts, unpublished snapshots, staff review notes, contact details and advertising account identifiers are excluded. Current access is checked again after assembling the response.

Reporting definitions:

- Cohorts are inquiry records created in the selected period, with outcomes recorded through its end. Each record counts once per stage, including when both native tour sources describe the same stage.
- These are not globally deduplicated people. Duplicate people across systems can remain; missing intermediate stages are not inferred.
- Applications and leases are **reported**. Manual entry and reviewed imports do not establish verified PMS or signed-lease coverage. CSV imports require console inquiry IDs; external identifier mapping and live reconciliation need the selected client's source contract.
- Advertising conversions remain separate from reported leases. Missing days, unknown currency/cost and incomplete coverage are disclosed.
- Monthly snapshots preserve what was known at preparation. Current outcome or goal changes do not silently rewrite a published report.

## Monthly draft preparation

The authenticated `/api/cron/client-report-drafts` endpoint is scheduled hourly at minute 30. It prepares the previous calendar month's missing draft for opted-in properties in batches of ten. Retries are idempotent and the authorizing staff member's current access is rechecked.

Both `CLIENT_REPORT_DRAFTS_ENABLED=true` on the host and the property's reporting opt-in are required. The example configuration defaults to false. `CRON_SECRET` protects the endpoint. Runs and service attribution are recorded; a missing run receipt prevents preparation. The scheduler **does not approve, publish or email reports**. Hosted scheduling was not activated.

## AI quality and operating cost

All prior assessments remain stored, and prior action history remains available. The manual assessment form and its page summary were retired with the console work queue on October 2. Automatic evidence and review controls within individual products are unchanged. Historical effort baselines do not establish causal savings or ROI; unknown model cost is not zero.

These records support evaluation and operating decisions using existing models. Delivery actions are ineligible for model training. No fine-tuning, reinforcement learning, paid model call or client-data export was introduced.

## Original October 1 release verification

These checks describe the original delivery implementation. The October 2 Basecamp simplification is separately verified in `work/basecamp-reporting-20261002/` in the Codex task workspace: 5,350 unit tests passed (43 skipped), three browser journeys passed, desktop/mobile accessibility and layout checks passed, changed-file lint passed, and the production build passed. The browser harness needed its Origin header corrected; the build needed its sandbox-failure cache moved aside before an unrestricted local build. No database migration or hosted change was made.

Evidence is under `work/competitive-system-20261001/` in the Codex task workspace.

| Check | Result |
| --- | --- |
| Production build | Passed, including TypeScript and SiteForge input validation (`build-final.log`). Existing middleware deprecation and six dynamic filesystem tracing warnings remain. |
| Web unit tests | 5,325 passed, 43 skipped across 772 passing files (`unit-final.log`). |
| Static checks | TypeScript, changed-file lint, schema version/truth, RLS guards, foundation trust boundaries and runtime hardening passed. |
| Browser journeys | Both internal delivery and full client-access journeys passed (`browser-combined-final.log`): recovery, outcome correction, report review/publication/withdrawal, quality review, property scope, staff API denial and revocation. |
| Responsive/accessibility | Checked client/internal desktop and mobile screens with automated accessibility and overflow assertions; final screenshots reviewed. Targeted coverage, not whole-product manual certification. |
| Complete upgrade | All 128 reviewed pending migrations applied from the production schema baseline; 120 eligible SQL suites passed with zero unexpected candidate drift (`full-upgrade-rehearsal/report.json`). |
| Companion legacy suite | The runner's excluded ReviewFlow response suite passed in a disposable clone, 35 assertions (`reviewflow-isolated.log`). Together all 121 SQL suites have passing local evidence. |
| Delivery database tests | 86 assertions passed, including access, correction, replay, temporal evidence, publication and scheduler attribution; passed again after restore (`restored-native-tests.log`). |
| Recovery | Synthetic backup/restore matched row counts and content hashes across 405 public/private/auth/storage tables (`database-restore-progress.json`). This does not establish hosted RPO/RTO or customer backup recoverability. |
| New database access | Six tables have RLS and no direct anonymous/authenticated access. Nine public/private functions use invoker rights, fixed search paths and service-only execution (`local-security-check.json`). |

## Production comparison

The final read-only snapshot at **2026-10-02 00:05:44 UTC** (October 1, 17:05 PDT) matches all 2,858 catalog objects and 155 migration versions, names, SQL hashes and statement counts in the reviewed baseline. Earlier checks also matched September 30. This checks drift; it does not mean local changes are deployed.

Existing production security-advisor findings were recorded separately: ten informational service-table policy notices, three mutable function search paths, an extension in public, twelve anonymous and twelve authenticated security-definer execution notices, and leaked-password protection disabled. They predate this release. Production was not represented as free of findings; no authentication policy was changed.

## Coordinated release package

- New migration: `20261001225513_competitive_delivery_workflows.sql`; actual generated local schema types and the version stamp match.
- Frozen database bundle: 155 preserved production-history files plus **128 reviewed pending** files. Content hash: `f6598683af65c6635371e01036224dd48a2b5fc7385c1a5bac4899f1a1601541`.
- Rehearsal plan hash: `a73525fece472907ddec64fccdad47d81f05d4ffb9cfb74563f41104d86c7d04`.
- `application-source-manifest.json` and `application-source-snapshot.tar.gz` freeze installed application sources and locks. `release-evidence.json` binds them to the database bundle and logs. Environment secrets, customer data, dependencies and build caches are excluded.
- The database bundle includes earlier local phases and client portal dependencies. Do not deploy only the newest migration onto the current production baseline or blindly push legacy migration aliases.

For hosted release: recheck drift and source hashes, confirm the target runtime and a recoverable production backup, apply the exact reviewed migration sequence, then deploy the matching application. Keep monthly drafting off until scoped client/staff acceptance passes. Verify assigned-property isolation, revocation, draft invisibility, publish/withdraw behavior and provider permissions in that environment. Source or migration changes after freezing require corresponding requalification.

**Rollback constraint:** retain the published-only client projection during an application rollback. The old portal read all saved `bi_reports`, including snapshots now used for drafts. Before reverting to that older server implementation, disable client access or supply a compatible publication-filtering patch. Preserve additive delivery tables and decision history; do not drop them as routine rollback. Synthetic restore proof does not substitute for a current production backup.

## Release boundary

Implementation and local qualification are complete. Hosted deployment, the chosen client's CRM/PMS reconciliation, real provider acceptance and a full live monthly operating cycle remain release/pilot work. No production write, external message, real client invitation, provider action, model training, automatic Agency execution or git publication occurred. Email/password sign-in remains unchanged; no MFA was added.
