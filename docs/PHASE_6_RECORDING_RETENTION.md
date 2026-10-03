# Phase 6 action evidence, evaluation and retention

The platform continues with existing models, grounded context and explicit product tools. No model training is required or authorized by this work. All action rows remain training-ineligible. Recording an observation, approval or provider response does not grant execution permission or establish commercial value.

## Recording qualification

`scripts/platform/recording.py` builds a per-action register from current function bodies, the UI catalog and source/test references. It maps 426 known semantic/display actions across retained products, with 14 explicitly reviewed composed-name mappings. Source/body/test hashes make changes visible. The separately approval-blocked `reviewflow_responses.test.sql` is marked `separate_approval_pending`; references to it do not claim that it ran. Display names retained for history do not revive a retired workflow.

The per-product input/decision/result/recovery ledger remains [Phase 5's acceptance ledger](PHASE_5_LOCAL_COMPLETION.md). Local browser and SQL results provide evidence for their exercised cases. Neither a source reference nor one successful fixture certifies all user branches, external systems or production recording completeness. Browser observations can be interrupted; confirmed mutations and provider receipts have separate evidence classes.

`lineage.sql` checks scoped episode/actor/job/attempt/context joins, future context, outcome windows and training eligibility without returning content. `privacy.sql` counts secret-named JSON keys and token-like values. The final local sample contains 1,701 browser observations and no detected violations; business fixture records were cleaned by their tests. A zero in this sample is not a free-text redaction certificate. Legacy audit logs and provider payloads require separate scoped review before any reuse.

## Frozen evaluation preparation

`datasets.py` accepts metadata-only synthetic episodes and rejects production selection/export, private extra fields, cross-client context/tasks, future context, missing timezones and fabricated success without a receipt hash. Decision-input hashes exclude the action and later results. Corrected evidence changes the full record hash and requires a new immutable manifest. Client/task splits prevent a held-out client from leaking into prompt development. Unknown cost remains unknown; approval and immediate success never become automatic rewards.

The prepared v1 manifest contains 426 synthetic episodes across 20 pseudonymous clients. The existing-model baseline freezes 12 exact model/prompt/tool source contracts and the dataset hash. **Provider execution was not run and model quality is not measured.** A later permitted evaluation must record the resolved model/version, actual request/context/tool hashes, result receipts, usage/cost, reviewer correction and delayed outcome maturity separately. Retain failures and abstentions without labeling them successful demonstrations. Training or cross-client pooling needs its own justified selection and authorization.

## Retention and deletion

`retention.py` accepts scoped metadata, follows downstream references through originals, extracts, sources, embeddings, snapshots, events, artifacts, reports, datasets, provider copies and backups, and refuses cross-client descendants. Active use, explicit holds, unelapsed periods and incomplete lineage block erasure review. No retention period is invented. A source withdrawal stops use; it does not prove physical erasure of its private original or historical copies.

The tool freezes the reviewed inventory hash. Completion requires matching, dated erasure receipts for every selected original and descendant. Requested/uncertain/stale/missing receipts do not pass. Tombstones preserve minimal hashed scope and receipts outside the erased property, exclude affected context/tasks from later dataset selection, and require earlier frozen datasets to be explicitly invalidated. A restored backup must remain quarantined until the deletion ledger has been reapplied. A hash alone is not proof that an executor actually deleted the destination.

The local Storage API drill verified exact private bytes, deleted the selected synthetic original, confirmed it was absent both from listing and download, repeated the deletion and verified a neighboring scope's exact bytes were unchanged. A matching review and tombstone were saved. This qualifies the storage primitive, **not whole-client database/provider/backup erasure**. Existing immutable product histories and accepted knowledge copies must be included in a client-specific offboarding operation with writer fencing and independent receipt verification; do not disable their guards globally or delete Storage metadata directly to simulate erasure. No client records were selected or deleted here.

The installed offline tool suite passes 53 tests (14 drift, 5 recording, 14 dataset, 8 schedule observation and 12 retention). Evidence: `/Users/jasjitgill/Documents/Codex/2026-09-12/we-x20/work/phase6/action-coverage-qualified.json`, `lineage-final.json`, `privacy-final.json`, `evaluation-dataset-v1.json`, `existing-model-baseline-v1.json`, `storage-erasure.json`, `retention-storage-review.json` and `retention-storage-tombstone.json`.
