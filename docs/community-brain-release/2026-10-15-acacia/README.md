# Acacia production adoption

This release includes the Community Brain implementation and the existing local analytics/reporting work recorded in the October 13 release manifest. It upgrades Acacia through an explicit, audited per-community switch. Other communities retain their reviewed legacy chat context until separately adopted.

## Reviewed Acacia data

- Production Supabase: `oneClick` / `lmjmutuggvzuadwreqxx`.
- Community: `2f0de51e-2b63-4b4a-80c8-29855647fed0`.
- Existing widget configuration: `46f678f9-2700-4b45-ab2e-d87a4102ae1a`; keep its credential and embed unchanged.
- Five reviewed sources establish community/contact details, features, FAQ caveats, the original Plan 2 drawing, and the operator's commercial-information hold. See `reviewed-sources.json` and `adoption.manifest.json`.
- **Availability, pricing and incentives are unconfirmed; refer visitors to sales.** Fresh official inventory and marketing pages conflict. The user explicitly selected this policy.
- Preserve all five legacy source rows and twenty legacy chunks. They are historical evidence, not approved public facts. Preserve the previous saved prompt, property fields and three unit rows in an immutable, private adoption receipt.
- Hold the three old unit records pending reconciliation. Remove the unsupported property-level Spa amenity. Do not assert a pool, fitness center or nearby business as an owned community amenity.
- The published Plan 2 PDF is an original master drawing. Homesite 5 is marked Reverse Plan; do not bind this drawing as its exact mirrored plan.
- Source review expires November 14, 2026. Renewal requires source review, not automatic approval of a crawl or generated content.

## Release protections

The nineteenth candidate migration records sticky chat adoption: pausing an adopted community withholds facts and never restores its old prompt. Model execution checks current release state and evidence before and after generation. Completed-answer retries also check current evidence. Matching conversation text alone no longer permits reuse of an older answer.

Migrated canonical facts reference their precise evidence. Source withdrawal or replacement immediately removes dependent facts. Public prompts retain complete canonical facts and only whole evidence items that fit the context limit; oversized canonical context is withheld.

`adopt_reviewed_community.py` prepares an atomic, idempotent data transaction. It compares the actual property, context, units and source snapshots before writing and refuses concurrent edits. It does not fabricate embedding or parser receipts. Its generated SQL contains the private rollback snapshot and belongs outside Git.

`retain_community_files.py` retains original bytes through native file decisions, verifies hashes after upload and optionally queues extraction. It never overwrites originals or automatically approves asset rights. The parser worker uses a dedicated expiring Auth identity, live per-community grants and a Linux network sandbox, with no service-role or model credential.

## Verification before deployment

- Fresh production public schema export and actual 288-entry migration ledger used as the baseline; obsolete local ledger entries excluded.
- All 19 candidate migrations replay successfully; four Community Brain SQL suites pass, including chat cutover and current-answer replay tests.
- Actual Acacia source-only fixture migrated successfully. Eight additional assertions cover retained history, current facts, the commercial hold, canonical allowlists, cross-community rejection and immediate source withdrawal.
- 68 focused Community Brain/Luma web tests pass; TypeScript check passes.
- Earlier full implementation qualification is retained in the October 13 and October 14 release directories; these counts are not represented as rerun in this adoption.

## Deployment sequence and recovery

1. Commit the complete reviewed local release. Apply only the 19 candidate migrations using the fetched production ledger.
2. Retain Acacia originals and raw captures privately. Apply the reviewed data transaction while the existing app continues serving; its saved legacy prompt is updated to the same safe current facts for app rollback.
3. Deploy the app to a staged **production** build without domain assignment. Provision the isolated worker and verify actual file extraction/queue processing.
4. Enable only the Acacia capabilities that have been verified. Test the existing widget against the staged build, then promote that same build to `hellop11.com` and repeat the chat smoke tests.
5. Record actual deployment IDs, commits, counts and any remaining limitations below.

Previous production app: `dpl_EiVDZCTWK7j4K4eyeRnmUusb2UGd` (`b07cdc170ff40b5d85baf0164a77b302777f062f`). App rollback retains the updated safe legacy context. Do not restore obsolete pricing or incentives. The schema migration is additive; do not attempt an unreviewed schema rollback. Pausing Brain after adoption is a deliberate information hold.

Deployment evidence: pending execution at the initial release commit.
