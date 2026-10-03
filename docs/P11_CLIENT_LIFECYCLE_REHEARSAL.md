# Connected client lifecycle — local completion

September 25, 2026. This closes the remaining independent local action items requested after the Phase 0–8 completion review. **Model-generated Agency planner work is deferred.** This work does not constitute production release, real provider acceptance, a trained model or live autonomous operation.

## What changed and why

| Action item | Completed work | Value |
|---|---|---|
| Connected client rehearsal | One synthetic client completes organization/property onboarding, corrected property facts, reviewed original text, approved brand asset, a saved SiteForge Codex brief, reviewed assistant facts, an inquiry and score, lead correction, tour booking/cancellation, interrupted CRM preparation/recovery/stop, and saved reporting. | Verifies that products preserve the same client and source context across handoffs. |
| Operator usability | Property loading can be retried after failure, abandoned loads are cancelled, narrow layouts and keyboard controls are checked, disabled file actions explain the missing reason, and switching properties clears old property-specific knowledge links. | Avoids a stale-record “unavailable” screen on a newly selected property and makes ordinary recovery usable. The existing property boundary already prevented old page data from becoming another property's state. |
| Native workflow rehearsal | A deterministic scored-inquiry → CRM preparation/preview sequence runs in a disposable database with exact scope, an expiry, a shared two-effect budget and durable request identities. | Qualifies restart, duplication, cancellation, current permissions, stale sources, changed contracts and human-edit-safe undo beyond the prior note/alert examples. |
| Export and offboarding | Exports the same client's application rows and actual original bytes; checks retention, stops test work, revokes test access, removes client rows in a disconnected clone and source bytes through Storage, verifies neighbors, and blocks the erased snapshot from restoration. | Exercises connected data copies, vectors, history, reports and pending work rather than accepting a metadata-only deletion claim. |
| Font compatibility | Adds `font` to the retained asset-type database constraint while keeping unsupported types rejected. | Fixes a real mismatch: the application accepts client fonts, but the production-derived constraint rejected them. |

## Connected journey evidence

The final browser journey passed in 14.8 seconds, followed by the reviewed-facts/property-switch journey in 4.7 seconds. The client corrected its city to Carlsbad; the saved Codex brief and published assistant facts contain that correction. Replaying contact capture reuses the same lead. The tour is cancelled, the interrupted CRM response is recovered without creating a second transfer, and the transfer is stopped before a provider write. Reporting saves the actual empty marketing-source state without claiming conversions from the rehearsal inquiry.

There were 63 shared action events at the end of the two browser journeys. Synthetic input fixtures and provider capability/embedding receipts are labelled synthetic. No provider or model was called. The original is a real uploaded text file; the font is an external-reference fixture, not a downloaded client font package. This rehearsal saves the SiteForge brief; it does not build or deploy another website. Individual product acceptance evidence remains in the Phase 5 ledger.

The UI changes are in the community page, property context and knowledge-file workbench. Browser tests are `apps/web/e2e/client-lifecycle.spec.ts` and `client-lifecycle-followthrough.spec.ts`; they skip without an explicit `P11_CLIENT_LIFECYCLE_ARTIFACT_DIR`. They deliberately retain the synthetic fixture for subsequent export/offboarding. Use a new evidence directory and local services with delivery held; do not reuse the already offboarded fixture.

## Native workflow limits and results

`scripts/platform/sandbox_workflow.py` refuses the active console and hosted systems. Registration requires a named synthetic client, its exact operator, one or two leads/properties, at most one hour and at most two preparation effects in the same journal. The locked journal reserves budget before invocation and reuses the native request identity after interruption.

Seventeen native checks passed across the main and adversarial trials: pause/resume, lost response, duplicate invocation, budget/scope refusal, native stop, permission withdrawal, expiry, stale lead evidence, changed action contract, cancelled-work refusal, concurrent callers creating one effect, and refusal to undo a later human approval. No provider receipt was invented. The later approval used to test undo refusal existed only inside the disconnected local trial and was stopped afterward.

This is a deterministic developer rehearsal, not the deferred model planner or a production autonomous adapter. Native preparation is attributed to the registered fixture operator; the journal separately identifies deterministic automation. It has no live provider approval/send operation. Its file journal is a local shared budget, not a distributed platform-wide budget service. Business outcomes remain unmeasured.

## Export, erasure and retained copies

`scripts/platform/client_lifecycle.py` follows client/property ownership and foreign-key descendants, and refuses ambiguous cross-client ownership or unowned client references. The client-facing export excludes credential fields; its private restore input is distinct and access-restricted. Actual Storage bytes are exported and removed with `apps/web/scripts/client-lifecycle-storage.mjs`. The tool refuses unimplemented additional stored-asset families; external references are explicitly separate.

The exact final export contains **256 rows across 62 tables and one original file**. In the disposable clone this includes original/extraction/reviewed-source records, a published synthetic vector chunk, assistant snapshots, action/context history, reports and an unapproved pending CRM handoff. The six preflight/rollback checks passed: hold, unelapsed retention, altered snapshot, changed inventory, another connection, and exact rollback preservation.

Committed removal in `phase6_client_lifecycle_20260925_final` removed those 256 application rows and the synthetic Auth identity. The transaction checked **1,249 foreign keys and unchanged unselected records across 385 tables**, including Auth and neighboring clients. Connections are fenced on this disposable database. The eraser uses transaction-local trigger suppression for an exact reviewed row set and verifies all relationships before commit; it does not change native immutable guards or pretend that legacy cascades define retention. It is intentionally unavailable on the active console and is not a production erasure service.

The actual original bytes were then removed from local Storage through its API, with verified absence and the neighboring client's original unchanged. A saved removal intent allowed recovery when Storage wrapped its missing-object response. A generic network, permission or HTTP 400 error is not treated as successful removal. The downloaded export remains verifiable after removal.

All three synthetic rehearsal accounts have been banned and detached from their test organization; active fixture widgets and remaining scheduled tours were stopped with native controls. The final client's old browser session returned 401 for both property and lead reads. The temporary browser-session file was removed. No actual operator account was changed and sign-in remains email/password only.

The restore check rejects the exact erased client snapshot using the retained erasure receipt. It is an explicit tool gate; a production backup restore pipeline has not been integrated or qualified.

**Retained:** the downloaded export, source database rows, earlier rehearsal exports and the first workflow clone remain explicitly labelled synthetic evidence. The test policy names a seven-day export retention window with **no automatic expiry**; no cleanup automation was scheduled. The neighboring original remains intentionally retained. Provider copies, host backups, legal holds, permitted retention periods and actual client erasure still require the selected real client's policy and host qualification. No claim of erasure from every copy is made.

## Verification and production drift

- 137 offline platform tests passed in pinned Python 3.11.16 with networking disabled, including 14 new regression tests for this tooling.
- Both connected browser journeys passed, including mobile width, keyboard use, retry, interrupted response recovery and delayed property switching. Loaded mobile and desktop screenshots were inspected.
- Seventeen native workflow checks and the six offboarding preflight/rollback checks passed; committed database/Storage removal and existing-session denial were verified separately.
- Full TypeScript check passed. Targeted lint passed without warnings. Schema/type version, declared schema references and RLS policy checks passed.
- The actual retained asset constraint accepts image/video/gif/audio/font and rejects an unsupported type. Only that constraint changed in the active local schema and production-derived clones; migration history was not rewritten. The frozen source database remains unchanged.
- Read-only production comparison at **2026-09-25 18:21:39 UTC**: **2,858 catalog objects and 155 migrations; no new drift** from the earlier qualified production snapshot. Hosted advisories and deployment acceptance remain open.

Migration `20260925174306_client_asset_font_compatibility.sql` is included in a new, undeployed review bundle: **155 historical migrations + 126 pending files**, hash `aff4dd8ff2e06e8c0d7c9a381120cf303425f6fbde0019512035d3d14896b665`. The earlier 125-file bundle and its 118-suite qualification remain frozen. This increment was qualified on exact clones plus targeted asset checks; it is not represented as a newly rerun 118-suite upgrade. A hosted release still requires fresh preflight and its coordinated release decision.

## Evidence and next dependencies

Evidence directory: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/client-lifecycle-20260925`.

Start with `HANDOFF.md` and `evidence-manifest.json`. Detailed receipts include `journey-3/journey.json`, `workflow-trial.json`, `workflow-adversarial.json`, `offboard-preflight-tests.json`, `offboard-erasure.json`, `final-export/storage-removal.json`, `access-revocation.json`, `closeout-database-checks.json` and `production-final-drift.json`. Do not publish the private export or retained session/source artifacts.

The remaining dependencies are unchanged: an actual client and product scope, verified provider/host destinations, coordinated hosted release, real operating-window and outcome evidence, client-specific retention/restore qualification, and a separately scoped live agency action. Model-generated Agency planner improvements are deferred at the owner's request. Existing models remain the first evaluation path; training is not required or started.
